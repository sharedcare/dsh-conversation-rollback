#!/usr/bin/env node
/**
 * Build `lib/client.js` from the two authored inputs, or strip it back.
 *
 *   node tools/merge-client.mjs            src/client.rollback.js + src/session-toc.js -> lib/client.js
 *   node tools/merge-client.mjs --strip    lib/client.js -> src/client.rollback.js
 *
 * Why a generator: the module loader serves exactly ONE file per plugin entry
 * (`/plugins/<id>/client.js`), and a factory's `require` only resolves the
 * shared module table, so two features in one plugin cannot stay two bundles.
 * The repository ships built output and declares no `prepare` script, so a
 * `github:` install works without pnpm build authorization — which means the
 * merged bundle, not the inputs, is what users load. Keep the inputs in the
 * repo and regenerate the bundle with `pnpm run build`.
 *
 * Why the rail is wrapped in an IIFE: both halves declare `function apply` in
 * the factory scope. Plain concatenation is legal JavaScript where the LATER
 * declaration silently wins — the rollback half would stop registering its three
 * slot entries without an error. Separate scopes make that impossible.
 *
 * Keeping up with `lib/client.js` edits made elsewhere: run `--strip` first. It
 * removes the marked regions and recovers the rollback-only bundle, so merge
 * conflicts land in a file that no longer contains this feature.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const upstreamPath = join(root, 'src', 'client.rollback.js')
const railPath = join(root, 'src', 'session-toc.js')
const targetPath = join(root, 'lib', 'client.js')

const SECTION_BEGIN = '/* == session-toc: BEGIN generated section'
const SECTION_END = '/* == session-toc: END generated section == */'
const GLUE_BEGIN = '/* == session-toc: BEGIN generated glue == */'
const GLUE_END = '/* == session-toc: END generated glue == */'
const APPLY_TAIL = 'exports.apply = apply;'
const NAME_TAIL = 'exports.name = "conversation-rollback";'

function assert(condition, message) {
  if (!condition) {
    console.error(`merge-client: ${message}`)
    process.exit(1)
  }
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1
}

/** The repository commits CRLF; inputs are handled internally as \n. */
function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function toLf(text) {
  return text.replace(/\r\n/g, '\n')
}

function withEol(text, eol) {
  return eol === '\n' ? text : text.replace(/\n/g, '\r\n')
}

async function read(path) {
  const text = await readFile(path, 'utf8')
  return { text, eol: detectEol(text), lf: toLf(text) }
}

async function write(path, lfText, eol) {
  await writeFile(path, withEol(lfText, eol), 'utf8')
}

/** Index just past the start of the line containing `index`. */
function lineStart(text, index) {
  return text.lastIndexOf('\n', index) + 1
}

/** Index at the start of the line after the one containing `index`. */
function lineEnd(text, index) {
  const newline = text.indexOf('\n', index)
  return newline === -1 ? text.length : newline + 1
}

/** Delete the marked lines (whole lines, inclusive) and optionally splice `replacement` in. */
function cutBlock(text, beginMarker, endMarker, label, replacement) {
  const begin = text.indexOf(beginMarker)
  const end = text.indexOf(endMarker, begin)
  assert(begin >= 0 && end > begin, `${label}: markers not found — refusing to write a truncated bundle`)
  return text.slice(0, lineStart(text, begin)) + (replacement === undefined ? '' : replacement) + text.slice(lineEnd(text, end))
}

// --------------------------------------------------------------------- strip
if (process.argv.includes('--strip')) {
  const bundle = await read(targetPath)
  assert(bundle.lf.includes(SECTION_BEGIN), 'no generated section found — lib/client.js is already rollback-only')
  // Each cut re-locates its own markers: doing the two removals with offsets
  // measured up front would cut the second block at a stale index.
  let stripped = cutBlock(bundle.lf, GLUE_BEGIN, GLUE_END, 'glue', '\t\texports.apply = apply;\n')
  stripped = cutBlock(stripped, SECTION_BEGIN, SECTION_END, 'generated section')
  assert(stripped.includes(APPLY_TAIL), 'stripped bundle lost its exports tail')
  assert(!stripped.includes('session-toc'), 'stripped bundle still mentions session-toc')
  await write(upstreamPath, stripped, bundle.eol)
  console.log(`merge-client: stripped lib/client.js (${Buffer.byteLength(bundle.text, 'utf8')}B) -> src/client.rollback.js (${Buffer.byteLength(withEol(stripped, bundle.eol), 'utf8')}B)`)
  process.exit(0)
}

// --------------------------------------------------------------------- merge
const upstream = await read(upstreamPath)
const rail = await read(railPath)

assert(!upstream.lf.includes(SECTION_BEGIN), 'src/client.rollback.js already contains a generated section — run `node tools/merge-client.mjs --strip` on lib/client.js first')
assert(!rail.lf.includes('__ModuleLoader__'), 'src/session-toc.js must be a factory body, not a bundle')
assert(!/^\s*exports\./m.test(rail.lf), 'src/session-toc.js must not touch `exports` — the merged bundle owns the exports tail')
assert(/function apply\s*\(ctx\)/.test(rail.lf), 'src/session-toc.js does not define `apply(ctx)`')
assert(count(upstream.lf, '__ModuleLoader__.load') === 1, 'src/client.rollback.js does not look like a client bundle')
// Anchor on whole lines, never on the bare tokens: inserting after the line's
// leading tabs would strand `exports.name` at column 0, and --strip could not
// then reproduce the input byte for byte.
const NAME_LINE = `\t\t${NAME_TAIL}`
const APPLY_LINE = `\t\t${APPLY_TAIL}`
assert(count(upstream.lf, APPLY_LINE) === 1, 'upstream exports tail not found (exactly one tab-indented `exports.apply = apply;` expected)')
assert(count(upstream.lf, NAME_LINE) === 1, 'upstream `exports.name` tail not found (exactly one tab-indented line expected)')

const section = [
  '\t\t/* == session-toc: BEGIN generated section (tools/merge-client.mjs) ==',
  '\t\t * Author the rail in src/session-toc.js and run `pnpm run build`.',
  '\t\t * `node tools/merge-client.mjs --strip` recovers the rollback-only bundle.',
  '\t\t *',
  '\t\t * The IIFE is load-bearing: the rail declares `apply`, and a second',
  '\t\t * `function apply` in this scope would silently override the rollback half.',
  '\t\t * == preamble END == */',
  '\t\tconst SessionToc = (function () {',
  rail.lf.replace(/\s+$/, ''),
  '',
  '\t\t\treturn { apply: apply }',
  '\t\t})();',
  '\t\t' + SECTION_END,
  '',
].join('\n')

const glue = [
  '\t\t' + GLUE_BEGIN,
  '\t\t// Rollback first: it is what this package is named for, and a broken',
  '\t\t// rail must never take it down with it.',
  '\t\texports.apply = function applyAll(ctx) {',
  '\t\t\tapply(ctx);',
  '\t\t\ttry {',
  '\t\t\t\tSessionToc.apply(ctx);',
  '\t\t\t} catch (error) {',
  '\t\t\t\tconsole.warn("[conversation-rollback] session-toc disabled:", error);',
  '\t\t\t}',
  '\t\t};',
  '\t\t' + GLUE_END,
].join('\n')

// The section goes before the exports tail so `SessionToc` (a const) is
// initialized well before any activation reaches it.
const merged = upstream.lf
  .replace(NAME_LINE, () => `${section}${NAME_LINE}`)
  .replace(APPLY_LINE, () => glue)

const output = withEol(merged, upstream.eol)
await write(targetPath, merged, upstream.eol)
const bytes = (text) => Buffer.byteLength(text, 'utf8')
console.log(`merge-client: lib/client.js <- src/client.rollback.js (${bytes(upstream.text)}B) + src/session-toc.js (${bytes(rail.text)}B) = ${bytes(output)}B, eol=${upstream.eol === '\n' ? 'lf' : 'crlf'}`)
