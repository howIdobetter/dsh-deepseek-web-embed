/**
 * dsh-deepseek-web — browser half.
 *
 * Registers one sidebar entry and one page whose body is the real
 * `chat.deepseek.com`, served by the Host half's loopback proxy.
 *
 * The chrome stays deliberately thin: a 2.4rem sub-header with the name and two
 * icon controls, then the site edge to edge. Every colour and radius comes from
 * the Harness theme tokens, so the page follows the active skin, light/dark and
 * zoom instead of sitting on top of them.
 *
 * The site sits on `localhost` while the shell runs on `127.0.0.1`: different
 * sites, so the frame gets its own renderer process and its own storage.
 */
window.__ModuleLoader__.load({
  id: 'dsh-deepseek-web',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef } = React

    const NS = 'dsh-deepseek-web'
    const ENDPOINT = 'api/dsh-deepseek-web/endpoint'
    const SESSION = 'api/dsh-deepseek-web/session'
    const FALLBACK = 'http://localhost:45789/'

    const ZH = {
      'panel.label': 'DeepSeek',
      'title': 'DeepSeek',
      'subtitle': '网页版',
      'state.connecting': '正在连接…',
      'state.failed': '本机代理未就绪',
      'action.enter': '进入 DeepSeek',
      'action.retry': '重试',
      'action.reload': '重新加载',
      'action.copy': '复制地址',
      'action.copied': '已复制',
      'action.more': '更多',
      'action.import': '导入登录态',
      'action.save': '写入并重载',
      'action.cancel': '取消',
      'start.title': 'DeepSeek 网页版',
      'start.hint': '点进入后在这里直接对话，不必再开浏览器。页面按独立站点加载，不会影响 Harness 本身。',
      'import.title': '导入登录态',
      'import.desc': '浏览器里打开 chat.deepseek.com（保持已登录）→ F12 → Console → 执行下面的命令 → 把结果粘贴进来。令牌只写入本机代理的存储。',
      'import.code': 'copy(localStorage.userToken)',
      'import.placeholder': '粘贴 userToken 的值',
      'import.ok': '已写入，正在重载',
      'import.fail': '写入失败',
      'frame.title': 'DeepSeek',
    }

    const EN = {
      'panel.label': 'DeepSeek',
      'title': 'DeepSeek',
      'subtitle': 'Web',
      'state.connecting': 'Connecting…',
      'state.failed': 'Local proxy unavailable',
      'action.enter': 'Open DeepSeek',
      'action.retry': 'Retry',
      'action.reload': 'Reload',
      'action.copy': 'Copy URL',
      'action.copied': 'Copied',
      'action.more': 'More',
      'action.import': 'Import session',
      'action.save': 'Save and reload',
      'action.cancel': 'Cancel',
      'start.title': 'DeepSeek Web',
      'start.hint': 'Open it once and chat here — no browser tab needed. The page loads as its own site and cannot disturb the Harness.',
      'import.title': 'Import a session',
      'import.desc': 'Open chat.deepseek.com in a browser while signed in → DevTools → Console → run the command below → paste the result. The token only lands on this local proxy origin.',
      'import.code': 'copy(localStorage.userToken)',
      'import.placeholder': 'Paste the userToken value',
      'import.ok': 'Stored, reloading',
      'import.fail': 'Import failed',
      'frame.title': 'DeepSeek',
    }

    const CSS = `
.dsx-root{display:flex;flex-direction:column;height:100%;min-height:0;width:100%;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:.875rem;line-height:1.6}
.dsx-root *{box-sizing:border-box}
.dsx-bar{display:flex;align-items:center;justify-content:space-between;gap:1rem;height:2.4rem;padding:0 .5rem 0 .95rem;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.dsx-id{display:flex;align-items:center;gap:.45rem;min-width:0;color:var(--dsw-alias-label-secondary)}
.dsx-name{font-size:.8125rem;font-weight:650;letter-spacing:-.01em;color:var(--dsw-alias-label-primary);white-space:nowrap}
.dsx-sub{font-size:.6875rem;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dsx-sep{width:1px;height:.7rem;background:var(--dsw-alias-border-l2);opacity:.7}
.dsx-tools{position:relative;display:flex;align-items:center;gap:.1rem;flex:0 0 auto}
.dsx-ico{width:1.7rem;height:1.7rem;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:.4rem;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;transition:background .12s ease,color .12s ease}
.dsx-ico:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsx-ico[data-on="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsx-stage{position:relative;flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
.dsx-frame{flex:1 1 auto;width:100%;height:100%;border:0;display:block;background:#fff}
.dsx-center{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.5rem;text-align:center;padding:2rem 1.5rem}
.dsx-mark{width:2.4rem;height:2.4rem;border-radius:.8rem;display:inline-flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-brand-primary)}
.dsx-center h2{margin:.2rem 0 0;font-size:.9375rem;font-weight:650;letter-spacing:-.01em}
.dsx-center p{margin:0;max-width:25rem;font-size:.75rem;line-height:1.75;color:var(--dsw-alias-label-secondary)}
.dsx-primary{display:inline-flex;align-items:center;gap:.35rem;margin-top:.5rem;padding:.38rem .9rem;border:0;border-radius:.5rem;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);font:inherit;font-size:.75rem;font-weight:600;cursor:pointer}
.dsx-primary:hover{opacity:.9}
.dsx-primary:disabled{opacity:.45;cursor:default}
.dsx-ghost{display:inline-flex;align-items:center;gap:.3rem;padding:.32rem .68rem;border:1px solid var(--dsw-alias-border-l1);border-radius:.5rem;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:.75rem;cursor:pointer;white-space:nowrap}
.dsx-ghost:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsx-spin{width:.9rem;height:.9rem;border-radius:999px;border:1.5px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-secondary);animation:dsx-rotate .9s linear infinite}
@keyframes dsx-rotate{to{transform:rotate(360deg)}}
.dsx-banner{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.35rem .95rem;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:.6875rem;color:var(--dsw-alias-state-warn-primary)}
.dsx-banner span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsx-veil{position:absolute;inset:0;display:grid;place-items:center;background:var(--dsw-alias-bg-base)}
.dsx-menu{position:absolute;top:1.85rem;right:0;z-index:20;min-width:10rem;padding:.22rem;display:flex;flex-direction:column;gap:.04rem;border:1px solid var(--dsw-alias-border-l1);border-radius:.55rem;background:var(--dsw-alias-bg-overlay);box-shadow:0 .5rem 1.4rem rgba(0,0,0,.14)}
.dsx-menu button{display:flex;align-items:center;width:100%;padding:.34rem .5rem;border:0;border-radius:.35rem;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:.75rem;text-align:left;cursor:pointer}
.dsx-menu button:hover{background:var(--dsw-alias-bg-layer-2)}
.dsx-overlay{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:1.5rem;background:rgba(0,0,0,.32)}
.dsx-dialog{width:min(29rem,100%);max-height:min(34rem,88vh);overflow:auto;padding:1.05rem 1.1rem .9rem;border:1px solid var(--dsw-alias-border-l1);border-radius:.85rem;background:var(--dsw-alias-bg-overlay);box-shadow:0 1.2rem 2.6rem rgba(0,0,0,.2)}
.dsx-dialog h2{margin:0 0 .3rem;font-size:.875rem;font-weight:650}
.dsx-dialog p{margin:0 0 .65rem;font-size:.75rem;line-height:1.75;color:var(--dsw-alias-label-secondary)}
.dsx-cmd{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin:0 0 .7rem;padding:.38rem .5rem .38rem .6rem;border:1px solid var(--dsw-alias-border-l1);border-radius:.45rem;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.6875rem;overflow:auto}
.dsx-cmd button{flex:0 0 auto;padding:.08rem .24rem;border:0;border-radius:.3rem;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:.6875rem;cursor:pointer}
.dsx-cmd button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsx-dialog textarea{width:100%;min-height:4.4rem;resize:vertical;padding:.45rem .55rem;border:1px solid var(--dsw-alias-border-l1);border-radius:.45rem;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.6875rem;line-height:1.6;outline:none}
.dsx-dialog textarea:focus{border-color:var(--dsw-alias-brand-primary)}
.dsx-foot{display:flex;align-items:center;justify-content:space-between;gap:.6rem;margin-top:.8rem}
.dsx-note{font-size:.6875rem;color:var(--dsw-alias-label-secondary);min-height:1rem}
.dsx-note[data-tone="ok"]{color:var(--dsw-alias-state-success-primary)}
.dsx-note[data-tone="bad"]{color:var(--dsw-alias-state-error-primary)}
@media (prefers-reduced-motion:reduce){.dsx-spin{animation:none}}
`

    /* ---------------------------------------------------------------- glyphs */

    function MarkGlyph({ size = 16 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M12 3.1c4.6 0 8.4 3 8.4 6.8 0 1.4-.56 2.7-1.5 3.85l1.2 3.85-3.95-1.4c-1.2.55-2.6.9-4.15.9-4.6 0-8.4-3-8.4-6.8S7.4 3.1 12 3.1Z',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinejoin: 'round',
        }),
        h('circle', { cx: 9.1, cy: 9.8, r: 1, fill: 'currentColor' }),
        h('circle', { cx: 12, cy: 9.8, r: 1, fill: 'currentColor' }),
        h('circle', { cx: 14.9, cy: 9.8, r: 1, fill: 'currentColor' }),
      )
    }

    function ReloadGlyph({ size = 15 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M20.5 12a8.5 8.5 0 1 1-2.6-6.1' }),
        h('path', { d: 'M20.5 4.4v4.9h-4.9' }),
      )
    }

    function MoreGlyph({ size = 15 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true },
        h('circle', { cx: 6, cy: 12, r: 1.5 }),
        h('circle', { cx: 12, cy: 12, r: 1.5 }),
        h('circle', { cx: 18, cy: 12, r: 1.5 }),
      )
    }

    /* -------------------------------------------------------------- plumbing */

    function installStyles(ctx) {
      const attach = () => {
        if (document.querySelector('style[data-dsh-deepseek-web]') !== null) return null
        const element = document.createElement('style')
        element.setAttribute('data-dsh-deepseek-web', '')
        element.textContent = CSS
        document.head.appendChild(element)
        return () => element.remove()
      }
      if (typeof ctx.effect === 'function') ctx.effect(attach)
      else attach()
    }

    function translate(ctx) {
      let bound = null
      try {
        if (typeof ctx.locale?.register === 'function') {
          ctx.locale.register(NS, 'zh', ZH)
          ctx.locale.register(NS, 'en', EN)
        }
        if (typeof ctx.locale?.bind === 'function') bound = ctx.locale.bind(NS)
      } catch {
        bound = null
      }
      return key => {
        if (typeof bound === 'function') {
          try {
            const value = bound(key)
            if (typeof value === 'string' && value !== '' && value !== key) return value
          } catch {
            /* fall through */
          }
        }
        return ZH[key] ?? key
      }
    }

    /** Modal for pasting a browser session; the fallback when sign-in is blocked. */
    function ImportDialog({ t, onClose, onDone }) {
      const [value, setValue] = useState('')
      const [note, setNote] = useState({ tone: 'idle', text: '' })
      const [busy, setBusy] = useState(false)
      const [copied, setCopied] = useState(false)

      useEffect(() => {
        const onKey = event => {
          if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])

      const copyCommand = () => {
        void navigator.clipboard?.writeText(t('import.code')).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1400)
        })
      }

      const submit = async () => {
        setBusy(true)
        setNote({ tone: 'idle', text: '' })
        try {
          const res = await fetch(SESSION, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: value }),
          })
          const body = await res.json().catch(() => null)
          if (!res.ok || body?.ok !== true) throw new Error(body?.error ?? `session ${res.status}`)
          setNote({ tone: 'ok', text: t('import.ok') })
          onDone()
        } catch (error) {
          setNote({ tone: 'bad', text: `${t('import.fail')} · ${String(error?.message ?? error)}` })
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        { className: 'dsx-overlay', onMouseDown: event => { if (event.target === event.currentTarget) onClose() } },
        h(
          'div',
          { className: 'dsx-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('import.title') },
          h('h2', null, t('import.title')),
          h('p', null, t('import.desc')),
          h(
            'div',
            { className: 'dsx-cmd' },
            h('code', null, t('import.code')),
            h('button', { type: 'button', onClick: copyCommand }, copied ? '✓' : '⧉'),
          ),
          h('textarea', {
            value,
            placeholder: t('import.placeholder'),
            spellCheck: false,
            onChange: event => setValue(event.target.value),
          }),
          h(
            'div',
            { className: 'dsx-foot' },
            h('span', { className: 'dsx-note', 'data-tone': note.tone }, note.text),
            h(
              'div',
              { style: { display: 'flex', gap: '.4rem' } },
              h('button', { type: 'button', className: 'dsx-ghost', onClick: onClose }, t('action.cancel')),
              h(
                'button',
                { type: 'button', className: 'dsx-primary', disabled: busy || value.trim() === '', onClick: submit },
                t('action.save'),
              ),
            ),
          ),
        ),
      )
    }

    /* ------------------------------------------------------------------ page */

    function DeepSeekPage({ t }) {
      const [endpoint, setEndpoint] = useState(null)
      const [problem, setProblem] = useState('')
      const [entered, setEntered] = useState(false)
      const [generation, setGeneration] = useState(0)
      const [menuOpen, setMenuOpen] = useState(false)
      const [importOpen, setImportOpen] = useState(false)
      const [copied, setCopied] = useState(false)
      const [loading, setLoading] = useState(false)
      const toolsRef = useRef(null)

      const probe = async () => {
        try {
          const res = await fetch(ENDPOINT, { headers: { accept: 'application/json' } })
          if (!res.ok) throw new Error(`endpoint ${res.status}`)
          const body = await res.json()
          if (body?.ok !== true) throw new Error(body?.error ?? 'proxy not ready')
          setEndpoint(body.url)
          setProblem('')
        } catch (error) {
          setProblem(String(error?.message ?? error))
        }
      }

      useEffect(() => {
        void probe()
      }, [])

      useEffect(() => {
        if (!menuOpen) return
        const onDown = event => {
          if (toolsRef.current !== null && !toolsRef.current.contains(event.target)) setMenuOpen(false)
        }
        window.addEventListener('mousedown', onDown)
        return () => window.removeEventListener('mousedown', onDown)
      }, [menuOpen])

      const url = endpoint ?? FALLBACK
      const ready = problem === '' && endpoint !== null

      const reload = () => {
        setMenuOpen(false)
        setLoading(true)
        setGeneration(value => value + 1)
        if (!ready) void probe()
      }

      const copyUrl = () => {
        setMenuOpen(false)
        void navigator.clipboard?.writeText(url).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1400)
        })
      }

      const openImport = () => {
        setMenuOpen(false)
        setImportOpen(true)
      }

      return h(
        'div',
        { className: 'dsx-root' },
        h(
          'header',
          { className: 'dsx-bar' },
          h(
            'div',
            { className: 'dsx-id' },
            h(MarkGlyph, { size: 15 }),
            h('span', { className: 'dsx-name' }, t('title')),
            h('span', { className: 'dsx-sep' }),
            h('span', { className: 'dsx-sub' }, t('subtitle')),
          ),
          h(
            'div',
            { className: 'dsx-tools', ref: toolsRef },
            h(
              'button',
              {
                type: 'button',
                className: 'dsx-ico',
                title: t('action.reload'),
                'aria-label': t('action.reload'),
                onClick: reload,
              },
              h(ReloadGlyph, null),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsx-ico',
                title: t('action.more'),
                'aria-label': t('action.more'),
                'data-on': menuOpen ? 'true' : 'false',
                'aria-expanded': menuOpen ? 'true' : 'false',
                onClick: () => setMenuOpen(value => !value),
              },
              h(MoreGlyph, null),
            ),
            menuOpen
              ? h(
                  'div',
                  { className: 'dsx-menu', role: 'menu' },
                  h(
                    'button',
                    { type: 'button', role: 'menuitem', onClick: copyUrl },
                    copied ? t('action.copied') : t('action.copy'),
                  ),
                  h('button', { type: 'button', role: 'menuitem', onClick: openImport }, t('action.import')),
                )
              : null,
          ),
        ),

        problem !== ''
          ? h(
              'div',
              { className: 'dsx-banner' },
              h('span', null, `${t('state.failed')} · ${problem}`),
              h('button', { type: 'button', className: 'dsx-ghost', onClick: reload }, t('action.retry')),
            )
          : null,

        h(
          'div',
          { className: 'dsx-stage' },
          entered === false
            ? h(
                'div',
                { className: 'dsx-center' },
                h('span', { className: 'dsx-mark' }, h(MarkGlyph, { size: 22 })),
                h('h2', null, t('start.title')),
                h('p', null, t('start.hint')),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsx-primary',
                    onClick: () => {
                      setEntered(true)
                      setLoading(true)
                    },
                  },
                  t('action.enter'),
                ),
              )
            : ready === false
              ? h(
                  'div',
                  { className: 'dsx-center' },
                  h('span', { className: 'dsx-spin' }),
                  h('p', null, t('state.connecting')),
                )
              : h('iframe', {
                  key: `${url}#${generation}`,
                  className: 'dsx-frame',
                  src: url,
                  title: t('frame.title'),
                  allow: 'clipboard-read; clipboard-write; microphone; camera',
                  referrerPolicy: 'no-referrer',
                  onLoad: () => setLoading(false),
                }),
          entered && ready && loading ? h('div', { className: 'dsx-veil' }, h('span', { className: 'dsx-spin' })) : null,
        ),

        importOpen
          ? h(ImportDialog, {
              t,
              onClose: () => setImportOpen(false),
              onDone: () => {
                setImportOpen(false)
                reload()
              },
            })
          : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        installStyles(ctx)
        const t = translate(ctx)

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: NS, locale: NS }, () => h(DeepSeekPage, { t })),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: NS, order: 31, label: () => t('panel.label'), locale: NS },
            props => h(MarkGlyph, { size: typeof props?.size === 'number' ? props.size : 20 }),
          ),
        )
      },
    }
  },
})
