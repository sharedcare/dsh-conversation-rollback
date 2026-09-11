/*
 * Host-half test for the outline switch: the `/api/conversation-rollback` route
 * and its settings namespace.
 *
 * The host half cannot run bare (its three imports live inside a DSH install),
 * so `test/host-stubs.mjs` supplies in-memory stand-ins through a
 * `module.register` hook, and the settings service below mirrors the host
 * contract read out of dsh-settings@0.1.5-rc.1:
 *
 *   register(ns, schema, options) -> { get, watch, update, replace }
 *   describe(options)             -> [{ ns, schema, value, revision, applies }]
 *   update(ns, patch, expectedRevision)
 *        merges over the user section, validates through the schema, bumps the
 *        revision, and rejects a stale write with code SETTINGS_CONFLICT.
 *
 * What this pins: the switch is a real user setting (host-owned and
 * revision-guarded), an absent settings service degrades to a reported
 * `settings-unavailable` instead of a thrown error, and dispatch for the
 * existing rollback/edit callers is unchanged.
 *
 * Run from the package root:  node test/host-route.mjs
 */
import assert from 'node:assert/strict'
import * as nodeModule from 'node:module'

// Map the host half's three unresolvable imports to in-memory stubs before it
// is loaded. `registerHooks` is the current in-process API; `register` keeps the
// suite runnable on Node versions that predate it.
if (typeof nodeModule.registerHooks === 'function') {
  const hooks = await import('./host-stubs.mjs')
  nodeModule.registerHooks({ resolve: hooks.resolve, load: hooks.load })
} else {
  nodeModule.register('./host-stubs.mjs', import.meta.url)
}

const ROUTE = '/api/conversation-rollback'
const NS = 'conversation-rollback'

const { apply } = await import('../lib/index.js')

/** The settings service, as the host implements it. */
function makeSettingsService() {
  const registrations = new Map()
  let section = {}
  const service = {
    registrations,
    register(ns, schema) {
      assert.equal(ns, NS, 'a plugin may only register its own namespace')
      assert.equal(registrations.has(ns), false, 'a duplicate registration must fail loud')
      const registration = { ns, schema, revision: 0, resolved: schema({ ...section }) }
      registrations.set(ns, registration)
      return {
        get: () => registration.resolved,
        update: (patch) => service.update(ns, patch),
      }
    },
    describe() {
      return [...registrations.values()].map((entry) => ({
        ns: entry.ns,
        schema: entry.schema.toJSON(),
        value: entry.resolved,
        revision: entry.revision,
      }))
    },
    async update(ns, patch, expectedRevision) {
      const registration = registrations.get(ns)
      if (expectedRevision !== undefined && expectedRevision !== registration.revision) {
        const error = new Error(`settings "${ns}" moved`)
        error.code = 'SETTINGS_CONFLICT'
        error.expected = expectedRevision
        error.actual = registration.revision
        throw error
      }
      section = { ...section, ...patch }
      registration.resolved = registration.schema(section)
      registration.revision += 1
      return registration.resolved
    },
  }
  return service
}

/** Wire one activation; `withSettings: false` models a build without the service. */
function activate({ withSettings = true } = {}) {
  const routes = []
  const service = withSettings ? makeSettingsService() : null
  const ctx = {
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    inject(deps, callback) {
      if (service !== null && deps.includes('settings')) callback({ settings: service })
    },
    effect(fn) {
      return fn()
    },
    get() {
      return undefined
    },
  }
  apply(ctx)
  assert.equal(routes.length, 1, 'one HTTP route registered')
  assert.equal(routes[0].kind, 'exact')
  assert.equal(routes[0].path, ROUTE)
  const handler = routes[0].handler

  async function post(body, { method = 'POST', origin } = {}) {
    const raw = typeof body === 'string' ? body : JSON.stringify(body)
    const req = {
      method,
      headers: {
        host: '127.0.0.1:43120',
        origin: origin === undefined ? 'http://127.0.0.1:43120' : origin,
      },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(raw)
      },
    }
    let status = 0
    let payload = null
    const res = {
      writeHead(code) {
        status = code
      },
      end(text) {
        payload = text === undefined ? null : JSON.parse(text)
      },
    }
    await handler(req, res)
    return { status, payload }
  }

  return { service, post }
}

// --- read / write round-trip -------------------------------------------------
const withService = activate()
let res = await withService.post({ operation: 'settings.get' })
assert.equal(res.status, 200)
assert.deepEqual(res.payload, { ok: true, outline: true, revision: 0 }, 'the default is ON at revision 0')

res = await withService.post({ operation: 'settings.update', patch: { outline: false } })
assert.deepEqual(res.payload, { ok: true, outline: false, revision: 1 }, 'the write merges and bumps the revision')

res = await withService.post({ operation: 'settings.get' })
assert.deepEqual(res.payload, { ok: true, outline: false, revision: 1 }, 'the read reflects the write')

// --- the registered schema ---------------------------------------------------
const registration = withService.service.registrations.get(NS)
assert.ok(registration, 'activation registers the namespace')
assert.deepEqual(registration.schema({}), { outline: true }, 'an empty section resolves to the default (on)')
assert.deepEqual(registration.schema({ outline: false }), { outline: false })
assert.throws(() => registration.schema({ outline: 'yes' }), 'a non-boolean is refused by the schema')
assert.ok(registration.schema.toJSON() !== undefined, 'the schema serializes for the settings document')

// --- revision guard ----------------------------------------------------------
res = await withService.post({ operation: 'settings.update', patch: { outline: true }, expectedRevision: 0 })
assert.equal(res.payload.ok, false, 'a stale revision is refused')
assert.equal(res.payload.code, 'settings-conflict')
assert.equal(res.payload.outline, false, 'the conflict answer carries the live value')
assert.equal(res.payload.revision, 1, 'and the live revision, so the caller can retry guarded')

res = await withService.post({ operation: 'settings.update', patch: { outline: true }, expectedRevision: 1 })
assert.deepEqual(res.payload, { ok: true, outline: true, revision: 2 }, 'a fresh revision is accepted')

// --- refusals ----------------------------------------------------------------
res = await withService.post({ operation: 'settings.update', patch: { outline: 'yes' } })
assert.deepEqual(res.payload, { ok: false, code: 'invalid-args', message: 'patch.outline 必须是布尔值' })
res = await withService.post({ operation: 'settings.update' })
assert.equal(res.payload.code, 'invalid-args', 'a missing patch is refused, never coerced')
res = await withService.post('{not json')
assert.equal(res.payload.code, 'bad-json')
res = await withService.post({ operation: 'settings.get' }, { origin: 'http://evil.example' })
assert.equal(res.status, 403, 'cross-origin stays refused')
res = await withService.post({ operation: 'settings.get' }, { method: 'GET' })
assert.equal(res.status, 405)

// --- existing callers are untouched -----------------------------------------
res = await withService.post({})
assert.equal(res.payload.code, 'invalid-args', 'no operation still dispatches to rollback')
assert.equal(res.payload.message, '无效的回退参数', 'rollback keeps its own copy')
res = await withService.post({ operation: 'edit' })
assert.equal(res.payload.message, '无效的编辑参数', 'the edit path is still reached')

// --- no settings service (a build without it) --------------------------------
const withoutService = activate({ withSettings: false })
res = await withoutService.post({ operation: 'settings.get' })
assert.equal(res.payload.code, 'settings-unavailable', 'an absent settings service is reported, not thrown')
res = await withoutService.post({ operation: 'settings.update', patch: { outline: false } })
assert.equal(res.payload.code, 'settings-unavailable')

console.log('host-route: all assertions passed')
