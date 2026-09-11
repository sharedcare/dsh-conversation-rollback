import { readFile, writeFile, open, rename } from 'node:fs/promises'
import { zstdCompressSync, zstdDecompressSync, constants } from 'node:zlib'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { interruptedTurnClosers } from '@deepseek-ai/dsh-session'
/* The harness ships its own schemastery build and resolves `@deepseek-ai/*`
 * for plugin host code (the same path `@deepseek-ai/dsh-session` and
 * `@deepseek-ai/dsh-llm` take on the lines above, and the specifier
 * dsh-taskswarm uses for its own config schema). Importing the scoped build
 * keeps this package dependency-free — nothing to install at plugin-add time,
 * and no npm fetch on a `github:` install. */
import z from '@deepseek-ai/schemastery'
import { decodeStorageRecord, packChunkRuns } from './chunk-rows.js'

/**
 * User-settings namespace for this plugin's own preferences. Registering it
 * with the host settings service (`ctx.settings`) is what makes the value a
 * real user setting: it lives in the harness home's settings.yaml under this
 * key, follows the user across the web and desktop profiles, and is validated
 * against the schema below on every write.
 *
 * The client half reads and writes it through THIS plugin's own route
 * (`settings.get` / `settings.update`) rather than through the settings UI's
 * private transport. That is deliberate: the client bundle then needs no
 * dependency on the settings UI packages, so the rail (and the rollback UI)
 * still activates on a build whose settings surface is absent or replaced.
 * dsh-better-sidebar ships the same own-route pattern.
 */
const SETTINGS_NS = 'conversation-rollback'

/**
 * Registered schema. `outline` is the right-edge session outline rail: the
 * settings row on the official General page writes it, the rail and its header
 * button read it. Defaults to ON so an upgrade never silently removes a
 * feature the user already had.
 */
const PluginSettings = z.object({ outline: z.boolean().default(true) })

/** One settings field is missing or malformed. */
const INVALID_SETTINGS_PATCH = {
  ok: false,
  code: 'invalid-args',
  message: 'patch.outline 必须是布尔值'
}

/**
 * conversation-rollback host half: registers an exact HTTP route
 * /api/conversation-rollback that truncates a session log in place at a
 * completed-turn boundary (Codex-style rewind) and can edit + re-drive the
 * human input of one completed turn (Codex-style edit-and-resend). The
 * session must not be running; live in-memory sessions are spliced in sync
 * with the file.
 */

const ZSTD_MAGIC = 0xfd2fb528

/** Port of dsh-session-persistence-jsonl scanZstdFrames (multi-frame append logs). */
function scanFrames(buf) {
  const frames = []
  let off = 0
  while (off < buf.length) {
    const start = off
    if (buf.length - off < 4) return { frames, torn: start }
    if (buf.readUInt32LE(off) !== ZSTD_MAGIC) throw new Error('corrupt zstd frame magic at ' + off)
    off += 4
    if (off === buf.length) return { frames, torn: start }
    const d = buf.readUInt8(off)
    off += 1
    if ((d & 24) !== 0) throw new Error('reserved frame-header bit')
    const csf = d >>> 6
    const ss = (d & 32) !== 0
    const ck = (d & 4) !== 0
    const df = d & 3
    const db = df === 3 ? 4 : df
    const cb = csf === 0 ? (ss ? 1 : 0) : 1 << csf
    const rh = (ss ? 0 : 1) + db + cb
    if (buf.length - off < rh) return { frames, torn: start }
    off += rh
    for (;;) {
      if (buf.length - off < 3) return { frames, torn: start }
      const bh = buf.readUIntLE(off, 3)
      off += 3
      const last = (bh & 1) !== 0
      const bt = bh >>> 1 & 3
      const bs = bh >>> 3
      if (bt === 3) throw new Error('reserved block type')
      const p = bt === 1 ? 1 : bs
      if (buf.length - off < p) return { frames, torn: start }
      off += p
      if (last) break
    }
    if (ck) {
      if (buf.length - off < 4) return { frames, torn: start }
      off += 4
    }
    frames.push({ start, end: off })
  }
  return { frames }
}

async function rewriteLogFile(filePath, keepCount) {
  const raw = await readFile(filePath)
  let text = null
  let isZstd = true
  try {
    const scanned = scanFrames(raw)
    const parts = []
    for (const frame of scanned.frames) parts.push(zstdDecompressSync(raw.subarray(frame.start, frame.end)))
    text = Buffer.concat(parts).toString('utf8')
  } catch {
    isZstd = false
    text = raw.toString('utf8')
  }
  const lines = text.split('\n')
  const header = lines[0]
  if (!header || !header.startsWith('{')) throw new Error('unexpected log format')
  const body = lines.slice(1)
  if (body.length > 0 && body[body.length - 1] === '') body.pop()
  const events = []
  for (const line of body) {
    if (!line) continue
    const decoded = decodeStorageRecord(JSON.parse(line))
    for (const event of decoded) events.push(event)
  }
  const cut = Math.min(keepCount, events.length)
  if (cut <= 0) throw new Error('nothing to keep')
  const kept = events.slice(0, cut)
  // Physical format: the FIRST zstd frame must contain exactly the header
  // line (assertZstdHeaderFrame), event lines live in later frames.
  const frame1 = Buffer.from(header + '\n', 'utf8')
  const frame2 = Buffer.from(packChunkRuns(kept).map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8')
  const payload = isZstd
    ? Buffer.concat([
        zstdCompressSync(frame1, { params: { [constants.ZSTD_c_checksumFlag]: 1 } }),
        zstdCompressSync(frame2, { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
      ])
    : Buffer.concat([frame1, frame2])
  const tmp = filePath + '.rollback.tmp'
  await writeFile(tmp, payload)
  if (isZstd) {
    // Fail-safe: the rewrite must satisfy the persistence's own header-frame
    // contract before it replaces the live log.
    const probe = await readFile(tmp)
    const probeFrames = scanFrames(probe).frames
    if (probeFrames.length < 2) throw new Error('rewrite validation failed: expected at least a header frame and an events frame')
    const probeFirst = zstdDecompressSync(probe.subarray(probeFrames[0].start, probeFrames[0].end)).toString('utf8')
    if (probeFirst.length === 0 || probeFirst.indexOf('\n') !== probeFirst.length - 1) {
      throw new Error('rewrite validation failed: first frame is not exactly one header line')
    }
  }
  const handle = await open(tmp, 'r+')
  await handle.sync()
  await handle.close()
  await rename(tmp, filePath)
  return { removed: events.length - cut, kept: cut }
}

/** Reset the in-memory views that derive from the spliced live log. */
async function resetLiveSession(ctx, attached) {
  attached.eventsSnapshot = undefined
  // Request/context folds and derived messages are incremental caches. After
  // the log is truncated in place their cursors point past the new tail, so
  // they must be folded again from scratch (otherwise the next request can
  // read a stale header or, worse, an undefined one).
  attached.headerFold = undefined
  attached.headerFoldSeq = 0
  attached.contextFold = undefined
  attached.contextFoldSeq = 0
  attached.derived = []
  attached.derivedNodes = 0
  attached.derivedGeneration = -1
  const surface = attached.surfaceManager
  if (surface !== undefined) {
    surface._state = { nodes: [], replaceGeneration: 0 }
    surface._lastProcessedSeq = surface.baseSeq - 1
    surface._pendingPlan = undefined
  }
  const projections = ctx.get('sessionProjections')
  if (projections !== undefined && projections.registrations !== undefined) {
    for (const registration of projections.registrations.values()) {
      if (registration !== undefined && registration.cells !== undefined && typeof registration.cells.delete === 'function') {
        registration.cells.delete(attached)
      }
    }
  }
  const cache = ctx.get('sessionProjectionCache')
  if (cache !== undefined && typeof cache.write === 'function') {
    try { await cache.write(attached) } catch { /* cache rewrites on next flush */ }
  }
}

/**
 * Find the durable JSONL write handle backing one live session. On dsh
 * 0.1.5-rc.1 the per-session durable cursor moved onto the backend tracker's
 * live write handle (`persistence.tracker.writers`); the 0.1.2
 * `persistence.coordinator.states` map is gone. Returns the handle together
 * with its mutable state: the handle's `observedLength` guard must move with
 * the cursor, or a later read rejects the shortened log as "shrunk".
 */
function liveCursorFor(persistence, sessionId) {
  const tracker = persistence.tracker
  const writers = tracker && tracker.writers
  const handle = writers && typeof writers.get === 'function' ? writers.get(sessionId) : undefined
  if (handle === undefined || handle === null) return undefined
  const state = handle.state
  if (state === undefined || !Number.isSafeInteger(state.cursor)) return undefined
  return { handle, state }
}

/**
 * Read one stored (not live) session through the persistence seam. dsh
 * 0.1.5-rc.1 replaced the old `inspect(id)` convenience with the handle seam:
 * `open(id, 'read')` + `handle.read()` for the full contiguous log, with the
 * stored header on the handle. The handle is closed on every path.
 */
async function readStoredSession(persistence, sessionId) {
  const handle = await persistence.open(sessionId, 'read')
  try {
    const { events } = await handle.read()
    return { events, meta: handle.header }
  } finally {
    await handle.close()
  }
}

/**
 * The live Session's event log across host shapes: `log` on dsh 0.1.5-rc.1,
 * the older `events` array on 0.1.2-rc.1.
 */
function sessionEvents(session) {
  if (Array.isArray(session.log)) return session.log
  if (Array.isArray(session.events)) return session.events
  return []
}

/**
 * Rebuild one Agent runtime-context projection from the spliced log. It keeps
 * a `retained` pointer into the old surface; after truncation that pointer can
 * reference a removed event, so replay the same constructor scan.
 */
function refreshRuntimeContext(runtimeContext, session) {
  if (runtimeContext === undefined || runtimeContext === null || typeof runtimeContext !== 'object') return
  const surface = new Set(session.surface.nodes)
  runtimeContext.retained = undefined
  const events = sessionEvents(session)
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type !== 'user/message') continue
    const source = event.data && event.data.source
    if (!source || source.kind !== 'plugin' || source.plugin !== '@deepseek-ai/dsh-system-prompt') continue
    runtimeContext.retained ??= null
    if (surface.has(event.seq)) {
      const block = Array.isArray(event.data.content) ? event.data.content[0] : undefined
      runtimeContext.retained = {
        seq: event.seq,
        text: block && block.type === 'text' ? block.text : undefined
      }
      break
    }
  }
}

/** Re-anchor the idle Agent loop to the log's new last turn after a splice. */
function rewindAgentPhase(agent, session) {
  if (agent === undefined || agent.phase === undefined || agent.phase === null || agent.phase.kind !== 'idle') return
  const lastTurn = sessionEvents(session).findLast((event) => event.type === 'turn/start')?.data.turn ?? 0
  agent.phase.lastTurn = lastTurn
  // `requestHeaderLogged` tells buildRequest whether it may feed the last
  // persisted request header back through requestProposal(). If the cut
  // removed every request/header, the boolean must return to false, otherwise
  // requestProposal(undefined) throws exactly the adapterDefaults TypeError.
  if (typeof agent.requestHeaderLogged === 'boolean') {
    agent.requestHeaderLogged = session.requestHeader() !== undefined
  }
  refreshRuntimeContext(agent.runtimeContext, session)
}

/**
 * Drop trailing inbox-insert records from a cut. They belong to the turn we
 * are about to delete; keeping them would make a restarted session replay a
 * stale queued prompt that no removal event follows.
 */
function trimTrailingInboxSplices(events, cut) {
  while (cut > 0 && events[cut - 1].type === 'agent/inbox/spliced') cut--
  return cut
}

async function rollback(ctx, args) {
  const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : null
  const atSeq = args && Number.isSafeInteger(args.atSeq) ? args.atSeq : null
  if (sessionId === null || atSeq === null) return { ok: false, code: 'invalid-args', message: '无效的回退参数' }

  const sessions = ctx.get('sessions')
  const persistence = ctx.get('sessionPersistence')
  const agents = ctx.get('agents')
  if (sessions === undefined || persistence === undefined) {
    return { ok: false, code: 'unavailable', message: '会话服务不可用' }
  }

  const agent = agents === undefined ? undefined : agents.get(sessionId)
  if (agent !== undefined && agent.status === 'running') {
    return { ok: false, code: 'agent-running', message: '会话正在运行中,请等待本轮结束再回退' }
  }
  if (agent !== undefined && agent.phase !== undefined && agent.phase !== null && agent.phase.kind !== 'idle') {
    return { ok: false, code: 'agent-busy', message: '会话正在处理后台任务,请稍后再回退' }
  }

  const attached = sessions.get(sessionId)
  let events
  let header
  let liveCursorState
  if (attached !== undefined) {
    events = sessionEvents(attached)
    header = attached.header
    if (interruptedTurnClosers(events).length > 0) {
      return { ok: false, code: 'turn-open', message: '当前还有未结束的回合，请等本轮结束后再回退' }
    }
    await sessions.flush(attached)
    // The JSONL backend keeps an in-memory durable cursor on the live write
    // handle that must be rewound together with the live Session log. Without
    // this, the next append's contiguity check compares against the stale
    // cursor and rejects every event below it, leaving a permanent seq gap in
    // the rewritten log.
    const live = liveCursorFor(persistence, sessionId)
    if (live === undefined) {
      return { ok: false, code: 'live-rollback-unsupported', message: '当前运行中的会话暂不支持安全回退，请关闭会话后重试' }
    }
    liveCursorState = live
  } else {
    let inspected
    try {
      inspected = await readStoredSession(persistence, sessionId)
    } catch (error) {
      return { ok: false, code: 'session-not-found', message: String(error && error.message || error) }
    }
    if (inspected === undefined) return { ok: false, code: 'session-not-found', message: '找不到会话' }
    events = inspected.events
    header = inspected.meta
  }

  if (header.origin === 'subagent') {
    return { ok: false, code: 'subagent-session', message: '子代理会话不支持回退' }
  }

  const lastSeq = events.length > 0 ? events[events.length - 1].seq : -1
  let boundary = events.find((event) => event.type === 'turn/end' && event.seq >= atSeq)
  if (boundary === undefined && atSeq > lastSeq) {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === 'turn/end') { boundary = events[i]; break }
    }
  }
  if (boundary === undefined) {
    return {
      ok: false,
      code: 'turn-unavailable',
      message: atSeq <= lastSeq ? '该回合尚未完成,不能作为回退点' : '会话还没有已完成的回合'
    }
  }
  let cut = boundary.seq + 1
  while (cut < events.length && events[cut].type !== 'turn/start') cut++
  cut = trimTrailingInboxSplices(events, cut)
  if (cut >= events.length) {
    return { ok: false, code: 'nothing-to-remove', message: '该回退点之后没有内容' }
  }

  const location = persistence.locate(header)
  if (location === undefined || typeof location.path !== 'string') {
    return { ok: false, code: 'locate-failed', message: '无法定位会话日志文件' }
  }

  let rewritten
  try {
    rewritten = await rewriteLogFile(location.path, cut)
  } catch (error) {
    return { ok: false, code: 'rewrite-failed', message: String(error && error.message || error) }
  }

  if (attached !== undefined) {
    if (cut > liveCursorState.state.cursor) {
      return { ok: false, code: 'live-rollback-out-of-sync', message: '会话日志已变化，请刷新页面后重试' }
    }
    try {
      attached.log.splice(cut)
      liveCursorState.state.cursor = cut
      if (typeof liveCursorState.handle.observedLength === 'number') {
        liveCursorState.handle.observedLength = Math.min(liveCursorState.handle.observedLength, cut)
      }
      await resetLiveSession(ctx, attached)
      rewindAgentPhase(agent, attached)
    } catch (error) {
      console.error('[conversation-rollback] live session surgery failed:', error)
    }
  }

  return { ok: true, removed: rewritten.removed, kept: rewritten.kept }
}

/**
 * Codex-style edit-and-resend: rewind the log to just before the chosen
 * completed turn, then deliver the edited human message through the normal
 * Agent inbox so the model regenerates the answer in the same session.
 */
async function editTurn(ctx, args) {
  const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : null
  const turn = args && Number.isSafeInteger(args.turn) ? args.turn : null
  const text = args && typeof args.text === 'string' ? args.text : null
  if (sessionId === null || turn === null || text === null || text.trim().length === 0) {
    return { ok: false, code: 'invalid-args', message: '无效的编辑参数' }
  }

  const sessions = ctx.get('sessions')
  const persistence = ctx.get('sessionPersistence')
  const agents = ctx.get('agents')
  if (sessions === undefined || persistence === undefined || agents === undefined) {
    return { ok: false, code: 'unavailable', message: '会话服务不可用' }
  }

  const agent = agents.get(sessionId)
  const attached = sessions.get(sessionId)
  if (agent === undefined || attached === undefined) {
    return { ok: false, code: 'edit-requires-open-session', message: '请先打开要编辑的会话' }
  }
  if (agent.status === 'running') {
    return { ok: false, code: 'agent-running', message: '会话正在运行中,请等待本轮结束再编辑' }
  }
  if (agent.phase === undefined || agent.phase === null || agent.phase.kind !== 'idle') {
    return { ok: false, code: 'agent-busy', message: '会话正在处理后台任务,请稍后再编辑' }
  }

  const events = sessionEvents(attached)
  const header = attached.header
  if (header.origin === 'subagent') {
    return { ok: false, code: 'subagent-session', message: '子代理会话不支持编辑' }
  }
  if (interruptedTurnClosers(events).length > 0) {
    return { ok: false, code: 'turn-open', message: '当前还有未结束的回合，请等本轮结束后再编辑' }
  }

  const turnStartIndex = events.findIndex((event) => event.type === 'turn/start' && event.data && event.data.turn === turn)
  if (turnStartIndex < 0) return { ok: false, code: 'turn-not-found', message: '找不到要编辑的回合' }
  const turnEnd = events.slice(turnStartIndex).find((event) => event.type === 'turn/end' && event.data && event.data.turn === turn)
  if (turnEnd === undefined) return { ok: false, code: 'turn-not-completed', message: '该回合尚未完成,不能编辑' }

  const cut = trimTrailingInboxSplices(events, turnStartIndex)
  if (cut <= 0) return { ok: false, code: 'unsafe-prefix', message: '该回合之前没有可保留的历史，暂不能安全编辑' }
  const prefix = events.slice(0, cut)
  if (interruptedTurnClosers(prefix).length > 0) {
    return { ok: false, code: 'unsafe-prefix', message: '该回合之前存在未结束的步骤，暂不能安全编辑' }
  }

  const liveCursorState = liveCursorFor(persistence, sessionId)
  if (liveCursorState === undefined) {
    return { ok: false, code: 'live-rollback-unsupported', message: '当前运行中的会话暂不支持安全编辑，请关闭会话后重试' }
  }

  await sessions.flush(attached)

  const location = persistence.locate(header)
  if (location === undefined || typeof location.path !== 'string') {
    return { ok: false, code: 'locate-failed', message: '无法定位会话日志文件' }
  }

  let rewritten
  try {
    rewritten = await rewriteLogFile(location.path, cut)
  } catch (error) {
    return { ok: false, code: 'rewrite-failed', message: String(error && error.message || error) }
  }

  if (cut > liveCursorState.state.cursor) {
    return { ok: false, code: 'live-rollback-out-of-sync', message: '会话日志已变化，请刷新页面后重试' }
  }

  try {
    attached.log.splice(cut)
    liveCursorState.state.cursor = cut
    if (typeof liveCursorState.handle.observedLength === 'number') {
      liveCursorState.handle.observedLength = Math.min(liveCursorState.handle.observedLength, cut)
    }
    await resetLiveSession(ctx, attached)
    rewindAgentPhase(agent, attached)
  } catch (error) {
    console.error('[conversation-rollback] edit session surgery failed:', error)
    return { ok: false, code: 'edit-surgery-failed', message: String(error && error.message || error) }
  }

  try {
    if (agent.inbox && typeof agent.inbox.clear === 'function') agent.inbox.clear()
    const message = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text }]
    })
    agent.followup(message)
  } catch (error) {
    return { ok: false, code: 'edit-drive-failed', message: '历史已回退，但新消息发送失败：' + String(error && error.message || error) }
  }

  return { ok: true, removed: rewritten.removed, kept: rewritten.kept, turn }
}

export const name = 'conversation-rollback'
export const inject = ['webServer']

export function apply(ctx) {
  const webServer = ctx.webServer

  /**
   * The host settings service, once present. It is resolved through `inject`
   * rather than a top-level import of `@deepseek-ai/dsh-settings` on purpose:
   * a build without that package must not take this plugin's whole host half
   * down at module-link time (the same failure mode v1.4.1 hit on the session
   * package's removed codec). Absent service = the route answers
   * `settings-unavailable` and the client keeps the rail at its default.
   */
  let settingsService

  ctx.inject(['settings'], (settingsCtx) => {
    // The service scopes the registration to this plugin's fiber itself, so an
    // unload releases the namespace without extra bookkeeping here.
    settingsCtx.settings.register(SETTINGS_NS, PluginSettings)
    settingsService = settingsCtx.settings
  })

  /**
   * Resolve the current settings view from the settings service.
   * @returns `{ outline, revision }`, or undefined while no settings service
   *   (or no registration) is reachable.
   */
  function settingsView() {
    if (settingsService === undefined) return undefined
    let descriptor
    try {
      descriptor = settingsService.describe({ redactSecrets: true })
        .find((entry) => entry.ns === SETTINGS_NS)
    } catch (error) {
      return undefined
    }
    if (descriptor === undefined) return undefined
    return {
      outline: descriptor.value === undefined || descriptor.value.outline !== false,
      revision: descriptor.revision
    }
  }

  /** `settings.get`: the client's hydration read. */
  function readSettings() {
    const view = settingsView()
    if (view === undefined) {
      return { ok: false, code: 'settings-unavailable', message: '当前 DSH 未提供设置服务，大纲开关不可用' }
    }
    return { ok: true, ...view }
  }

  /** `settings.update`: revision-guarded merge of one boolean. */
  async function writeSettings(body) {
    const patch = body.patch
    if (patch === null || typeof patch !== 'object' || typeof patch.outline !== 'boolean') {
      return INVALID_SETTINGS_PATCH
    }
    if (settingsService === undefined) {
      return { ok: false, code: 'settings-unavailable', message: '当前 DSH 未提供设置服务，大纲开关不可用' }
    }
    try {
      await settingsService.update(SETTINGS_NS, { outline: patch.outline }, body.expectedRevision)
    } catch (error) {
      // Duck-typed on the service's stable machine code: importing the error
      // class would reintroduce the module-link hazard described above.
      if (error !== null && typeof error === 'object' && error.code === 'SETTINGS_CONFLICT') {
        // Hand back the current revision so the caller's retry stays guarded.
        const current = settingsView()
        return {
          ok: false,
          code: 'settings-conflict',
          message: '设置已在别处被修改，请重试',
          ...(current === undefined ? {} : current)
        }
      }
      return { ok: false, code: 'settings-failed', message: String(error && error.message || error) }
    }
    const view = settingsView()
    if (view === undefined) {
      return { ok: false, code: 'settings-unavailable', message: '设置写入后无法回读' }
    }
    return { ok: true, ...view }
  }

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/api/conversation-rollback',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      const origin = req.headers.origin
      if (origin !== undefined && new URL(origin).host !== req.headers.host) {
        res.writeHead(403)
        res.end()
        return
      }
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      let body = null
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { /* handled below */ }
      let result
      if (body === null) {
        result = { ok: false, code: 'bad-json', message: '请求体必须是 JSON' }
      } else {
        try {
          if (body.operation === 'edit') result = await editTurn(ctx, body)
          else if (body.operation === 'settings.get') result = readSettings()
          else if (body.operation === 'settings.update') result = await writeSettings(body)
          else result = await rollback(ctx, body)
        } catch (error) {
          result = { ok: false, code: 'internal', message: String(error && error.message || error) }
        }
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(result))
    }
  }), 'conversation-rollback: route')
}

export default { name, inject, apply }
