/*
 * Host-side codec test for lib/chunk-rows.js — the vendored physical-row codec.
 *
 * The rollback host rewrites session logs in place: it decodes every stored row
 * to its events, cuts at a turn boundary, and re-packs the kept events. This
 * pins the contract the rewrite relies on — exact row shapes, run boundaries,
 * verbatim pass-through, and loud malformed-row rejection — without a DSH host.
 * Run from the package root:  node test/chunk-rows.mjs
 */
import assert from 'node:assert/strict'
import { decodeStorageRecord, packChunkRuns } from '../lib/chunk-rows.js'

const textChunk = (seq, time, turn, step, index, text) => ({
  type: 'assistant/chunk',
  seq,
  time,
  data: { turn, step, chunk: { type: 'text-delta', index, text } },
})

const reasoningChunk = (seq, time, turn, step, index, text) => ({
  type: 'assistant/chunk',
  seq,
  time,
  data: { turn, step, chunk: { type: 'reasoning-delta', index, text } },
})

const toolChunk = (seq, time, turn, step, index, id, argumentsDelta, name) => ({
  type: 'assistant/chunk',
  seq,
  time,
  data: {
    turn,
    step,
    chunk: {
      type: 'tool-call-delta',
      index,
      id,
      ...name === undefined ? {} : { name },
      argumentsDelta,
    },
  },
})

// ------------------------------------------------------------------ packing

// A run of >= 3 same-block deltas becomes one row carrying exact gap times.
const textRun = [
  textChunk(0, 100, 1, 1, 0, '你'),
  textChunk(1, 105, 1, 1, 0, '好'),
  textChunk(2, 111, 1, 1, 0, '！'),
]
let rows = packChunkRuns(textRun)
assert.equal(rows.length, 1, 'a three-member text run packs into one row')
assert.deepEqual(rows[0], {
  type: 'text-chunks',
  seq0: 0,
  time0: 100,
  data: { turn: 1, step: 1, index: 0, dt: [5, 6], texts: ['你', '好', '！'] },
})
assert.deepEqual(decodeStorageRecord(rows[0]), textRun, 'the row expands back to the exact original events')

// Below the minimum run length everything stays verbatim, in order.
const shortRun = [textChunk(0, 100, 1, 1, 0, 'a'), textChunk(1, 101, 1, 1, 0, 'b')]
rows = packChunkRuns(shortRun)
assert.equal(rows.length, 2, 'a two-member run does not pack')
assert.equal(rows[0], shortRun[0], 'short-run members pass through by reference')
assert.deepEqual(decodeStorageRecord(rows[0]), [shortRun[0]])

// Kind, turn, step, and block-index changes each break the run.
const turnEnd = { type: 'turn/end', seq: 3, time: 200, data: { turn: 1 } }
const mixed = [
  ...textRun,
  turnEnd,
  reasoningChunk(4, 300, 2, 1, 0, 'r1'),
  reasoningChunk(5, 301, 2, 1, 0, 'r2'),
  reasoningChunk(6, 302, 2, 1, 0, 'r3'),
  textChunk(7, 400, 2, 1, 0, 'late'),
  textChunk(8, 401, 2, 1, 1, 'other-block'),
  textChunk(9, 402, 2, 1, 1, 'other-block-2'),
]
rows = packChunkRuns(mixed)
assert.deepEqual(
  rows.map((row) => row.type),
  ['text-chunks', 'turn/end', 'reasoning-chunks', 'assistant/chunk', 'assistant/chunk', 'assistant/chunk'],
  'runs split at non-chunk events and at turn/step/index changes; sub-minimum tails stay verbatim',
)
assert.deepEqual(
  decodeStorageRecord(rows[2]).map((event) => event.data.chunk.text),
  ['r1', 'r2', 'r3'],
  'the reasoning row expands in order',
)

// Tool-call runs preserve the optional `name` in presence AND value.
const toolRun = [
  toolChunk(0, 10, 1, 1, 0, 'call-1', '{"a"', 'search'),
  toolChunk(1, 12, 1, 1, 0, 'call-1', ':1}', 'search'),
  toolChunk(2, 15, 1, 1, 0, 'call-1', '', 'search'),
]
rows = packChunkRuns(toolRun)
assert.equal(rows.length, 1, 'a tool-call run packs')
assert.equal(rows[0].type, 'tool-call-chunks')
assert.equal(rows[0].data.name, 'search')
assert.deepEqual(decodeStorageRecord(rows[0]), toolRun)

const anonymousToolRun = [
  toolChunk(0, 10, 1, 1, 0, 'call-2', 'x'),
  toolChunk(1, 11, 1, 1, 0, 'call-2', 'y'),
  toolChunk(2, 12, 1, 1, 0, 'call-2', 'z'),
]
rows = packChunkRuns(anonymousToolRun)
assert.equal(rows.length, 1, 'a name-less tool-call run packs')
assert.equal(Object.hasOwn(rows[0].data, 'name'), false, 'no fabricated name member')
assert.deepEqual(decodeStorageRecord(rows[0]), anonymousToolRun)

// A member shape the whitelist does not fully recognize stays one event/row.
const exotic = {
  type: 'assistant/chunk',
  seq: 0,
  time: 1,
  data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'x', extra: true } },
}
assert.equal(packChunkRuns([exotic])[0], exotic, 'unknown fields lose compression, never data')

// ------------------------------------------------------------------ decoding

// Plain events pass through as single-event arrays; a numeric seq is validated.
const plain = { type: 'turn/start', seq: 7, time: 1, data: { turn: 7 } }
assert.deepEqual(decodeStorageRecord(plain), [plain])
assert.deepEqual(decodeStorageRecord('not-a-record'), ['not-a-record'])
assert.throws(() => decodeStorageRecord({ type: 'turn/start', seq: -1, time: 1, data: {} }), /SessionSeq/)

// A malformed packed row is corrupt storage: decode fails loud instead of
// silently dropping the whole run.
assert.throws(
  () => decodeStorageRecord({
    type: 'text-chunks',
    seq0: 0,
    time0: 0,
    data: { turn: 1, step: 1, index: 0, dt: [], texts: ['a', 'b'] },
  }),
  /malformed text-chunks storage row/,
)
assert.throws(
  () => decodeStorageRecord({
    type: 'text-chunks',
    seq0: 0,
    time0: 0,
    data: { turn: 1, step: 1, index: 0, dt: [1], texts: [7] },
  }),
  /malformed text-chunks storage row/,
)

// ------------------------------------------------- the rewrite path, end to end

// The host rewrite reads rows, keeps a prefix of events, and re-serializes the
// packed result as JSONL. Round-trip that exact flow.
const stored = packChunkRuns(mixed)
const jsonl = stored.map((record) => JSON.stringify(record)).join('\n')
const kept = []
for (const line of jsonl.split('\n')) {
  for (const event of decodeStorageRecord(JSON.parse(line))) kept.push(event)
}
const cut = 4 // mid-batch: keeps the whole text run and the turn/end event
const rewritten = packChunkRuns(kept.slice(0, cut))
const replayed = []
for (const record of rewritten) {
  for (const event of decodeStorageRecord(JSON.parse(JSON.stringify(record)))) replayed.push(event)
}
assert.deepEqual(replayed, mixed.slice(0, cut), 'a truncated rewrite replays the exact kept events')

console.log('chunk-rows: all assertions passed')
