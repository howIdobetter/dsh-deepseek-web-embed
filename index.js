/**
 * dsh-deepseek-web — Host half.
 *
 * The Web UI cannot frame `chat.deepseek.com` directly: the site answers with
 * `content-security-policy: frame-ancestors 'none'`, and its API paths are
 * absolute (`/api/v0/...`) so any plain iframe would also need the API.
 *
 * This half runs a loopback-only reverse proxy that serves the real site on its
 * own origin (`http://127.0.0.1:<port>/`), so the browser half can embed it:
 *
 *   - the document is fetched from upstream and re-sent without the framing
 *     headers, so the iframe is allowed;
 *   - every `/api/v0/...` call the page makes lands on this origin and is
 *     streamed to `https://chat.deepseek.com` unchanged, which is why chat,
 *     streaming, uploads and history all keep working;
 *   - cookies stay server-side in a jar, so dsh's own credential never leaves
 *     the machine and the site's cookies never mix into the dsh origin.
 *
 * The origin is a different port than the Web UI on purpose: localStorage for
 * the embedded site is then isolated from the Harness's own storage.
 *
 * @module dsh-deepseek-web/host
 */

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

const UPSTREAM = 'https://chat.deepseek.com'
/** Static assets live on a CDN whose CORS policy refuses this proxy origin. */
const FE_STATIC = 'https://fe-static.deepseek.com/chat/'
const FE_PATH = '/__cdn/'
const DEFAULT_PORT = 45789
const PORT_SPAN = 24
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

/**
 * Request headers forwarded upstream.
 *
 * The app sends its own `x-client-*` / `x-device-*` corpus, which upstream
 * validates (`40300 Missing Header`), so every `x-` header travels. Everything
 * else is either hop-by-hop, a browser hint, or ours to rewrite.
 */
function forwardableRequestHeader(name) {
  if (name.startsWith('x-')) return true
  return (
    name === 'authorization' ||
    name === 'content-type' ||
    name === 'accept' ||
    name === 'range' ||
    name === 'if-none-match' ||
    name === 'if-modified-since' ||
    name === 'cache-control'
  )
}

/**
 * Response headers safe to hand to the embedded page.
 *
 * A deny-list was not enough: forwarding `strict-transport-security` pins the
 * loopback host in the browser's HSTS store, and `alt-svc` sends it chasing QUIC
 * on a port that has none. Only what the page actually needs is passed through.
 */
function forwardableResponseHeader(name) {
  if (name === 'content-type' || name === 'cache-control' || name === 'etag') return true
  if (name === 'last-modified' || name === 'content-disposition' || name === 'content-range') return true
  if (name === 'accept-ranges' || name === 'vary' || name === 'expires' || name === 'pragma') return true
  if (name.startsWith('x-')) return true
  return false
}

function pick(request) {
  const headers = {}
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue
    if (!forwardableRequestHeader(key)) continue
    headers[key] = Array.isArray(value) ? value.join(', ') : value
  }
  return headers
}

function pickFromHeaders(headers) {
  const out = {}
  for (const [key, value] of headers) {
    if (!forwardableResponseHeader(key)) continue
    out[key] = value
  }
  return out
}

/** Absorb one `set-cookie` line into the jar (name → value). */
function absorb(jar, line) {
  const pair = String(line).split(';', 1)[0]
  const index = pair.indexOf('=')
  if (index <= 0) return
  jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
}

function cookieHeader(jar) {
  if (jar.size === 0) return null
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
}

/** Where the embedded session's request trail is kept for diagnosis. */
function logPath() {
  const profileDir = process.env.DSH_PROFILE_DIR
  const home = process.env.DSH_HOME ?? (profileDir !== undefined ? path.dirname(profileDir) : path.join(os.homedir(), '.dsh'))
  return path.join(home, 'deepseek-web', 'requests.log')
}

/** Append one request line to the ring buffer and to the on-disk trail. */
function record(state, entry) {
  const line = { at: Date.now(), ...entry }
  state.log.push(line)
  if (state.log.length > 600) state.log.splice(0, state.log.length - 600)
  try {
    fs.mkdirSync(path.dirname(state.logFile), { recursive: true })
    fs.appendFileSync(state.logFile, `${JSON.stringify(line)}\n`)
  } catch {
    /* logging never blocks a request */
  }
}

/** Rewrite upstream redirects that point at the real origin back onto this proxy. */
function relocate(location) {
  if (typeof location !== 'string') return location
  if (location.startsWith(UPSTREAM)) return location.slice(UPSTREAM.length) || '/'
  return location
}

function isHtml(contentType) {
  return typeof contentType === 'string' && contentType.includes('text/html')
}

/**
 * Re-serve the document so it can be framed at all: the site answers with
 * `frame-ancestors 'none'`, its scripts demand a CORS grant only deepseek.com
 * origins get, and its public path points at that CDN. Assets move onto this
 * origin, so neither the framing header nor the CORS step exists any more.
 */
function rewriteHtml(text, token) {
  const rewritten = text
    .replaceAll(FE_STATIC, FE_PATH)
    .replace(/ crossorigin(="[^"]*")?/g, '')
    .replace(/ integrity="[^"]*"/g, '')
  if (typeof token !== 'string' || token === '') return rewritten
  const boot = `<script>try{localStorage.setItem("userToken",${JSON.stringify(token)})}catch(e){}</script>`
  return rewritten.replace('<head>', `<head>${boot}`)
}

function rewriteScript(text) {
  return text.replaceAll(FE_STATIC, FE_PATH)
}

/**
 * Build the loopback proxy.
 *
 * @param {{ port: number }} state - shared listening state
 * @param {string} label - log prefix
 */
const MAX_BODY_BYTES = 64 * 1024 * 1024

/** Read one request body into memory; login and upload bodies are both small. */
async function readBody(request, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  return chunks.length === 0 ? undefined : Buffer.concat(chunks)
}

async function handleRequest(state, jar, request, response) {
    const url = request.url ?? '/'
    const started = Date.now()
    const headerNames = {
      client: Object.keys(request.headers).filter(name => name.startsWith('x-')),
      hasAuth: typeof request.headers.authorization === 'string',
      hasCookie: typeof request.headers.cookie === 'string',
    }
    response.on('finish', () => {
      if (url.startsWith('/__dsw/')) return
      record(state, {
        kind: 'request',
        method: request.method,
        url,
        status: response.statusCode ?? 0,
        ms: Date.now() - started,
        ...(url.startsWith('/api/') ? { headers: headerNames } : {}),
      })
    })

    if (url.startsWith('/__dsw/health')) {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify({ ok: true, upstream: UPSTREAM, port: state.port }))
      return
    }
    if (url.startsWith('/__dsw/log')) {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(
        JSON.stringify({ ok: true, logFile: state.logFile, jar: [...jar.keys()], entries: state.log.slice(-150) }),
      )
      return
    }

    let target
    let cdn = false
    if (request.url.startsWith(FE_PATH)) {
      target = `${FE_STATIC}${request.url.slice(FE_PATH.length)}`
      cdn = true
    } else {
      target = `${UPSTREAM}${url}`
    }
    const headers = pick(request)
    headers['user-agent'] = USER_AGENT
    headers['accept-language'] = 'zh-CN,zh;q=0.9,en;q=0.8'
    headers.origin = UPSTREAM
    headers.referer = `${UPSTREAM}/`
    // The page lives on this proxy origin; tell upstream where it really is.
    delete headers['content-length']
    const cookie = cookieHeader(jar)
    if (cookie !== null) headers.cookie = cookie

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    let body
    if (hasBody) {
      try {
        body = await readBody(request, MAX_BODY_BYTES)
      } catch {
        response.writeHead(413, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
        response.end('request body too large')
        return
      }
    }
    let upstream
    try {
      upstream = await fetch(target, {
        method: request.method,
        headers,
        body,
        redirect: 'manual',
      })
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      }
      response.end(`dsh-deepseek-web: upstream failed (${String(error?.message ?? error)})`)
      return
    }

    const setCookies = typeof upstream.headers.getSetCookie === 'function' ? upstream.headers.getSetCookie() : []
    for (const line of setCookies) absorb(jar, line)
    const browserCookies = setCookies.map(line =>
      line
        .replace(/;\s*domain=[^;]*/gi, '')
        .replace(/;\s*secure/gi, '')
        .replace(/;\s*samesite=[^;]*/gi, '; SameSite=Lax'),
    )

    const out = pickFromHeaders(upstream.headers)
    const location = relocate(upstream.headers.get('location'))
    if (location !== undefined && location !== null) out.location = location
    if (browserCookies.length > 0) out['set-cookie'] = browserCookies
    if (isHtml(out['content-type'])) out['cache-control'] = 'no-store'

    const contentType = out['content-type']
    const capture =
      url.startsWith('/api/') &&
      typeof contentType === 'string' &&
      contentType.includes('json') &&
      !url.includes('completion')
    if (isHtml(contentType)) {
      const text = await upstream.text().catch(() => '')
      const html = cdn ? text : rewriteHtml(text, state.pendingToken ?? '')
      if (!cdn && state.pendingToken) state.pendingToken = ''
      response.writeHead(upstream.status, out)
      response.end(html)
      return
    }
    if (capture) {
      const text = await upstream.text().catch(() => '')
      record(state, {
        kind: 'api',
        method: request.method,
        url,
        status: upstream.status,
        body: text.slice(0, 500),
        headers: headerNames,
        requestBody: typeof request.headers['content-length'] === 'string' ? Number(request.headers['content-length']) : 0,
      })
      response.writeHead(upstream.status, out)
      response.end(text)
      return
    }
    if (cdn && typeof contentType === 'string' && /javascript|ecmascript/.test(contentType)) {
      const text = await upstream.text().catch(() => '')
      response.writeHead(upstream.status, { ...out, 'cache-control': 'no-store' })
      response.end(rewriteScript(text))
      return
    }

    response.writeHead(upstream.status, out)
    if (upstream.body === null) {
      response.end()
      return
    }
    const stream = Readable.fromWeb(upstream.body)
    stream.on('error', () => response.destroy())
    request.on('close', () => stream.destroy())
    stream.pipe(response)
}

/**
 * Two listeners share one handler: `127.0.0.1` and `[::1]`, so the page loads
 * whether `localhost` resolves to IPv4 or IPv6.
 */
function createProxy(state) {
  const jar = new Map()
  const handler = (request, response) => {
    handleRequest(state, jar, request, response).catch(error => {
      try {
        if (!response.headersSent) {
          response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
        }
        response.end(`dsh-deepseek-web: ${String(error?.message ?? error)}`)
      } catch {
        response.destroy()
      }
    })
  }
  const primary = http.createServer(handler)
  const secondary = http.createServer(handler)
  for (const server of [primary, secondary]) {
    // Chats stream for minutes; keep the socket alive for the whole turn.
    server.requestTimeout = 0
    server.headersTimeout = 30000
    server.keepAliveTimeout = 65000
    server.on('clientError', (_error, socket) => {
      try {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
      } catch {
        /* socket already gone */
      }
    })
    server.on('upgrade', (_request, socket) => {
      try {
        socket.write('HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n')
        socket.end()
      } catch {
        /* socket already gone */
      }
    })
  }
  return { primary, secondary }
}

/** Bind the first free loopback port in the configured window. */
async function listen(primary, secondary, startPort) {
  for (let offset = 0; offset < PORT_SPAN; offset += 1) {
    const port = startPort + offset
    const bound = await new Promise(resolve => {
      const onError = error => {
        primary.removeListener('listening', onListening)
        resolve(error?.code === 'EADDRINUSE' ? null : { error })
      }
      const onListening = () => {
        primary.removeListener('error', onError)
        resolve({ port })
      }
      primary.once('error', onError)
      primary.once('listening', onListening)
      primary.listen(port, '127.0.0.1')
    })
    if (bound?.error) throw bound.error
    if (bound?.port) {
      // IPv6 is best effort: a host without ::1 still serves over IPv4.
      await new Promise(resolve => {
        const done = () => {
          secondary.removeListener('error', done)
          resolve()
        }
        secondary.once('error', done)
        secondary.listen(port, '::1', done)
      })
      return bound.port
    }
  }
  throw new Error(`no free loopback port in ${startPort}..${startPort + PORT_SPAN - 1}`)
}

export function apply(ctx, config = {}) {
  const requested = Number.isInteger(config?.port) ? config.port : DEFAULT_PORT
  const state = { port: 0, proxy: null, ready: null, error: '', log: [], logFile: logPath(), pendingToken: '' }
  const proxy = createProxy(state)
  state.proxy = proxy

  state.ready = listen(proxy.primary, proxy.secondary, requested)
    .then(port => {
      state.port = port
      return port
    })
    .catch(error => {
      state.error = String(error?.message ?? error)
      throw error
    })
  state.ready.catch(() => {})

  const disposeServer = () => {
    for (const server of [proxy.primary, proxy.secondary]) {
      try {
        server.close()
        server.closeAllConnections?.()
      } catch {
        /* already closed */
      }
    }
  }

  if (typeof ctx.effect === 'function') ctx.effect(() => disposeServer)
  else ctx.on?.('dispose', disposeServer)

  const endpoint = async () => {
    try {
      await state.ready
    } catch {
      return { ok: false, error: state.error }
    }
    return { ok: true, url: `http://localhost:${state.port}/`, port: state.port, upstream: UPSTREAM }
  }

  const json = data =>
    new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })

  /** Accept either the raw token or the whole `userToken` JSON blob. */
  const normalizeToken = value => {
    const raw = String(value ?? '').trim()
    if (raw === '') return ''
    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed !== null && typeof parsed === 'object' && typeof parsed.value === 'string') {
          return JSON.stringify({ ...parsed, value: parsed.value.trim() })
        }
      } catch {
        /* fall through and treat it as a bare token */
      }
    }
    return JSON.stringify({ value: raw, __version: '0' })
  }

  const registerRoute = connection => {
    if (typeof connection?.fetch?.register !== 'function') return
    const routes = [
      connection.fetch.register({
        path: '/api/dsh-deepseek-web/endpoint',
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async () => json(await endpoint()),
      }),
      connection.fetch.register({
        path: '/api/dsh-deepseek-web/session',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async request => {
          let body
          try {
            body = await request.json()
          } catch {
            return json({ ok: false, error: 'bad-json' })
          }
          const token = normalizeToken(body?.token)
          state.pendingToken = token
          return json({ ok: true, imported: token !== '', length: token.length })
        },
      }),
    ]
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => {
        for (const dispose of routes) void dispose()
      })
    }
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['connection'], scoped => {
      registerRoute(typeof scoped.get === 'function' ? scoped.get('connection') : scoped.connection)
    })
    return
  }
  registerRoute(ctx.connection)
}
