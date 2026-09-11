/*
 * In-memory import stubs for test/host-route.mjs.
 *
 * The host half (`lib/index.js`) imports three packages that only exist inside
 * a running DSH installation, so a plain local Node process cannot load it.
 * This module is a Node module-customization hook (`module.register`) mapping
 * exactly those three specifiers to in-memory sources:
 *
 *   @deepseek-ai/dsh-session  — `interruptedTurnClosers`, the one public export
 *                               the host half keeps importing from that package
 *   @deepseek-ai/dsh-llm      — `createUserMessage`
 *   @deepseek-ai/schemastery  — a minimal stand-in for the schema builder
 *
 * The schemastery stand-in is deliberately small and deliberately NOT the point
 * of the test: it implements the contract the settings service actually uses —
 * the schema is a callable that applies defaults and validates, plus a
 * `toJSON()` — so the route logic (dispatch, revision guard, conflict mapping,
 * unavailable path) is exercised end to end. The real schema was verified
 * separately against the `@deepseek-ai/schemastery` build shipped in the
 * Desktop app bundle; this stub only keeps that verification from being a
 * prerequisite for running the suite.
 */

const SCHEMA_SOURCE = `
function object(shape) {
  const schema = (value) => {
    const source = value !== null && typeof value === 'object' ? value : {}
    const out = {}
    for (const key of Object.keys(shape)) {
      const field = shape[key]
      const given = source[key]
      if (given === undefined) {
        if (field.default === undefined) throw new TypeError(key + ' is required')
        out[key] = field.default
        continue
      }
      if (field.type === 'boolean' && typeof given !== 'boolean') {
        throw new TypeError(key + ' must be a boolean')
      }
      out[key] = given
    }
    return out
  }
  schema.toJSON = () => ({
    type: 'object',
    dict: Object.fromEntries(Object.keys(shape).map((key) => [key, {
      type: shape[key].type,
      ...(shape[key].default === undefined ? {} : { default: shape[key].default }),
    }])),
  })
  return schema
}
function boolean() {
  return { type: 'boolean', default: (value) => ({ type: 'boolean', default: value }) }
}
export default { object, boolean }
`

const SOURCES = new Map([
  ['@deepseek-ai/dsh-session', 'export function interruptedTurnClosers() { return [] }\n'],
  ['@deepseek-ai/dsh-llm', 'export function createUserMessage(input) { return input }\n'],
  ['@deepseek-ai/schemastery', SCHEMA_SOURCE],
])

const PREFIX = 'dsh-stub:'

// The hooks are deliberately synchronous: `module.registerHooks` (Node's
// non-deprecated in-process API) only accepts synchronous hooks, and the async
// `module.register` loader accepts these same functions unchanged.
export function resolve(specifier, context, nextResolve) {
  if (SOURCES.has(specifier)) return { url: PREFIX + specifier, shortCircuit: true }
  return nextResolve(specifier, context)
}

export function load(url, context, nextLoad) {
  if (url.startsWith(PREFIX)) {
    return { format: 'module', source: SOURCES.get(url.slice(PREFIX.length)), shortCircuit: true }
  }
  return nextLoad(url, context)
}
