import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { watch, type FSWatcher } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codexHome, discoverCodexOffices, discoverOffices, readConversation, type Office } from '@agenthq/core'
import { jumpTo } from './jump.js'

export interface ServerOptions {
  home: string
  port: number
  ignore: string[]
}

/** The page's files, built next to this file. */
const webRoot = join(dirname(fileURLToPath(import.meta.url)), 'web')

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

/**
 * Serves the office on localhost only, and streams every change to the page as Server-Sent
 * Events: on each change Claude Code writes, and every 2 s, since states change with time too
 * (working → coffee → couch).
 */
export async function startServer({ home, port, ignore }: ServerOptions): Promise<{ url: string; close: () => void }> {
  const codex = codexHome()
  const clients = new Set<ServerResponse>()
  let latest = ''
  let offices: Office[] = []

  const scan = () => {
    try {
      // Claude Code's offices and Codex's, most recently busy first.
      offices = [...discoverOffices({ home, ignore }), ...discoverCodexOffices({ home: codex, ignore })].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      )
    } catch (error) {
      console.error('Couldn’t read the sessions:', error)
      return
    }
    // States are sent as they are now; only real changes go out.
    const payload = JSON.stringify(offices)
    if (payload === latest) return
    latest = payload
    for (const client of clients) send(client, payload)
  }

  let pending: NodeJS.Timeout | null = null
  const soon = () => {
    if (pending) return
    pending = setTimeout(() => {
      pending = null
      scan()
    }, 250)
  }

  scan()
  const ticker = setInterval(scan, 2000)
  // Recursive watching works on macOS and Windows (and Linux on recent Node); the ticker covers the rest.
  let watcher: FSWatcher | null = null
  try {
    watcher = watch(join(home, 'projects'), { recursive: true }, (_event, file) => {
      if (!file || String(file).endsWith('.jsonl')) soon()
    })
  } catch {
    watcher = null
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname === '/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      response.write('retry: 2000\n\n')
      clients.add(response)
      send(response, latest || '[]')
      request.on('close', () => clients.delete(response))
      return
    }
    if (url.pathname === '/api/jump') {
      await handleJump(request, response, offices, home)
      return
    }
    if (url.pathname === '/api/conversation') {
      handleConversation(request, response, url, offices)
      return
    }
    if (url.pathname === '/api/offices') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(latest || '[]')
      return
    }
    const path = url.pathname === '/' ? '/index.html' : url.pathname
    const file = normalize(join(webRoot, path))
    if (!file.startsWith(webRoot)) {
      response.writeHead(403).end()
      return
    }
    try {
      const body = await readFile(file)
      response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
      response.end(body)
    } catch {
      response.writeHead(404).end('Not found')
    }
  })

  const actualPort = await listen(server, port)
  // Keep the connection alive through proxies and sleeping laptops.
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(': ping\n\n')
  }, 15_000)

  return {
    url: `http://localhost:${actualPort}`,
    close: () => {
      clearInterval(ticker)
      clearInterval(heartbeat)
      watcher?.close()
      for (const client of clients) client.end()
      server.close()
    },
  }
}

function send(client: ServerResponse, payload: string) {
  client.write(`event: offices\ndata: ${payload}\n\n`)
}

/** The port asked for, or the next free one. Only on the loopback interface: the office is private. */
function listen(server: ReturnType<typeof createServer>, port: number, tries = 20): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening)
      if (error.code === 'EADDRINUSE' && tries > 0) resolve(listen(server, port + 1, tries - 1))
      else reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve(port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

/**
 * `POST /api/jump {"sessionId": "…"}`: brings a session's window forward. Only the office's own
 * page may ask: it must send the `X-AgentHQ` header (other websites can't without a CORS
 * preflight, which this server never answers) to a localhost `Host` (no DNS rebinding), and only
 * for a session in the office right now.
 */
async function handleJump(request: IncomingMessage, response: ServerResponse, offices: Office[], home: string) {
  const reply = (status: number, body: object) => {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  }
  if (request.method !== 'POST' || !fromOwnPage(request)) return reply(403, { error: 'Not allowed' })
  let sessionId: unknown
  try {
    sessionId = (JSON.parse(await readBody(request)) as { sessionId?: unknown }).sessionId
  } catch {
    return reply(400, { error: 'Expected {"sessionId": "…"}' })
  }
  const office = offices.find((candidate) => candidate.sessionId === sessionId)
  if (!office) return reply(404, { error: 'No such session in the office' })
  reply(200, await jumpTo(home, { sessionId: office.sessionId, cwd: office.cwd, kind: office.kind }))
}

/** Only the office's own page: the `X-AgentHQ` header (needs a CORS preflight elsewhere) to a localhost `Host` (no DNS rebinding). */
function fromOwnPage(request: IncomingMessage): boolean {
  const host = (request.headers.host ?? '').replace(/:\d+$/, '')
  return request.headers['x-agenthq'] === '1' && ['localhost', '127.0.0.1', '[::1]'].includes(host)
}

/**
 * `GET /api/conversation?session=…&agent=…[&before=…|&since=…]`: a page of an agent's
 * conversation, read from its transcript. Only for an agent in the office right now, so the
 * page can never name a file: the server picks it.
 */
function handleConversation(request: IncomingMessage, response: ServerResponse, url: URL, offices: Office[]) {
  const reply = (status: number, body: object) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(body))
  }
  if (request.method !== 'GET' || !fromOwnPage(request)) return reply(403, { error: 'Not allowed' })
  const office = offices.find((candidate) => candidate.sessionId === url.searchParams.get('session'))
  const agentId = url.searchParams.get('agent')
  const agent = office && [office.manager, ...office.staff, ...office.interns].find((candidate) => candidate.id === agentId)
  if (!office || !agent) return reply(404, { error: 'No such agent in the office' })
  const offset = (name: string) => {
    const value = url.searchParams.get(name)
    return value !== null && /^\d{1,15}$/.test(value) ? Number(value) : undefined
  }
  try {
    reply(200, readConversation(agent.transcript, office.kind, { before: offset('before'), since: offset('since') }))
  } catch {
    reply(404, { error: 'Its transcript can’t be read' })
  }
}

function readBody(request: IncomingMessage, limit = 4096): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
      if (body.length > limit) {
        reject(new Error('Too large'))
        request.destroy()
      }
    })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}
