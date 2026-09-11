    var React = require('react')
    var ReactDOMClient = require('react-dom/client')
    var h = React.createElement

    // The harness's own switch, resolved from the shared module table (the same
    // way this bundle resolves react). Purely optional: a build without it falls
    // back to a plain checkbox, so the settings row never depends on it.
    var primitives = null
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    } catch (error) {
      primitives = null
    }

    var LOG = '[conversation-rollback/session-toc]'
    // Must be the MERGED package name: that is the loader entry name HMR
    // addresses, and the value `removeOwnedStyles` matches in `data-plugin`
    // (dsh-client-hmr client.js:26-29). A stale 'dsh-session-toc' here would
    // make the style tag unreclaimable now that the two plugins are one.
    var PLUGIN_ID = 'conversation-rollback'
    var CSS_TAG = 'conversation-rollback/session-toc.css'
    // Key kept from the standalone plugin on purpose: existing pinned rails
    // survive the merge, and the namespace is still unique.
    var STORE_PINNED = 'dsh-session-toc:pinned'
    // The outline preference is a real user setting (host settings service,
    // namespace `conversation-rollback`), reached through this plugin's own
    // route. localStorage only mirrors the last known value so the rail paints
    // deterministically on load instead of flashing while the read is in flight.
    var STORE_OUTLINE = 'conversation-rollback:outline'
    var SETTINGS_ROUTE = '/api/conversation-rollback'
    var SETTINGS_TIMEOUT_MS = 4000
    var SETTINGS_WRITE_TIMEOUT_MS = 8000
    var MAX_OLDER_PAGES = 40
    var ROW_CLAMP = 140

    // ----------------------------------------------------------------- copy

    var COPY = {
      zh: {
        title: '目录',
        toggle: '显示/隐藏会话目录',
        empty: '这个会话还没有你的提问',
        search: '搜索提问…',
        jump: '跳转到这一轮',
        more: '载入更早',
        loading: '载入中…',
        allLoaded: '已载入全部历史',
        noMatch: '已载入范围内没有匹配',
        pagingHint: '正在向更早翻页以寻找匹配…',
        notVisible: '当前视图不是聊天视图，切回「聊天」后再跳转',
        pageFailed: '载入更早失败',
        footTurns: '条提问',
        settingsTitle: '会话大纲',
        settingsDesc: '在聊天右侧显示提问目录条，可展开搜索并跳转到任意一轮',
        settingsUnavailable: '当前 DSH 未提供设置服务，开关暂不可用',
        settingsConflict: '设置已在别处被修改，请重试',
        settingsFailed: '保存失败',
      },
      en: {
        title: 'Outline',
        toggle: 'Show / hide session outline',
        empty: 'No prompts in this session yet',
        search: 'Search prompts…',
        jump: 'Jump to this turn',
        more: 'Load earlier',
        loading: 'Loading…',
        allLoaded: 'All history loaded',
        noMatch: 'No match in the loaded window',
        pagingHint: 'Paging backwards to find a match…',
        notVisible: 'The chat view is not active — switch back to Chat to jump',
        pageFailed: 'Failed to load earlier history',
        footTurns: 'prompts',
        settingsTitle: 'Session outline',
        settingsDesc: 'Show the prompt outline rail on the right of the chat — expand it to search and jump to any turn',
        settingsUnavailable: 'This DSH build exposes no settings service; the switch is unavailable',
        settingsConflict: 'Settings changed elsewhere — try again',
        settingsFailed: 'Could not save',
      },
    }

    // ------------------------------------------------------------------ css

    var CSS = [
      '.dsh-toc-root{position:fixed;top:50%;transform:translateY(-50%);z-index:45;display:flex;align-items:flex-start;gap:6px;pointer-events:none;',
      'font-family:var(--dsw-font-family-base,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif)}',
      '.dsh-toc-strip{pointer-events:auto;display:flex;flex-direction:column;align-items:center;gap:7px;width:26px;padding:8px 2px;',
      'border:1px solid var(--dsw-alias-border-l1,#e2e8f0);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);',
      'box-shadow:0 4px 16px rgba(2,8,23,.12);opacity:.55;transition:opacity .15s ease;',
      // Height tracks the conversation band, so a side-card bottom panel never
      // slides over the rail (`--dsh-toc-band` is written by the geometry effect).
      'max-height:min(72vh, var(--dsh-toc-band, 72vh));overflow:hidden}',
      '.dsh-toc-root:hover{opacity:1}.dsh-toc-root:hover .dsh-toc-strip,.dsh-toc-strip.on{opacity:1}',
      '.dsh-toc-strip-btn{width:18px;height:18px;padding:0;border:none;border-radius:6px;background:transparent;cursor:pointer;',
      'color:var(--dsw-alias-label-secondary,#64748b);font-size:12px;line-height:18px}',
      '.dsh-toc-strip-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,#0f172a)}',
      '.dsh-toc-ticks{display:flex;flex-direction:column;align-items:center;gap:3px;width:100%;overflow:hidden}',
      '.dsh-toc-tick{flex:none;width:14px;height:3px;border:none;border-radius:2px;padding:0;cursor:pointer;',
      'background:var(--dsw-alias-border-l2,#cbd5e1);transition:background .12s ease,width .12s ease}',
      '.dsh-toc-tick:hover{background:var(--dsw-alias-brand-primary,#2563eb);width:16px}',
      '.dsh-toc-tick.active{background:var(--dsw-alias-brand-primary,#2563eb);width:16px}',
      '.dsh-toc-tick.more{height:12px;background:linear-gradient(180deg,var(--dsw-alias-border-l2,#cbd5e1),transparent)}',
      '.dsh-toc-panel{pointer-events:auto;display:flex;flex-direction:column;width:300px;max-height:min(72vh, var(--dsh-toc-band, 72vh));',
      'border:1px solid var(--dsw-alias-border-l1,#e2e8f0);border-radius:14px;background:var(--dsw-alias-bg-overlay,#fff);',
      'box-shadow:0 14px 40px rgba(2,8,23,.22);overflow:hidden}',
      '.dsh-toc-head{display:flex;align-items:center;gap:8px;padding:9px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#e2e8f0)}',
      '.dsh-toc-title{flex:1;font-size:13px;font-weight:650;color:var(--dsw-alias-label-primary,#0f172a)}',
      '.dsh-toc-icon-btn{width:22px;height:22px;flex:none;border:none;border-radius:6px;background:transparent;cursor:pointer;',
      'color:var(--dsw-alias-label-secondary,#64748b);font-size:13px;line-height:22px}',
      '.dsh-toc-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,#0f172a)}',
      '.dsh-toc-search{width:100%;box-sizing:border-box;border:none;outline:none;padding:8px 12px;font-size:12.5px;',
      'background:transparent;color:var(--dsw-alias-label-primary,#0f172a);border-bottom:1px solid var(--dsw-alias-border-l1,#e2e8f0)}',
      '.dsh-toc-list{flex:1;min-height:0;overflow-y:auto;padding:5px}',
      '.dsh-toc-row{display:flex;align-items:flex-start;gap:8px;width:100%;text-align:left;border:none;background:transparent;',
      'cursor:pointer;padding:6px 8px;border-radius:9px;color:inherit}',
      '.dsh-toc-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}',
      '.dsh-toc-row.active{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16))}',
      '.dsh-toc-row-n{flex:none;min-width:24px;text-align:right;padding-top:1px;font-size:11px;font-variant-numeric:tabular-nums;',
      'color:var(--dsw-alias-label-caption,#94a3b8)}',
      '.dsh-toc-row-main{min-width:0;flex:1}',
      '.dsh-toc-row-t{font-size:12.5px;line-height:1.45;color:var(--dsw-alias-label-primary,#0f172a);display:-webkit-box;',
      '-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}',
      '.dsh-toc-row-m{font-size:10.5px;color:var(--dsw-alias-label-caption,#94a3b8);margin-top:2px}',
      '.dsh-toc-empty{padding:14px 12px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#94a3b8)}',
      '.dsh-toc-foot{display:flex;align-items:center;gap:8px;padding:7px 10px;border-top:1px solid var(--dsw-alias-border-l1,#e2e8f0);',
      'font-size:11.5px;color:var(--dsw-alias-label-secondary,#64748b)}',
      '.dsh-toc-foot-btn{flex:none;border:1px solid var(--dsw-alias-border-l1,#e2e8f0);border-radius:9px;background:transparent;',
      'cursor:pointer;padding:3px 9px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#64748b)}',
      '.dsh-toc-foot-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary,#0f172a);background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}',
      '.dsh-toc-foot-note{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-toc-header-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:none;',
      'border-radius:8px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#64748b);font-size:13px}',
      '.dsh-toc-header-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}',
      '.dsh-toc-header-btn.on{color:var(--dsw-alias-brand-primary,#2563eb)}',
      '.dsh-toc-setting{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:12px 0}',
      '.dsh-toc-setting-text{min-width:0;display:grid;gap:4px}',
      '.dsh-toc-setting-title{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#0f172a)}',
      '.dsh-toc-setting-desc{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#94a3b8)}',
      '.dsh-toc-setting-error{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error,#dc2626)}',
      '.dsh-toc-flash{animation:dsh-toc-flash 1.3s ease}',
      '@keyframes dsh-toc-flash{0%{background:rgba(37,99,235,.18)}100%{background:transparent}}',
      '.dsh-toc-bar{position:fixed;left:8px;bottom:8px;z-index:2147483000;max-width:70vw;padding:8px 12px;font:12px/1.5 ui-monospace,monospace;',
      'color:#f2a1a1;background:#1b1b22;border:1px solid #f2a1a1;border-radius:8px;white-space:pre-wrap}',
    ].join('')

    // --------------------------------------------------------------- helpers

    function textOf(content) {
      if (!Array.isArray(content)) return ''
      var parts = []
      for (var i = 0; i < content.length; i++) {
        var block = content[i]
        if (!block) continue
        if ((block.type === 'text' || block.kind === 'text') && typeof block.text === 'string') parts.push(block.text)
      }
      return parts.join(' ')
    }

    function oneLine(value) {
      return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
    }

    function turnOf(location) {
      if (!location) return null
      if (location.kind !== 'turn' && location.kind !== 'step') return null
      var turn = location.turn && location.turn.turn
      return typeof turn === 'number' && isFinite(turn) ? turn : null
    }

    function timeOfTurn(chat, turn) {
      if (turn === null || !chat || !chat.timeline || !chat.timeline.turns) return null
      var record = null
      try {
        record = typeof chat.timeline.turns.get === 'function' ? chat.timeline.turns.get(turn) : null
      } catch (error) {
        return null
      }
      var event = record && (record.end || record.start)
      if (event && event.event && typeof event.event.time === 'number') return event.event.time
      return event && typeof event.time === 'number' ? event.time : null
    }

    function clockOf(ms) {
      if (typeof ms !== 'number') return ''
      var d = new Date(ms)
      var now = new Date()
      var hh = d.getHours()
      var mm = d.getMinutes()
      var sameDay = d.getFullYear() === now.getFullYear() && d.getDate() === now.getDate() && d.getMonth() === now.getMonth()
      var clock = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm
      if (sameDay) return clock
      var mo = d.getMonth() + 1
      var day = d.getDate()
      return (mo < 10 ? '0' : '') + mo + '/' + (day < 10 ? '0' : '') + day + ' ' + clock
    }

    /** One outline row per Chat Node the user sent (a plain prompt or a steer). */
    function buildOutline(chat) {
      var rows = []
      if (!chat || !Array.isArray(chat.order) || !chat.nodes || typeof chat.nodes.get !== 'function') return rows
      for (var i = 0; i < chat.order.length; i++) {
        var key = chat.order[i]
        var node = null
        try {
          node = chat.nodes.get(key)
        } catch (error) {
          node = null
        }
        if (!node || (node.kind !== 'user' && node.kind !== 'steering')) continue
        var text = oneLine(textOf(node.data && node.data.content))
        if (text === '') continue
        var turn = turnOf(node.location)
        rows.push({
          key: String(key),
          turn: turn,
          steering: node.kind === 'steering',
          text: text,
          time: timeOfTurn(chat, turn),
        })
      }
      return rows
    }

    function sameRows(left, right) {
      if (left === right) return true
      if (!left || !right || left.length !== right.length) return false
      for (var i = 0; i < left.length; i++) {
        if (left[i].key !== right[i].key || left[i].text !== right[i].text) return false
      }
      return true
    }

    function matches(row, needle) {
      if (needle === '') return true
      return row.text.toLowerCase().indexOf(needle) !== -1
            || (row.turn !== null && String(row.turn) === needle)
    }

    function getScroller() {
      var all = document.querySelectorAll('[data-conversation-scroll]')
      if (!all.length) return null
      return all[all.length - 1]
    }

    /** Same lookup the core's own anchorElement() uses: rows carry data-chat-anchor-key. */
    function findRow(scroller, key) {
      var rows = scroller.querySelectorAll('[data-chat-anchor-key]')
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].dataset && rows[i].dataset.chatAnchorKey === key) return rows[i]
      }
      return null
    }

    function rowElements(scroller) {
      return Array.prototype.slice.call(scroller.querySelectorAll('[data-chat-anchor-key]'))
    }

    function jumpTo(key) {
      var scroller = getScroller()
      if (!scroller) return false
      var el = findRow(scroller, key)
      if (!el) return false
      var top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
      scroller.scrollTop = Math.max(0, Math.round(top - 16))
      try {
        el.classList.remove('dsh-toc-flash')
        void el.offsetWidth
        el.classList.add('dsh-toc-flash')
        window.setTimeout(function () {
          try {
            el.classList.remove('dsh-toc-flash')
          } catch (error) {}
        }, 1400)
      } catch (error) {}
      return true
    }

    /**
     * Remember the first row currently inside the scroll host, as
     * `<ui-conversation>'s own anchorRef>` does for its 「加载更早」 button
     * (CONV:5530-5542 + the compensation in CONV:5443-5455). Prepending a page
     * only ever adds rows ABOVE the anchor (node keys survive a prepend), so
     * the anchor's new viewport offset minus its old one is exactly the
     * scrollTop delta that keeps the reader where they were.
     *
     * Returns null while pinned to the tail: there the core's own tail-follow
     * owns the position (CONV:5456-5463) and a second writer would fight it.
     */
    function captureAnchor() {
      var scroller = getScroller()
      if (!scroller) return null
      var bottom = Math.max(0, scroller.scrollHeight - scroller.clientHeight) - scroller.scrollTop
      if (bottom <= 25) return null
      var host = scroller.getBoundingClientRect()
      var rows = scroller.querySelectorAll('[data-chat-anchor-key]')
      for (var i = 0; i < rows.length; i++) {
        var key = rows[i].dataset && rows[i].dataset.chatAnchorKey
        if (!key) continue
        var top = rows[i].getBoundingClientRect().top - host.top
        // The first row that has not scrolled past the host's top edge.
        if (top >= -1) return { scroller: scroller, key: key, top: top }
      }
      return null
    }

    /** Undo a page prepend's visual jump. See `captureAnchor`. */
    function restoreAnchor(anchor, atSecondFrame) {
      if (!anchor) return
      var done = function () {
        try {
          if (!anchor.scroller.isConnected) return
          var el = findRow(anchor.scroller, anchor.key)
          if (!el) return
          var delta = el.getBoundingClientRect().top - anchor.scroller.getBoundingClientRect().top - anchor.top
          if (delta !== 0) anchor.scroller.scrollTop += delta
        } catch (error) {}
      }
      if (typeof window.requestAnimationFrame !== 'function') {
        done()
        return
      }
      // One frame to let the prepend commit, one more to let layout settle.
      window.requestAnimationFrame(function () {
        if (atSecondFrame) done()
        else window.requestAnimationFrame(done)
      })
    }

    function readPinned() {
      try {
        return window.localStorage.getItem(STORE_PINNED) === '1'
      } catch (error) {
        return false
      }
    }

    function writePinned(value) {
      try {
        window.localStorage.setItem(STORE_PINNED, value ? '1' : '0')
      } catch (error) {}
    }

    function sleep(ms) {
      return new Promise(function (resolve) {
        window.setTimeout(resolve, ms)
      })
    }

    // -------------------------------------------------------------- settings

    /**
     * The outline preference shared by the rail, its header button and the
     * settings row.
     *
     * Source of truth is the HOST settings service (namespace
     * `conversation-rollback`, persisted in the harness home's settings.yaml);
     * this store reaches it through the plugin's own route. It keeps the read
     * in one place so the three readers cannot disagree, and mirrors the last
     * known value into localStorage purely to paint deterministically on load.
     *
     * Failure policy: an unreachable settings route leaves the rail at its
     * default (ON) and surfaces `unavailable` in the settings row, so a
     * missing settings service can never silently hide the feature.
     */
    function createOutlinePrefs(copy) {
      var listeners = {}
      var nextListener = 1
      var cached = readCache()
      var state = {
        known: cached !== null,
        enabled: cached === null ? true : cached,
        busy: false,
        unavailable: false,
        revision: undefined,
        error: null,
      }

      function readCache() {
        try {
          var raw = window.localStorage.getItem(STORE_OUTLINE)
          if (raw === '1') return true
          if (raw === '0') return false
          return null
        } catch (error) {
          return null
        }
      }

      function writeCache(value) {
        try {
          window.localStorage.setItem(STORE_OUTLINE, value ? '1' : '0')
        } catch (error) {}
      }

      function emit() {
        for (var id in listeners) {
          try {
            listeners[id]()
          } catch (error) {
            console.error(LOG, 'settings listener failed', error)
          }
        }
      }

      function set(patch) {
        var changed = false
        for (var key in patch) {
          if (state[key] !== patch[key]) {
            changed = true
            break
          }
        }
        if (!changed) return
        state = Object.assign({}, state, patch)
        emit()
      }

      function subscribe(listener) {
        var id = nextListener++
        listeners[id] = listener
        return function () {
          delete listeners[id]
        }
      }

      /** One route round-trip, aborted after `timeout` so a dead host cannot
       *  leave the rail invisible forever. */
      function call(body, timeout) {
        if (typeof window.fetch !== 'function') {
          return Promise.reject(new Error('fetch unavailable'))
        }
        var controller = typeof window.AbortController === 'function' ? new window.AbortController() : null
        var timer = null
        if (controller !== null) {
          timer = window.setTimeout(function () {
            controller.abort()
          }, timeout)
        }
        return window
          .fetch(SETTINGS_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            credentials: 'same-origin',
            signal: controller === null ? undefined : controller.signal,
          })
          .then(function (response) {
            return response.json()
          })
          .then(
            function (payload) {
              if (timer !== null) window.clearTimeout(timer)
              return payload
            },
            function (error) {
              if (timer !== null) window.clearTimeout(timer)
              throw error
            },
          )
      }

      /** Adopt one successful route payload. */
      function adopt(payload) {
        var enabled = payload.outline !== false
        writeCache(enabled)
        set({
          known: true,
          enabled: enabled,
          unavailable: false,
          revision: payload.revision,
          error: null,
        })
      }

      function load() {
        return call({ operation: 'settings.get' }, SETTINGS_TIMEOUT_MS).then(
          function (payload) {
            if (payload !== null && typeof payload === 'object' && payload.ok === true) {
              adopt(payload)
              return
            }
            set({ known: true, unavailable: true, error: null })
          },
          function () {
            set({ known: true, unavailable: true, error: null })
          },
        )
      }

      function setEnabled(enabled) {
        set({ busy: true, error: null })
        return call(
          { operation: 'settings.update', patch: { outline: enabled }, expectedRevision: state.revision },
          SETTINGS_WRITE_TIMEOUT_MS,
        ).then(
          function (payload) {
            set({ busy: false })
            if (payload !== null && typeof payload === 'object' && payload.ok === true) {
              adopt(payload)
              return true
            }
            set({
              error: payload !== null && typeof payload === 'object' && payload.code === 'settings-conflict'
                ? copy.settingsConflict
                : copy.settingsFailed,
            })
            // A conflict means someone else moved the namespace: re-read so the
            // switch shows the value the settings document actually carries.
            if (payload !== null && typeof payload === 'object' && payload.code === 'settings-conflict') void load()
            return false
          },
          function () {
            set({ busy: false, error: copy.settingsFailed })
            return false
          },
        )
      }

      return { getSnapshot: function () { return state }, subscribe: subscribe, load: load, setEnabled: setEnabled }
    }

    // ----------------------------------------------------------------- store

    /**
     * Session-bound outline store. It is the single writer of the rail's state:
     * the Chat target feeds `rows`, the session snapshot feeds
     * `hasMore/loadingOlder`, the UI writes `pinned/query/activeKey`.
     * `getSnapshot()` is reference-stable between notifications so React can
     * consume it through useSyncExternalStore.
     *
     * `chatTargetFor(binding)` resolves the session's Chat target source
     * (DSH >= 0.1.2-rc.1 exposes the Chat target as a per-session view target;
     * older builds carried it on the session snapshot as `snapshot.chat`).
     */
    function createStore(sessions, timer, chatTargetFor, prefs) {
      var listeners = {}
      var nextListener = 1
      var outline = prefs.getSnapshot()
      var state = {
        sessionId: null,
        rows: [],
        hasMore: false,
        loadingOlder: false,
        error: null,
        pinned: readPinned(),
        query: '',
        activeKey: null,
        // Outline preference: `outlineKnown` gates the first paint so the rail
        // never flashes on before a "disabled" setting has been read.
        outline: outline.enabled,
        outlineKnown: outline.known,
        outlineBusy: outline.busy,
        outlineUnavailable: outline.unavailable,
        outlineError: outline.error,
      }
      var boundId = null
      var boundSession = null
      var boundChat = null
      var unsubSession = null
      var unsubChat = null
      var unsubList = null
      var unsubPrefs = prefs.subscribe(function () {
        var next = prefs.getSnapshot()
        set({
          outline: next.enabled,
          outlineKnown: next.known,
          outlineBusy: next.busy,
          outlineUnavailable: next.unavailable,
          outlineError: next.error,
        })
      })
      var retryTimer = null
      var retryBudget = 40
      var disposed = false

      function emit() {
        for (var id in listeners) {
          try {
            listeners[id]()
          } catch (error) {
            console.error(LOG, 'listener failed', error)
          }
        }
      }

      function set(patch) {
        var changed = false
        for (var key in patch) {
          if (state[key] !== patch[key]) {
            changed = true
            break
          }
        }
        if (!changed) return
        state = Object.assign({}, state, patch)
        emit()
      }

      function subscribe(listener) {
        var id = nextListener++
        listeners[id] = listener
        return function () {
          delete listeners[id]
        }
      }

      function getSnapshot() {
        return state
      }

      function currentId() {
        try {
          return sessions.list.getSnapshot().current || null
        } catch (error) {
          return null
        }
      }

      /** Latest Chat target snapshot: the live view target first, the legacy
       * session-snapshot `chat` field as a fallback for older builds. */
      function chatSnapshot() {
        if (boundChat) {
          try {
            var chat = boundChat.getSnapshot()
            if (chat) return chat
          } catch (error) {}
        }
        if (!boundSession) return null
        try {
          var snapshot = boundSession.getSnapshot()
          return (snapshot && snapshot.chat) || null
        } catch (error) {
          return null
        }
      }

      function refresh() {
        if (!boundSession || disposed) return
        var snapshot = null
        try {
          snapshot = boundSession.getSnapshot()
        } catch (error) {
          return
        }
        var rows = buildOutline(chatSnapshot())
        set({
          rows: sameRows(state.rows, rows) ? state.rows : rows,
          hasMore: !!(snapshot && snapshot.hasMore),
          loadingOlder: !!(snapshot && snapshot.loadingOlder),
        })
      }

      function detachSession() {
        if (unsubSession) {
          try {
            unsubSession()
          } catch (error) {}
          unsubSession = null
        }
        if (unsubChat) {
          try {
            unsubChat()
          } catch (error) {}
          unsubChat = null
        }
        boundSession = null
        boundChat = null
      }

      function bind(id) {
        if (disposed) return
        if (id === boundId && (boundSession || retryBudget <= 0)) return
        detachSession()
        boundId = id || null
        var binding = null
        if (boundId) {
          try {
            binding = sessions.binding(boundId)
          } catch (error) {
            binding = null
          }
        }
        var session = binding && binding.session
        if (session && typeof session.subscribe === 'function' && typeof session.getSnapshot === 'function') {
          boundSession = session
          retryBudget = 40
          try {
            unsubSession = session.subscribe(function () {
              refresh()
            })
          } catch (error) {
            console.error(LOG, 'subscribe failed', error)
          }
        }
        // The Chat target lives outside the session snapshot on this build, so the
        // outline follows its own source; subscribing also activates the target.
        if (binding && typeof chatTargetFor === 'function') {
          try {
            var target = chatTargetFor(binding)
            if (target && typeof target.subscribe === 'function' && typeof target.getSnapshot === 'function') {
              boundChat = target
              unsubChat = target.subscribe(function () {
                refresh()
              })
            }
          } catch (error) {
            console.error(LOG, 'chat target unavailable', error)
          }
        }
        set({ sessionId: boundId, rows: [], hasMore: false, loadingOlder: false, activeKey: null, error: null })
        if (boundSession) refresh()
        else scheduleRetry()
      }

      /** The binding can lag the list feed right after a session opens. */
      function scheduleRetry() {
        if (disposed || boundSession || retryBudget <= 0) return
        retryBudget--
        var run = function () {
          if (disposed || boundSession) return
          var id = currentId()
          boundId = null
          bind(id)
        }
        if (timer && typeof timer.timeout === 'function') timer.timeout(run, 600)
        else retryTimer = window.setTimeout(run, 600)
      }

      function start() {
        try {
          unsubList = sessions.list.subscribe(function () {
            bind(currentId())
          })
        } catch (error) {
          console.error(LOG, 'list feed unavailable', error)
        }
        bind(currentId())
      }

      function dispose() {
        disposed = true
        if (unsubList) {
          try {
            unsubList()
          } catch (error) {}
          unsubList = null
        }
        if (unsubPrefs) {
          try {
            unsubPrefs()
          } catch (error) {}
          unsubPrefs = null
        }
        detachSession()
        if (retryTimer !== null) {
          window.clearTimeout(retryTimer)
          retryTimer = null
        }
        listeners = {}
      }

      /** Pull one older page. Resolves whether anything was actually pulled. */
      function loadOlder() {
        if (!boundSession || typeof boundSession.loadOlder !== 'function') return Promise.resolve(false)
        if (!state.hasMore || state.loadingOlder) return Promise.resolve(false)
        try {
          // The core re-anchors the viewport only for its own 「加载更早」
          // button, so a page pulled from here (the rail's button, or the
          // auto-paging a search triggers) must carry its own anchor or every
          // page yanks the reader somewhere else.
          var anchor = captureAnchor()
          return Promise.resolve(boundSession.loadOlder()).then(
            function () {
              set({ error: null })
              restoreAnchor(anchor)
              return true
            },
            function (error) {
              console.error(LOG, 'loadOlder failed', error)
              set({ error: String((error && error.message) || error) })
              return false
            },
          )
        } catch (error) {
          return Promise.resolve(false)
        }
      }

      function togglePinned() {
        var next = !state.pinned
        writePinned(next)
        set({ pinned: next })
      }

      return {
        subscribe: subscribe,
        getSnapshot: getSnapshot,
        set: set,
        start: start,
        dispose: dispose,
        loadOlder: loadOlder,
        togglePinned: togglePinned,
        /** Merge the next outline preference (host-owned, revision-guarded). */
        setOutline: prefs.setEnabled,
        /** Re-read the preference; the settings row calls this on entry. */
        refreshOutline: prefs.load,
      }
    }

    function useStore(store) {
      if (typeof React.useSyncExternalStore === 'function') {
        return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
      }
      var snapshot = store.getSnapshot()
      var setter = React.useState(snapshot)[1]
      React.useEffect(function () {
        return store.subscribe(function () {
          setter(store.getSnapshot())
        })
      }, [store])
      return snapshot
    }

    // ------------------------------------------------------------ components

    /** Collapse the tick list so a 900-turn session still fits the viewport. */
    function tickList(rows, activeKey) {
      var ticks = []
      if (!rows.length) return ticks
      var step = Math.max(1, Math.ceil(rows.length / ROW_CLAMP))
      for (var i = 0; i < rows.length; i += step) {
        ticks.push({ key: rows[i].key, label: rows[i].text, active: rows[i].key === activeKey })
      }
      var last = rows[rows.length - 1]
      if (!ticks.length || ticks[ticks.length - 1].key !== last.key) {
        ticks.push({ key: last.key, label: last.text, active: last.key === activeKey })
      }
      return ticks
    }

    function makeRail(store, copy) {
      function Rail() {
        var s = useStore(store)
        var hoverRef = React.useState(false)
        var hover = hoverRef[0]
        var setHover = hoverRef[1]
        var rightRef = React.useState(10)
        var right = rightRef[0]
        var setRight = rightRef[1]
        // Vertical anchor follows the conversation band's middle, so the rail
        // clears the session header, the sticky composer and the side card's
        // bottom panel. Null keeps the stylesheet's 50% fallback.
        var topRef = React.useState(null)
        var top = topRef[0]
        var setTop = topRef[1]
        var noticeRef = React.useState(null)
        var notice = noticeRef[0]
        var setNotice = noticeRef[1]
        var inputRef = React.useRef(null)
        var listRef = React.useRef(null)
        var rootRef = React.useRef(null)
        var expanded = s.pinned || hover
        var query = s.query.trim().toLowerCase()
        var rows = s.rows

        var shown = React.useMemo(function () {
          if (query === '') return rows
          return rows.filter(function (row) {
            return matches(row, query)
          })
        }, [rows, query])

        // Sit on the conversation column, never on the window. dsh-better-sidebar
        // takes its width OUT of the shell (`#root { margin-right: var(--dsh-sidebar-width) }`,
        // its own layout.css) and paints the fixed panel over the strip it just
        // vacated; DSH's own details column and that plugin's bottom panel
        // squeeze the same way. A window-anchored rail therefore lands exactly
        // under the panel. Anchoring on the scroll host's rect clears all of
        // them by construction, and avoids a z-index war (that plugin stacks
        // 50/52/55/60 for its own menus — out-ranking 60 would bury its menus).
        React.useEffect(function () {
          var frame = 0
          var observer = null
          var watched = null
          var measure = function () {
            frame = 0
            var scroller = getScroller()
            if (!scroller) return
            var rect = scroller.getBoundingClientRect()
            if (rect.width < 120 || rect.height < 120) return
            var next = Math.round(window.innerWidth - rect.right + 10)
            if (next < 4) next = 4
            setRight(next)
            setTop(Math.round(rect.top + rect.height / 2))
            // Keep the rail inside the conversation band vertically: the side
            // card's bottom panel squeezes this same column from below.
            if (rootRef.current && rootRef.current.style) {
              rootRef.current.style.setProperty('--dsh-toc-band', Math.round(Math.max(200, rect.height * 0.86)) + 'px')
            }
          }
          var schedule = function () {
            if (!frame) frame = window.requestAnimationFrame(measure)
          }
          var watch = function () {
            var scroller = getScroller()
            if (scroller === watched) return
            if (observer !== null) {
              observer.disconnect()
              observer = null
            }
            watched = scroller
            if (scroller && typeof window.ResizeObserver === 'function') {
              // Also fires THROUGH the open/close transition: the squeezed
              // column width animates, so the rail slides with it instead of
              // lagging a poll interval under the moving panel.
              observer = new window.ResizeObserver(schedule)
              observer.observe(scroller)
            }
            schedule()
          }
          watch()
          window.addEventListener('resize', schedule)
          var poll = window.setInterval(watch, 1000)
          return function () {
            if (frame) window.cancelAnimationFrame(frame)
            if (observer !== null) observer.disconnect()
            window.removeEventListener('resize', schedule)
            window.clearInterval(poll)
          }
        }, [])

        // Track the turn under the top edge of the scroll host.
        React.useEffect(function () {
          var el = null
          var frame = 0
          var cache = { rows: null, elements: null, scroller: null }
          var compute = function () {
            frame = 0
            var scroller = getScroller()
            if (!scroller) return
            var live = store.getSnapshot().rows
            if (!live.length) return
            // The cached rows go stale whenever the window changed OR the chat
            // view remounted (view tabs reuse the same scroll host), so the
            // cache is only trusted while its first row is still inside it.
            if (cache.scroller !== scroller || cache.rows !== live || (cache.elements[0] && !scroller.contains(cache.elements[0]))) {
              cache = { scroller: scroller, rows: live, elements: rowElements(scroller) }
            }
            var byKey = {}
            for (var i = 0; i < live.length; i++) byKey[live[i].key] = live[i].key
            var probe = scroller.getBoundingClientRect().top + 90
            var elements = cache.elements
            if (!elements.length) return
            // Binary search: document order is visual order, so tops ascend.
            var low = 0
            var high = elements.length - 1
            var best = -1
            while (low <= high) {
              var mid = (low + high) >> 1
              var top = elements[mid].getBoundingClientRect().top
              if (top <= probe) {
                best = mid
                low = mid + 1
              } else high = mid - 1
            }
            var active = null
            for (var j = best; j >= 0; j--) {
              var key = elements[j].dataset && elements[j].dataset.chatAnchorKey
              if (key && byKey[key] !== undefined) {
                active = key
                break
              }
            }
            if (active === null) active = live[0].key
            if (store.getSnapshot().activeKey !== active) store.set({ activeKey: active })
          }
          var schedule = function () {
            if (!frame) frame = window.requestAnimationFrame(compute)
          }
          var attach = function () {
            var scroller = getScroller()
            if (scroller === el) return
            if (el) el.removeEventListener('scroll', schedule)
            el = scroller
            cache = { rows: null, elements: null, scroller: null }
            if (el) el.addEventListener('scroll', schedule, { passive: true })
            schedule()
          }
          attach()
          var poll = window.setInterval(attach, 1200)
          return function () {
            if (el) el.removeEventListener('scroll', schedule)
            if (frame) window.cancelAnimationFrame(frame)
            window.clearInterval(poll)
          }
        }, [store])

        // A search with no hit in the loaded window keeps paging backwards.
        React.useEffect(function () {
          var needle = query
          if (needle === '') return
          var cancelled = false
          void (async function () {
            for (var page = 0; page < MAX_OLDER_PAGES; page++) {
              if (cancelled) return
              var current = store.getSnapshot()
              var hit = current.rows.some(function (row) {
                return matches(row, needle)
              })
              if (hit || !current.hasMore) return
              if (current.loadingOlder) {
                await sleep(400)
                continue
              }
              var pulled = await store.loadOlder()
              if (!pulled && !store.getSnapshot().hasMore) return
              await sleep(120)
            }
          })()
          return function () {
            cancelled = true
          }
        }, [query, store])

        // Ctrl/Cmd+Shift+O toggles the rail.
        React.useEffect(function () {
          var onKey = function (event) {
            if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'O' || event.key === 'o')) {
              event.preventDefault()
              store.togglePinned()
            }
          }
          window.addEventListener('keydown', onKey)
          return function () {
            window.removeEventListener('keydown', onKey)
          }
        }, [store])

        var jump = function (row) {
          if (jumpTo(row.key)) {
            store.set({ activeKey: row.key })
            setNotice(null)
          } else {
            setNotice(copy.notVisible)
            window.setTimeout(function () {
              setNotice(null)
            }, 2600)
          }
        }

        if (!s.sessionId || !rows.length) return null

        var ticks = tickList(rows, s.activeKey)

        // The host setting gates the whole feature. `outlineKnown` is false only
        // while the settings read is in flight (or before it starts): stay
        // invisible for those few milliseconds instead of flashing a rail the
        // user switched off. An unreachable settings route resolves to known +
        // enabled, so a missing settings service never hides the rail.
        if (!s.outlineKnown || !s.outline) return null

        return h(
          'div',
          {
            className: 'dsh-toc-root',
            ref: rootRef,
            style: { right: right + 'px', top: top === null ? '50%' : top + 'px' },
            onMouseEnter: function () {
              setHover(true)
            },
            onMouseLeave: function () {
              setHover(false)
            },
          },
          expanded
            ? h(
                'div',
                { className: 'dsh-toc-panel' },
                h(
                  'div',
                  { className: 'dsh-toc-head' },
                  h('div', { className: 'dsh-toc-title' }, copy.title + ' · ' + rows.length + ' ' + copy.footTurns),
                  s.hasMore
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsh-toc-icon-btn',
                          title: copy.more,
                          'aria-label': copy.more,
                          disabled: s.loadingOlder,
                          onClick: function () {
                            void store.loadOlder()
                          },
                        },
                        s.loadingOlder ? '…' : '⟳',
                      )
                    : null,
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-toc-icon-btn',
                      title: copy.toggle,
                      'aria-label': copy.toggle,
                      onClick: function () {
                        store.togglePinned()
                        setHover(false)
                      },
                    },
                    '×',
                  ),
                ),
                h('input', {
                  ref: inputRef,
                  className: 'dsh-toc-search',
                  type: 'search',
                  placeholder: copy.search,
                  value: s.query,
                  spellCheck: false,
                  onChange: function (event) {
                    store.set({ query: event.target.value })
                  },
                  onKeyDown: function (event) {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      store.set({ query: '' })
                    }
                  },
                }),
                h(
                  'div',
                  { className: 'dsh-toc-list', ref: listRef },
                  shown.length === 0
                    ? h('div', { className: 'dsh-toc-empty' }, query === '' ? copy.empty : copy.noMatch)
                    : shown.map(function (row, index) {
                        return h(
                          'button',
                          {
                            key: row.key,
                            type: 'button',
                            className: 'dsh-toc-row' + (row.key === s.activeKey ? ' active' : ''),
                            title: copy.jump,
                            onClick: function () {
                              jump(row)
                            },
                          },
                          h('span', { className: 'dsh-toc-row-n' }, row.turn === null ? index + 1 : row.turn),
                          h(
                            'span',
                            { className: 'dsh-toc-row-main' },
                            h('span', { className: 'dsh-toc-row-t' }, row.text),
                            h(
                              'span',
                              { className: 'dsh-toc-row-m' },
                              [row.steering ? 'steer' : null, clockOf(row.time)].filter(Boolean).join(' · '),
                            ),
                          ),
                        )
                      }),
                ),
                h(
                  'div',
                  { className: 'dsh-toc-foot' },
                  h('span', { className: 'dsh-toc-foot-note' }, s.hasMore ? (s.loadingOlder ? copy.loading : copy.pagingHint) : copy.allLoaded),
                  s.hasMore
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsh-toc-foot-btn',
                          disabled: s.loadingOlder,
                          onClick: function () {
                            void store.loadOlder()
                          },
                        },
                        copy.more,
                      )
                    : null,
                ),
                notice || s.error ? h('div', { className: 'dsh-toc-empty' }, notice || (copy.pageFailed + '：' + s.error)) : null,
              )
            : h(
                'div',
                { className: 'dsh-toc-strip' + (s.pinned ? ' on' : '') },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-toc-strip-btn',
                    title: copy.toggle,
                    'aria-label': copy.toggle,
                    onClick: function () {
                      store.togglePinned()
                    },
                  },
                  '☰',
                ),
                h(
                  'div',
                  { className: 'dsh-toc-ticks' },
                  ticks.map(function (tick) {
                    return h('button', {
                      key: tick.key,
                      type: 'button',
                      className: 'dsh-toc-tick' + (tick.active ? ' active' : ''),
                      title: tick.label,
                      onClick: function () {
                        jumpTo(tick.key)
                        store.set({ activeKey: tick.key })
                      },
                    })
                  }),
                  s.hasMore
                    ? h('button', {
                        type: 'button',
                        className: 'dsh-toc-tick more',
                        title: copy.more,
                        onClick: function () {
                          void store.loadOlder()
                        },
                      })
                    : null,
                ),
              ),
        )
      }
      return Rail
    }

    // ----------------------------------------------------------------- entry

    /** The dictionary bucket a locale id maps to ('en*' -> en, everything else -> zh). */
    function copyLangOf(active) {
      return String(active || '').indexOf('en') === 0 ? 'en' : 'zh'
    }

    function apply(ctx) {
      // The UI dictionary follows the ACTIVE locale, and it is a per-activation
      // clone that gets mutated in place rather than replaced: the rail, its
      // header button and the settings row capture this object when they are
      // built, so swapping the object would leave what is already mounted (the
      // settings row in particular) pinned to the language it was created in.
      var copy = Object.assign({}, COPY.zh)
      var copyLang = 'zh'

      function localeActive() {
        try {
          var locale = ctx.get('locale')
          if (locale && typeof locale.getSnapshot === 'function') {
            return locale.getSnapshot().active
          }
        } catch (error) {}
        return ''
      }

      copyLang = copyLangOf(localeActive())
      Object.assign(copy, copyLang === 'en' ? COPY.en : COPY.zh)

      var fail = function (phase, error) {
        console.error(LOG, phase + ' error:', error)
        try {
          var bar = document.createElement('div')
          bar.className = 'dsh-toc-bar'
          bar.textContent = LOG + ' ' + phase + ' error: ' + ((error && error.message) || error)
          document.body.appendChild(bar)
        } catch (ignored) {}
      }

      var sessions = ctx.get('sessions')
      if (!sessions || !sessions.list) {
        console.warn(LOG, 'sessions service unavailable — rail disabled')
        return
      }

      // Outline preference first: the store reads its initial value, and every
      // reader (rail, header button, settings row) goes through the store.
      var prefs = createOutlinePrefs(copy)
      var store = createStore(sessions, ctx.get('timer'), function (binding) {
        // The Conversation service owns the per-session view targets; resolve it
        // lazily, because it may activate after this plugin does.
        var uiConversation = ctx.get('uiConversation')
        if (!uiConversation || typeof uiConversation.binding !== 'function') return null
        return uiConversation.binding(binding).target('chat')
      }, prefs)

      // Follow the harness language switch. `locale.subscribe` is the service's
      // own change face (the `locale/change` context event is the equivalent
      // fallback). A change swaps the dictionary in place and pokes the store so
      // every mounted reader re-renders — including the settings row, which is
      // rendered by the official settings page rather than by this plugin's tree.
      function syncLocale() {
        var next = copyLangOf(localeActive())
        if (next === copyLang) return
        copyLang = next
        Object.assign(copy, next === 'en' ? COPY.en : COPY.zh)
        store.set({ locale: next })
      }

      try {
        var localeService = ctx.get('locale')
        if (localeService && typeof localeService.subscribe === 'function') {
          ctx.effect(function () {
            return localeService.subscribe(syncLocale)
          }, 'conversation-rollback: locale follow')
        } else if (typeof ctx.on === 'function') {
          ctx.effect(function () {
            var off = ctx.on('locale/change', syncLocale)
            return typeof off === 'function' ? off : function () {}
          }, 'conversation-rollback: locale follow')
        }
      } catch (error) {
        console.warn(LOG, 'locale follow unavailable:', error)
      }

      try {
        // Official style ownership: `style[data-plugin="<package name>"]` is what
        // dsh-client-hmr reclaims on a hot swap (dsh-client-hmr client.js:26-29
        // matches the attribute verbatim against the loader entry name), and the
        // `data-plugin-css` tag id dedupes a double activation. Anything else
        // leaves a stale <style> behind on every rebuild.
        if (!document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG) + ']')) {
          var style = document.createElement('style')
          style.dataset.plugin = PLUGIN_ID
          style.dataset.pluginCss = CSS_TAG
          style.textContent = CSS
          document.head.appendChild(style)
          ctx.effect(function () {
            return function () {
              style.remove()
            }
          }, 'dsh-session-toc: styles')
        }

        ctx.effect(function () {
          var root = null
          var host = null
          try {
            store.start()
            // Hydrate the outline preference from the host. Deliberately not
            // awaited: the rail stays hidden for this one round-trip and the
            // failure path (no settings service) resolves to "known + enabled".
            void store.refreshOutline()
            host = document.createElement('div')
            host.setAttribute('data-dsh-session-toc', '')
            document.body.appendChild(host)
            root = ReactDOMClient.createRoot(host)
            root.render(h(makeRail(store, copy), { store: store }))
          } catch (error) {
            fail('mount', error)
          }
          return function () {
            try {
              if (root) root.unmount()
            } catch (error) {}
            try {
              if (host) host.remove()
            } catch (error) {}
            store.dispose()
          }
        }, 'dsh-session-toc: rail mount')

        var slots = ctx.get('slots')
        if (slots && typeof slots.inject === 'function' && typeof slots.register === 'function') {
          ctx.effect(
            function () {
              return slots.inject('conversation.session.header.utilities', function () {
                // `slots.inject` runs this callback INSIDE the owner's own
                // register() call, so a throw here would take the conversation
                // header down with it. Registration stays best-effort: the rail
                // itself works without the header button.
                try {
                  return slots.register(
                    {
                      name: 'conversation.session.header.utilities',
                      id: 'session-toc',
                      order: 20,
                      label: copy.title,
                    },
                    function TocHeaderToggle() {
                      var s = useStore(store)
                      // Same gate as the rail: an unreachable settings route keeps
                      // the button (known + enabled), a switched-off outline hides
                      // it together with the rail.
                      if (!s.outlineKnown || !s.outline) return null
                      return h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsh-toc-header-btn' + (s.pinned ? ' on' : ''),
                          title: copy.toggle,
                          'aria-label': copy.toggle,
                          onClick: function () {
                            store.togglePinned()
                          },
                        },
                        '☰',
                      )
                    },
                  )
                } catch (error) {
                  console.error(LOG, 'header toggle unavailable (slot refused):', error)
                  return function () {}
                }
              })
            },
            'dsh-session-toc: header toggle',
          )

          // The switch itself: one row on the official settings General page, the
          // seat the built-in appearance and font-size rows use
          // (`settings.general.item`). Registered through `inject` so a build
          // without the settings UI simply never gets the row — the rail keeps
          // working from its default.
          ctx.effect(
            function () {
              return slots.inject('settings.general.item', function () {
                // Runs inside the owner's register() call: a throw here would
                // take the General page down with it, so registration stays
                // best-effort and the row is the only thing lost.
                try {
                  return slots.register(
                    {
                      name: 'settings.general.item',
                      id: 'session-outline',
                      order: 20,
                    },
                    function SessionOutlineRow() {
                      var s = useStore(store)
                      var Toggle = primitives && typeof primitives.Switch === 'function' ? primitives.Switch : null
                      var disabled = s.outlineBusy === true || s.outlineUnavailable === true
                      var note = s.outlineUnavailable ? copy.settingsUnavailable : copy.settingsDesc
                      return h(
                        'div',
                        { className: 'dsh-toc-setting' },
                        h(
                          'div',
                          { className: 'dsh-toc-setting-text' },
                          h('div', { className: 'dsh-toc-setting-title' }, copy.settingsTitle),
                          h('div', { className: 'dsh-toc-setting-desc' }, note),
                          s.outlineError ? h('div', { className: 'dsh-toc-setting-error' }, s.outlineError) : null,
                        ),
                        Toggle
                          ? h(Toggle, {
                              checked: s.outline,
                              disabled: disabled,
                              label: copy.settingsTitle,
                              title: note,
                              onChange: function (next) {
                                if (!disabled) void store.setOutline(next)
                              },
                            })
                          : h('input', {
                              type: 'checkbox',
                              checked: s.outline,
                              disabled: disabled,
                              'aria-label': copy.settingsTitle,
                              title: note,
                              onChange: function (event) {
                                if (!disabled) void store.setOutline(event.target.checked)
                              },
                            }),
                      )
                    },
                  )
                } catch (error) {
                  console.error(LOG, 'settings row unavailable (slot refused):', error)
                  return function () {}
                }
              })
            },
            'conversation-rollback: settings row',
          )
        }
      } catch (error) {
        fail('load', error)
      }
    }
