/*
 * Smoke test for the MERGED lib/client.js, without a browser.
 *
 * It stubs window/document/react just enough to load the bundle, calls the
 * merged apply() against fake `sessions`/`slots` services, and drives the real
 * store code: window → outline projection, prepend paging, reference stability,
 * the loadOlder guards, and the self-carried scroll anchor. It also pins the
 * merge itself: both features must register, and the rail must survive a
 * rollback half that throws. Run from the package root:  node test/smoke.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'
// Structures the plugin builds live in the vm realm, so their prototypes differ
// from the test realm's: deep-equality checks go through the loose assert.
import loose from 'node:assert'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')

const rendered = []
let loaded = null

function makeElement(tag) {
  return {
    tagName: tag,
    children: [],
    style: {},
    dataset: {},
    attrs: {},
    className: '',
    textContent: '',
    offsetWidth: 0,
    isConnected: true,
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 500,
    classList: { add() {}, remove() {}, contains() { return false } },
    setAttribute(key, value) {
      this.attrs[key] = value
      // The real DOM reflects `data-*` attributes into `dataset`. Both halves of
      // this bundle mark their stylesheet's ownership — one through `dataset`,
      // one through `setAttribute` — so the stub must reflect it or the two
      // conventions look different here while being identical in a browser.
      if (key.startsWith('data-')) {
        this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value
      }
    },
    getAttribute(key) { return this.attrs[key] },
    appendChild(child) { this.children.push(child); return child },
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } },
    querySelectorAll() { return [] },
    get firstElementChild() { return this.children[0] || null },
  }
}

/** The scroll host the plugin resolves via document.querySelectorAll. */
let scrollHost = null

const documentStub = {
  createElement: (tag) => makeElement(tag),
  head: makeElement('head'),
  body: makeElement('body'),
  // Honour only the plugin's own style-dedupe lookup; everything else (the
  // side-card host) stays absent.
  querySelector: (selector) => {
    const match = /^style\[data-plugin-css=(?:"|')(.*?)(?:"|')\]$/.exec(selector)
    if (match === null) return null
    return documentStub.head.children.find((element) => element.dataset.pluginCss === match[1]) || null
  },
  querySelectorAll: (selector) => (selector === '[data-conversation-scroll]' && scrollHost !== null ? [scrollHost] : []),
}

const windowStub = {
  innerWidth: 1280,
  addEventListener() {},
  removeEventListener() {},
  // Synchronous frames: the anchor restore's double rAF must land before the
  // awaited loadOlder() resolves.
  requestAnimationFrame: (callback) => {
    callback()
    return 0
  },
  cancelAnimationFrame() {},
  setInterval: () => 0,
  clearInterval() {},
  setTimeout: () => 0,
  clearTimeout() {},
  localStorage: { getItem: () => null, setItem() {} },
  __ModuleLoader__: { load: (record) => { loaded = record } },
}

const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  // The real hook returns the current snapshot on the first render; the stub
  // does the same so a component under test can be invoked directly.
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  useState: (initial) => [initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useMemo: (factory) => factory(),
  useEffect: () => {},
}

const sandbox = { window: windowStub, document: documentStub, console }
vm.createContext(sandbox)
vm.runInContext(source, sandbox)
assert.ok(loaded, 'the bundle registers itself with __ModuleLoader__')
// One bundle, one entry: the rail merged INTO this package rather than shipping
// beside it, because the loader serves a single client.js per plugin entry.
assert.equal(loaded.id, 'conversation-rollback')

const bundle = loaded.factory((name) => {
  if (name === 'react') return reactStub
  if (name === 'react-dom/client') return { createRoot: () => { const root = { render: (element) => { rendered.push(element) }, unmount() { root.unmounted = true } }; return root } }
  throw new Error('unexpected require: ' + name)
})
// Upstream owns the exports tail, so the service list is upstream's (order included).
loose.deepEqual(bundle.inject, ['slots', 'sessions'])
assert.equal(typeof bundle.apply, 'function')
assert.ok(source.includes('function applyAll'), 'the merged apply wraps both halves')

// ------------------------------------------------------------------ fixtures

const text = (value) => ({ type: 'text', text: value })

function makeChat(messages) {
  const nodes = new Map()
  const order = []
  const timeline = { turnOrder: [], turns: new Map() }
  messages.forEach((message, position) => {
    // Node keys are unique per node, not per turn (one turn can carry a prompt
    // plus a steer plus an image-only prompt).
    const key = `4:${message.kind || 'user'}#${message.turn}-${position}`
    order.push(key)
    nodes.set(key, {
      kind: message.kind || 'user',
      location: { kind: 'turn', turn: { turn: message.turn } },
      data: { content: message.content },
    })
    if (!timeline.turns.has(message.turn)) {
      timeline.turnOrder.push(message.turn)
      timeline.turns.set(message.turn, { turn: message.turn, start: { time: 1700000000000 + message.turn * 60000 } })
    }
  })
  // A tool row and a context row sit in the flow and must never reach the outline.
  order.push('9:tool-call#1')
  nodes.set('9:tool-call#1', { kind: 'tool-call', location: { kind: 'step', turn: { turn: 3 } }, data: {} })
  order.push('7:context#1')
  nodes.set('7:context#1', { kind: 'context', location: { kind: 'turn', turn: { turn: 3 } }, data: { content: [text('注入的上下文')] } })
  return { order, nodes: { get: (key) => nodes.get(key), values: () => [...nodes.values()] }, timeline, locations: { getTurn: () => [] } }
}

function makeSession(id, initial, options) {
  const state = { messages: [...initial], hasMore: options.hasMore, notifyCount: 0 }
  const listeners = new Set()
  const session = {
    getSnapshot() {
      // `omitChat` models DSH >= 0.1.2-rc.1, whose session snapshot carries no
      // `chat` field (the Chat target is a separate view target).
      return {
        sessionId: id,
        ...(options.omitChat ? {} : { chat: makeChat(state.messages) }),
        hasMore: state.hasMore,
        loadingOlder: false,
        running: false,
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /** Fire a notification with unchanged content (the churn the store must absorb). */
    poke() {
      state.notifyCount++
      listeners.forEach((listener) => listener())
    },
    async loadOlder() {
      if (!state.hasMore || state.loadingOlder) return
      state.loadingOlder = true
      await Promise.resolve()
      state.messages = [...options.older, ...state.messages]
      state.hasMore = false
      state.loadingOlder = false
      if (options.onPrepend) options.onPrepend()
      listeners.forEach((listener) => listener())
    },
  }
  return { session, state }
}

function makeSessions(id, initial, options) {
  const { session, state } = makeSession(id, initial, options)
  return {
    session,
    sessionState: state,
    list: {
      getSnapshot: () => ({ current: id, byId: { [id]: { id, displayTitle: 't' } } }),
      subscribe() { return () => {} },
    },
    binding: (candidate) => (candidate === id ? { session } : undefined),
  }
}

/**
 * A `slots` service that behaves like the real one for an already-declared slot:
 * `inject(name, cb)` runs `cb` synchronously (in the host it runs inside the
 * slot owner's own register()). Every registration is recorded — that is how the
 * merge is pinned, and it is the reason `get('slots')` is wired here: the rail
 * guards on `ctx.get('slots')`, so a stub that omits it silently skips its only
 * registration instead of failing.
 *
 * `subscribe(name, listener)` records the entry-mutation watches (the takeover's
 * registration path); `fireSlotsChanged()` delivers one mutation so a case can
 * model the official `user` renderer registering after this plugin activated.
 * `uiConversation` exposes the per-session Chat view target the rail reads on
 * DSH >= 0.1.2-rc.1.
 */
function makeCtx(sessions, options = {}) {
  const effects = []
  const registrations = []
  const subscriptions = []
  const chatTargetNames = []
  let officialUser = options.officialUser !== false
  const chatTarget = {
    getSnapshot: () => (options.chat !== undefined ? options.chat : sessions.session.getSnapshot().chat),
    subscribe(listener) { return sessions.session.subscribe(listener) },
  }
  const uiConversation = options.chatTarget === false ? undefined : {
    binding: () => ({ target: (name) => { chatTargetNames.push(name); return chatTarget } }),
  }
  const slots = {
    inject(name, callback) {
      registrations.push({ via: 'inject', name })
      callback()
      return () => {}
    },
    register(options, component) {
      registrations.push({ via: 'register', name: options.name, id: options.id, key: options.key, priority: options.priority, order: options.order, component })
      return () => {}
    },
    subscribe(name, listener) {
      subscriptions.push({ name, listener })
      return () => {}
    },
    // Rollback wraps the built-in `user` Chat Node view; hand it an original so
    // the takeover branch runs instead of being skipped.
    entries(name) {
      if (name !== 'conversation.chat.node' || !officialUser) return []
      return [{ options: { key: 'user' }, component: function OriginalUserMessageNodeView() { return null } }]
    },
  }
  const localeListeners = new Set()
  let activeLocale = options.locale === undefined ? 'zh' : options.locale
  const locale = {
    getSnapshot: () => ({ active: activeLocale, revision: 0 }),
    subscribe(listener) {
      localeListeners.add(listener)
      return () => localeListeners.delete(listener)
    },
  }
  return {
    effects,
    registrations,
    subscriptions,
    chatTargetNames,
    slots,
    setOfficialUser(value) { officialUser = value },
    fireSlotsChanged() { subscriptions.forEach((entry) => entry.listener()) },
    /** Drive the harness language switch (the real one emits `locale/change` too). */
    setLocale(next) {
      activeLocale = next
      localeListeners.forEach((listener) => listener())
    },
    get: (name) => (name === 'sessions' ? sessions : name === 'slots' ? slots : name === 'uiConversation' ? uiConversation : name === 'locale' ? locale : undefined),
    effect: (fn) => { effects.push(fn()) },
  }
}

// ------------------------------------------------------------------- cases

const sessions = makeSessions('s1', [
  { turn: 3, content: [text('第三轮：跑一下测试')] },
  { turn: 4, content: [text('第四轮：\n把失败项修好')] },
  { turn: 5, kind: 'steering', content: [text('中途引导')] },
  { turn: 5, content: [text('   ')] },
  { turn: 6, content: [{ type: 'image', attachment: { attachmentId: 'a1' } }] },
], {
  hasMore: true,
  older: [{ turn: 1, content: [text('第一轮：项目初始化')] }, { turn: 2, content: [text('第二轮：加个 TOC')] }],
})

const ctx = makeCtx(sessions)
bundle.apply(ctx)

// --- the merge itself -------------------------------------------------------
// One activation must wire BOTH features, in the order applyAll defines them.
// The `user`-node takeover is NOT an inject row any more: it installs from the
// entry-mutation watch, because the official renderer registers later.
loose.deepEqual(
  ctx.registrations.filter((entry) => entry.via === 'inject').map((entry) => entry.name),
  [
    'conversation.chat.user-actions',
    'conversation.chat.assistant-actions',
    'conversation.session.header.utilities',
    'settings.general.item',
  ],
  'rollback registers its action slots, the rail adds its header toggle and the outline switch its settings row',
)
const takeover = ctx.registrations.filter((entry) => entry.via === 'register' && entry.name === 'conversation.chat.node')
assert.equal(takeover.length, 1, 'rollback registers exactly one user-node takeover')
assert.equal(takeover[0].key, 'user')
assert.equal(takeover[0].priority, -1, 'the takeover keeps its priority — the rail did not shadow it')
assert.ok(
  ctx.subscriptions.some((entry) => entry.name === 'conversation.chat.node'),
  'the takeover watches conversation.chat.node entry mutations',
)

assert.equal(rendered.length, 1, 'the rail mounts exactly once')
const store = rendered[0].props.store
assert.ok(store && typeof store.getSnapshot === 'function', 'the rail receives the store')

let snapshot = store.getSnapshot()
assert.equal(snapshot.sessionId, 's1', 'the current session binds on activation')
loose.deepEqual(
  snapshot.rows.map((row) => [row.turn, row.text, row.steering]),
  [[3, '第三轮：跑一下测试', false], [4, '第四轮： 把失败项修好', false], [5, '中途引导', true]],
  'outline = user/steering nodes only; whitespace-only, image-only, tool and context rows dropped',
)
assert.equal(snapshot.hasMore, true)
assert.equal(snapshot.error, null)

// Reference stability: an unrelated notification must not rebuild the rows array.
const rowsBefore = snapshot.rows
sessions.session.poke()
assert.equal(store.getSnapshot().rows, rowsBefore, 'identical rows keep their identity (no re-render churn)')

// Backward paging: a prepend extends the outline backwards, oldest first.
assert.equal(await store.loadOlder(), true, 'loadOlder reports a real page pull')
snapshot = store.getSnapshot()
loose.deepEqual(snapshot.rows.map((row) => row.turn), [1, 2, 3, 4, 5], 'a prepend extends the outline backwards, oldest first')
assert.equal(snapshot.hasMore, false, 'hasMore mirrors the session window')
assert.equal(await store.loadOlder(), false, 'loadOlder is a no-op once the window is complete')

// A second activation (profile reload / HMR) mounts its own rail on its own session.
const otherCtx = makeCtx(makeSessions('s2', [{ turn: 1, content: [text('另一个会话')] }], { hasMore: false }))
bundle.apply(otherCtx)
assert.equal(rendered.length, 2, 'a fresh activation mounts its own rail')
const otherStore = rendered[1].props.store
assert.equal(otherStore.getSnapshot().sessionId, 's2')
loose.deepEqual(otherStore.getSnapshot().rows.map((row) => row.text), ['另一个会话'])

// The official `user` renderer can register AFTER this plugin activates (both
// halves only wait on slots/sessions), so the takeover must install on a later
// entry mutation instead of a one-shot lookup at apply time.
const lateCtx = makeCtx(
  makeSessions('s6', [{ turn: 1, content: [text('晚到的官方渲染器')] }], { hasMore: false }),
  { officialUser: false },
)
bundle.apply(lateCtx)
assert.equal(
  lateCtx.registrations.filter((entry) => entry.via === 'register' && entry.name === 'conversation.chat.node').length,
  0,
  'no takeover while the official renderer is absent',
)
lateCtx.setOfficialUser(true)
lateCtx.fireSlotsChanged()
const lateTakeover = lateCtx.registrations.filter((entry) => entry.via === 'register' && entry.name === 'conversation.chat.node')
assert.equal(lateTakeover.length, 1, 'a later official renderer still gets shadowed')
assert.equal(lateTakeover[0].priority, -1)
assert.ok(
  lateCtx.registrations.some((entry) => entry.via === 'inject' && entry.name === 'conversation.chat.user-actions'),
  'the edit action still targets the slot the takeover declares',
)

// The rail reads the per-session Chat target, not the session snapshot: on this
// DSH build the session snapshot carries no `chat` field at all.
const targetOnlySessions = makeSessions('s7', [
  { turn: 1, content: [text('目标源第一轮')] },
  { turn: 2, content: [text('目标源第二轮')] },
], { hasMore: false, omitChat: true })
const targetOnlyCtx = makeCtx(targetOnlySessions, {
  chat: makeChat([{ turn: 1, content: [text('目标源第一轮')] }, { turn: 2, content: [text('目标源第二轮')] }]),
})
bundle.apply(targetOnlyCtx)
assert.ok(targetOnlyCtx.chatTargetNames.includes('chat'), 'the rail resolves the per-session chat view target')
const targetOnlyStore = rendered[rendered.length - 1].props.store
loose.deepEqual(
  targetOnlyStore.getSnapshot().rows.map((row) => row.text),
  ['目标源第一轮', '目标源第二轮'],
  'rows come from the chat target even when the session snapshot has no chat field',
)

/**
 * A scroll host with one row per loaded Chat Node. Row tops are viewport
 * relative (flowTop − scrollTop), which is the exact arithmetic the plugin's
 * anchor capture/restore runs on. `layout(prefix)` re-lays the rows under a
 * prepend of `prefix` pixels of newly loaded history.
 */
function makeScrollHost(spec) {
  const host = makeElement('div')
  host.scrollTop = spec.scrollTop
  host.scrollHeight = spec.scrollHeight
  host.clientHeight = 500
  host.getBoundingClientRect = () => ({ top: 0, height: 500 })
  const rows = spec.rows.map((row) => {
    const element = makeElement('div')
    element.dataset.chatAnchorKey = row.key
    element._height = row.height
    element.getBoundingClientRect = () => ({ top: element._flowTop - host.scrollTop })
    return element
  })
  host.layout = (prefix) => {
    let top = prefix
    rows.forEach((element) => {
      element._flowTop = top
      top += element._height
    })
  }
  host.layout(0)
  host.querySelectorAll = (selector) => (selector === '[data-chat-anchor-key]' ? rows : [])
  return host
}

// Prepending a page we pull ourselves must not yank the reader: the core only
// re-anchors for its own 「加载更早」 button, so the rail carries its own anchor.
const midScrollHost = makeScrollHost({
  scrollTop: 0,
  scrollHeight: 1000,
  rows: [{ key: '4:user#1-0', height: 300 }, { key: '4:user#2-1', height: 200 }],
})
scrollHost = midScrollHost
const midCtx = makeCtx(makeSessions('s3', [
  { turn: 1, content: [text('第一轮')] },
  { turn: 2, content: [text('第二轮')] },
], {
  hasMore: true,
  older: [{ turn: 0, content: [text('第零轮')] }],
  onPrepend: () => midScrollHost.layout(400),
}))
bundle.apply(midCtx)
const midStore = rendered[rendered.length - 1].props.store
assert.equal(midStore.getSnapshot().rows.length, 2, 'the mid-scroll session projects its own outline')
assert.equal(midScrollHost.scrollTop, 0)
assert.equal(await midStore.loadOlder(), true)
assert.equal(midScrollHost.scrollTop, 400, 'the first visible row keeps its viewport offset across a prepend')

// Pinned to the tail, the core's own follow owns the position — no second writer.
const tailHost = makeScrollHost({
  scrollTop: 500,
  scrollHeight: 1000,
  rows: [{ key: '4:user#1-0', height: 300 }, { key: '4:user#2-1', height: 200 }],
})
scrollHost = tailHost
const tailCtx = makeCtx(makeSessions('s4', [
  { turn: 1, content: [text('第一轮')] },
  { turn: 2, content: [text('第二轮')] },
], {
  hasMore: true,
  older: [{ turn: 0, content: [text('第零轮')] }],
  onPrepend: () => tailHost.layout(400),
}))
bundle.apply(tailCtx)
const tailStore = rendered[rendered.length - 1].props.store
assert.equal(await tailStore.loadOlder(), true)
assert.equal(tailHost.scrollTop, 500, 'stuck to the tail: the rail leaves the scroll alone')
scrollHost = null

// --- styles -----------------------------------------------------------------
// dsh-client-hmr reclaims exactly `style[data-plugin="<loader entry name>"]` on
// a hot swap, so after the merge BOTH stylesheets must carry the merged name.
const styleTags = documentStub.head.children.filter((element) => element.tagName === 'style')
for (const tag of styleTags) {
  assert.equal(tag.dataset.plugin, 'conversation-rollback', 'every injected <style> is owned by the merged entry name')
}
const railTags = styleTags.filter((element) => element.dataset.pluginCss === 'conversation-rollback/session-toc.css')
const rollbackTags = styleTags.filter((element) => element.dataset.pluginCss === 'conversation-rollback/rollback.css')
assert.equal(railTags.length, 1, 'four activations still inject one rail stylesheet (the plugin-css guard dedupes)')
assert.ok(railTags[0].textContent.includes('dsh-toc-root'), 'the rail stylesheet body was injected')
assert.ok(rollbackTags.length >= 1, 'the rollback half still injects its own stylesheet')

// A rail that throws must not take the rollback surface down with it.
const hostileCtx = makeCtx(makeSessions('s5', [{ turn: 1, content: [text('只有 rollback 该活下来')] }], { hasMore: false }))
const registerOriginal = hostileCtx.slots.register
hostileCtx.slots.register = (options, component) => {
  if (options.name === 'conversation.session.header.utilities') throw new Error('simulated rail failure')
  return registerOriginal(options, component)
}
assert.doesNotThrow(() => bundle.apply(hostileCtx), 'a throwing rail is contained; the rollback half survives it')

// --- the outline switch (Settings -> General) --------------------------------
// The preference is a real user setting (host settings namespace
// `conversation-rollback`, persisted in settings.yaml). The client reaches it
// through this plugin's own route, so the read/write contract below is what the
// settings row, the rail and the header button all share.
const visible = (state) => Boolean(state.outlineKnown && state.outline)

const settingsRow = ctx.registrations.find((entry) => entry.via === 'register' && entry.name === 'settings.general.item')
assert.ok(settingsRow, 'the outline switch registers one row on the settings General page')
assert.equal(settingsRow.id, 'session-outline')
assert.equal(settingsRow.order, 20, 'the row lands beside the built-in appearance rows')

// This sandbox has no fetch at all: the read must fail closed to "known +
// enabled", never to a hidden rail (a missing settings service is not an
// instruction to remove a feature).
const offline = store.getSnapshot()
assert.equal(offline.outlineKnown, true, 'an unreachable settings route still resolves the preference')
assert.equal(offline.outline, true, 'no reachable settings route leaves the rail at its default (on)')
assert.equal(offline.outlineUnavailable, true, 'the row is told to report the missing settings service')
assert.equal(visible(offline), true, 'the rail stays visible when the preference cannot be read')

// With a reachable route: read on mount, write on demand, revision-guarded.
const calls = []
const replies = []
const cached = new Map()
windowStub.localStorage = {
  getItem: (key) => (cached.has(key) ? cached.get(key) : null),
  setItem: (key, value) => { cached.set(key, value) },
  removeItem: (key) => { cached.delete(key) },
}
windowStub.fetch = (url, init) => {
  calls.push({ url, body: JSON.parse(init.body) })
  return Promise.resolve({ json: () => Promise.resolve(replies.shift()) })
}
const flush = () => new Promise((resolve) => setImmediate(resolve))

replies.push({ ok: true, outline: false, revision: 4 })
const prefCtx = makeCtx(makeSessions('s6', [{ turn: 1, content: [text('开关用例')] }], { hasMore: false }))
bundle.apply(prefCtx)
const prefStore = rendered[rendered.length - 1].props.store
assert.equal(prefStore.getSnapshot().outlineKnown, false, 'the rail waits for the preference instead of flashing on')
await flush()
assert.equal(calls[0].body.operation, 'settings.get', 'the mount effect hydrates from the host setting')
assert.equal(prefStore.getSnapshot().outline, false, 'a stored "off" keeps the rail off')
assert.equal(visible(prefStore.getSnapshot()), false, 'a switched-off outline hides the rail and its header button')
assert.equal(cached.get('conversation-rollback:outline'), '0', 'the value is mirrored locally')

replies.push({ ok: true, outline: true, revision: 5 })
assert.equal(await prefStore.setOutline(true), true, 'the switch reports a successful write')
const write = calls[calls.length - 1]
assert.equal(write.url, '/api/conversation-rollback')
assert.equal(write.body.operation, 'settings.update')
assert.equal(write.body.patch.outline, true)
assert.equal(write.body.expectedRevision, 4, 'the write carries the revision it read')
assert.equal(prefStore.getSnapshot().outline, true, 'the switch adopts the host response')
assert.equal(prefStore.getSnapshot().outlineError, null)
assert.equal(visible(prefStore.getSnapshot()), true, 'turning it back on brings the rail back')
assert.equal(cached.get('conversation-rollback:outline'), '1')

// A concurrent edit elsewhere must not silently diverge: the conflict is shown
// and the document is re-read.
replies.push({ ok: false, code: 'settings-conflict' })
replies.push({ ok: true, outline: false, revision: 9 })
assert.equal(await prefStore.setOutline(false), false, 'a revision conflict reports failure')
await flush()
await flush()
assert.equal(calls[calls.length - 1].body.operation, 'settings.get', 'the conflict re-reads the settings document')
assert.equal(prefStore.getSnapshot().outline, false, 'the re-read wins over the optimistic switch')

// The row itself, rendered against the store it shares with the rail. With no
// primitives build in this sandbox it must fall back to a plain checkbox — the
// path a build without `@deepseek-ai/dsh-client-ui-primitives` would take.
const collectNodes = (root) => {
  const found = []
  ;(function walk(node) {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (typeof node !== 'object') return
    found.push(node)
    walk(node.children)
  })(root)
  return found
}
const rowRecord = prefCtx.registrations.find((entry) => entry.via === 'register' && entry.name === 'settings.general.item')
const rowLabel = () => collectNodes(rowRecord.component()).find((node) => node.props && node.props.className === 'dsh-toc-setting-title')
const nodes = collectNodes(rowRecord.component())
const checkbox = nodes.find((node) => node.type === 'input')
assert.ok(checkbox, 'the row renders a control even without the harness switch primitive')
assert.equal(checkbox.props.checked, prefStore.getSnapshot().outline, 'the control shows the live value')
assert.equal(checkbox.props.disabled, false, 'the control is operable while the settings service answers')
const title = rowLabel()
assert.ok(title && title.children.includes('会话大纲'), 'the row carries its localized label')
replies.push({ ok: true, outline: true, revision: 12 })
checkbox.props.onChange({ target: { checked: true } })
await flush()
assert.equal(prefStore.getSnapshot().outline, true, 'clicking the row writes through the store to the host')
assert.equal(calls[calls.length - 1].body.operation, 'settings.update', 'and that write is a settings.update')

// --- the row follows the harness language switch -----------------------------
// The dictionary is swapped IN PLACE on the object every component captured, and
// the store emit is what re-renders mounted readers: without both, the settings
// row keeps the language it was created in (the reported bug).
prefCtx.setLocale('en-US')
assert.ok(
  rowLabel().children.includes('Session outline'),
  'the settings row follows a language switch without a reload',
)
assert.equal(prefStore.getSnapshot().locale, 'en', 'the locale change pokes the store so mounted readers re-render')
assert.ok(
  collectNodes(rowRecord.component()).find((node) => node.props && node.props.className === 'dsh-toc-setting-desc')
    .children.join('').startsWith('Show the prompt outline rail'),
  'the row description follows too',
)

// The rail's own copy rides the same object: the header button re-renders in the
// new language as well.
const headerRecord = ctx.registrations.find((entry) => entry.via === 'register' && entry.name === 'conversation.session.header.utilities')
assert.equal(headerRecord.component().props.title, '显示/隐藏会话目录', 'the header button starts in Chinese')
ctx.setLocale('en')
assert.equal(headerRecord.component().props.title, 'Show / hide session outline', 'the rail header button follows the language switch')
ctx.setLocale('zh-CN')
assert.equal(headerRecord.component().props.title, '显示/隐藏会话目录', 'and switches back')
prefCtx.setLocale('zh')
assert.ok(rowLabel().children.includes('会话大纲'), 'the row switches back to Chinese too')

// The localStorage mirror is what keeps the NEXT load flash-free: a cold start
// with a cached "off" hides the rail before the round-trip resolves.
cached.set('conversation-rollback:outline', '0')
replies.push({ ok: true, outline: false, revision: 10 })
const cachedCtx = makeCtx(makeSessions('s7', [{ turn: 1, content: [text('缓存用例')] }], { hasMore: false }))
bundle.apply(cachedCtx)
const cachedStore = rendered[rendered.length - 1].props.store
assert.equal(cachedStore.getSnapshot().outlineKnown, true, 'a cached value counts as known at first paint')
assert.equal(visible(cachedStore.getSnapshot()), false, 'the cached "off" hides the rail immediately')
await flush()
assert.equal(cachedStore.getSnapshot().outline, false, 'the host read agrees with the cache')
cached.delete('conversation-rollback:outline')
windowStub.fetch = undefined

// Disposal runs every effect disposer without throwing.
const disposables = [ctx, otherCtx, midCtx, tailCtx, hostileCtx, lateCtx, targetOnlyCtx, prefCtx, cachedCtx]
disposables.forEach((scope) => scope.effects.forEach((dispose) => { if (typeof dispose === 'function') dispose() }))
assert.ok(Array.isArray(store.getSnapshot().rows), 'disposal leaves the store readable')

console.log('smoke: all assertions passed')
