import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { appendFileSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  codexHome,
  discoverCodexOffices,
  discoverOffices,
  forgetSessions,
  readConversation,
  type AskAnswer,
  type Draft,
  type Office,
} from '@agenthq/core'
import { Asks, type HookInput } from './asks.js'
import { answeringEnabled, setAnswering, stateDir, writeHookScript } from './hook.js'
import { jumpTo } from './jump.js'
import { Sessions, type Mode, type Model } from './sessions.js'
import { canType, setTyping, typeInto, typingEnabled } from './typing.js'

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
  // A secret for this run: only the hook (which reads it from AgentHQ's folder) can hand prompts in.
  const token = randomBytes(32).toString('hex')
  let enabled = answeringEnabled(home)
  let typing = typingEnabled()
  // Keep the installed hook up to date with this version.
  if (enabled) writeHookScript()
  let latestAsks = ''
  const asks = new Asks(() => sendAsks())
  // Sessions run from the page: a change (a turn starts or ends) shows at the next scan; the
  // reply being written goes out as it grows, at most every 80 ms per session.
  const drafting = new Map<string, Draft | null>()
  let draftTimer: NodeJS.Timeout | null = null
  const sendDrafts = () => {
    draftTimer = null
    for (const [sessionId, draft] of drafting) {
      const payload = JSON.stringify({ sessionId, draft })
      for (const client of clients) client.write(`event: draft\ndata: ${payload}\n\n`)
    }
    drafting.clear()
  }
  const sessions = new Sessions(
    asks,
    () => soon(),
    (sessionId, draft) => {
      drafting.set(sessionId, draft)
      draftTimer ??= setTimeout(sendDrafts, 80)
    },
  )
  /** Prompts waiting on you, and the switches that change what the page may do. */
  const switches = () => ({ enabled, typing, canType: canType(), asks: asks.list() })
  const sendAsks = (force = false) => {
    const payload = JSON.stringify(switches())
    if (payload === latestAsks && !force) return
    latestAsks = payload
    for (const client of clients) client.write(`event: asks\ndata: ${payload}\n\n`)
  }

  const scan = () => {
    // A session that just started, or asks something, but isn't in the building yet: look for it now.
    const expected = [...sessions.ids(), ...asks.waitingSessions()]
    if (expected.some((id) => !offices.some((office) => office.sessionId === id))) forgetSessions(home)
    try {
      // Claude Code's offices and Codex's, most recently busy first.
      offices = [...discoverOffices({ home, ignore }), ...discoverCodexOffices({ home: codex, ignore })]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((office) => {
          const managed = office.kind === 'claude' ? sessions.info(office.sessionId) : null
          // A session AgentHQ runs is running, whatever its process file says yet.
          return { ...office, managed, ended: managed ? false : office.ended }
        })
    } catch (error) {
      console.error('Couldn’t read the sessions:', error)
      return
    }
    // Prompts the terminal answered go away; the settings may have changed by hand.
    enabled = answeringEnabled(home)
    typing = typingEnabled()
    asks.update(offices)
    sendAsks()
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
      response.write(`event: asks\ndata: ${latestAsks || JSON.stringify(switches())}\n\n`)
      for (const [sessionId, draft] of Object.entries(sessions.drafts()))
        response.write(`event: draft\ndata: ${JSON.stringify({ sessionId, draft })}\n\n`)
      request.on('close', () => clients.delete(response))
      return
    }
    if (url.pathname === '/api/hook') {
      await handleHook(request, response, token, asks, (sessionId) => {
        // A session too new to be in the office yet: look for it now.
        if (!offices.some((office) => office.sessionId === sessionId)) {
          forgetSessions(home)
          soon()
        }
      })
      return
    }
    if (url.pathname === '/api/asks') {
      if (!fromOwnPage(request)) return void response.writeHead(403).end()
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify(switches()))
      return
    }
    if (url.pathname === '/api/answer') {
      await handleAnswer(request, response, asks)
      return
    }
    if (url.pathname.startsWith('/api/sessions/')) {
      await handleSessions(request, response, url.pathname.slice('/api/sessions/'.length), offices, sessions)
      return
    }
    if (url.pathname === '/api/answering') {
      if (request.method !== 'POST' || !fromOwnPage(request)) return void json(response, 403, { error: 'Not allowed' })
      try {
        const { enable } = JSON.parse(await readBody(request)) as { enable?: unknown }
        if (typeof enable !== 'boolean') return void json(response, 400, { error: 'Expected {"enable": true|false}' })
        const result = setAnswering(home, enable)
        enabled = result.enabled
        log({ answering: enabled, backup: result.backup })
        sendAsks(true)
        json(response, 200, result)
      } catch (error) {
        json(response, 500, { error: `Claude Code’s settings weren’t changed: ${(error as Error).message}` })
      }
      return
    }
    if (url.pathname === '/api/typing') {
      if (request.method !== 'POST' || !fromOwnPage(request)) return void json(response, 403, { error: 'Not allowed' })
      try {
        const { enable } = JSON.parse(await readBody(request)) as { enable?: unknown }
        if (typeof enable !== 'boolean') return void json(response, 400, { error: 'Expected {"enable": true|false}' })
        typing = setTyping(enable)
        log({ typing })
        sendAsks(true)
        json(response, 200, { typing })
      } catch (error) {
        json(response, 400, { error: (error as Error).message })
      }
      return
    }
    if (url.pathname === '/api/type') {
      await handleType(request, response, offices, home)
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
  // Where the hook finds this server, readable by you only.
  const serverFile = join(stateDir(), 'server.json')
  try {
    mkdirSync(stateDir(), { recursive: true, mode: 0o700 })
    writeFileSync(serverFile, JSON.stringify({ port: actualPort, token, pid: process.pid }), { mode: 0o600 })
  } catch (error) {
    console.error('Couldn’t write AgentHQ’s server file; answering from AgentHQ won’t work:', error)
  }
  // Keep the connection alive through proxies and sleeping laptops.
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(': ping\n\n')
  }, 15_000)

  return {
    url: `http://localhost:${actualPort}`,
    close: () => {
      clearInterval(ticker)
      clearInterval(heartbeat)
      if (draftTimer) clearTimeout(draftTimer)
      sessions.closeAll()
      asks.clear()
      try {
        // Only this run's file: another AgentHQ may have started since.
        if ((JSON.parse(readFileSync(serverFile, 'utf8')) as { pid?: number }).pid === process.pid) rmSync(serverFile)
      } catch {
        // Already gone.
      }
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

/**
 * `POST /api/type {"sessionId", "text"}`: types a message into the terminal tab of a session
 * running there. Guarded like the jump, only once you turned it on, and only for a Claude Code
 * session that's running in a terminal (one AgentHQ runs gets messages directly).
 */
async function handleType(request: IncomingMessage, response: ServerResponse, offices: Office[], home: string) {
  if (request.method !== 'POST' || !fromOwnPage(request)) return json(response, 403, { error: 'Not allowed' })
  let body: { sessionId?: unknown; text?: unknown }
  try {
    body = JSON.parse(await readBody(request, 64 * 1024)) as typeof body
  } catch {
    return json(response, 400, { error: 'Expected {"sessionId": "…", "text": "…"}' })
  }
  if (!typingEnabled()) return json(response, 409, { error: 'Typing into terminals is off: turn it on in the settings' })
  const office = offices.find((candidate) => candidate.sessionId === body.sessionId)
  if (!office) return json(response, 404, { error: 'No such session in the office' })
  if (office.kind !== 'claude' || office.managed || office.ended || !office.process)
    return json(response, 409, { error: 'It doesn’t run in a terminal' })
  try {
    const result = await typeInto(home, office.sessionId, typeof body.text === 'string' ? body.text : '')
    log({ typed: office.sessionId, done: result.done })
    json(response, 200, result)
  } catch (error) {
    json(response, 400, { error: (error as Error).message })
  }
}

function json(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(body))
}

/** What was answered from AgentHQ, kept in AgentHQ's folder (names and choices only, never inputs). */
function log(entry: object) {
  try {
    appendFileSync(join(stateDir(), 'answers.log'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', {
      mode: 0o600,
    })
  } catch {
    // Logging never stops an answer.
  }
}

const localHost = (request: IncomingMessage) =>
  ['localhost', '127.0.0.1', '[::1]'].includes((request.headers.host ?? '').replace(/:\d+$/, ''))

/**
 * `POST /api/hook`: a prompt from the hook, held open until it's answered. Only with this
 * run's secret, which the hook reads from AgentHQ's folder; the answer goes back as the reply.
 */
async function handleHook(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
  asks: Asks,
  arrived: (sessionId: string) => void,
) {
  const given = Buffer.from((request.headers.authorization ?? '').replace(/^Bearer /, ''))
  const expected = Buffer.from(token)
  if (request.method !== 'POST' || !localHost(request) || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return json(response, 403, { error: 'Not allowed' })
  }
  let input: HookInput & { hook_event_name?: string }
  try {
    input = JSON.parse(await readBody(request, 2 * 1024 * 1024)) as HookInput & { hook_event_name?: string }
  } catch {
    return json(response, 400, { error: 'Expected the hook’s JSON' })
  }
  if (input.hook_event_name !== 'PermissionRequest') return void response.writeHead(204).end()
  arrived(String(input.session_id ?? ''))
  const decision = await asks.add(input, (drop) =>
    response.on('close', () => {
      // The hook gave up (its timeout): nothing to answer anymore.
      if (!response.writableEnded) drop()
    }),
  )
  if (response.destroyed) return
  if (decision) json(response, 200, { decision })
  else response.writeHead(204).end()
}

/**
 * `POST /api/sessions/<action>`: start a session, resume one here, send it a message, interrupt
 * its turn, or end it. From the office's own page only; a session running in a terminal can't
 * be resumed here (two processes would write one transcript).
 */
async function handleSessions(
  request: IncomingMessage,
  response: ServerResponse,
  action: string,
  offices: Office[],
  sessions: Sessions,
) {
  if (request.method !== 'POST' || !fromOwnPage(request)) return json(response, 403, { error: 'Not allowed' })
  let body: { sessionId?: unknown; cwd?: unknown; text?: unknown; model?: unknown; mode?: unknown }
  try {
    body = JSON.parse(await readBody(request, 256 * 1024)) as typeof body
  } catch {
    return json(response, 400, { error: 'Expected JSON' })
  }
  const text = typeof body.text === 'string' ? body.text : ''
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  try {
    switch (action) {
      case 'start': {
        const id = await sessions.start({
          cwd: typeof body.cwd === 'string' ? body.cwd : '',
          prompt: text,
          model: typeof body.model === 'string' && body.model ? (body.model as Model) : null,
          mode: typeof body.mode === 'string' && body.mode ? (body.mode as Mode) : null,
        })
        log({ started: id })
        return json(response, 200, { sessionId: id })
      }
      case 'send': {
        const office = offices.find((candidate) => candidate.sessionId === sessionId)
        if (sessions.info(sessionId)) sessions.send(sessionId, text)
        // Only a session known to have ended: one still open in a terminal stays there.
        else if (office && office.kind === 'claude' && office.ended && office.cwd) {
          await sessions.resume(sessionId, office.cwd, text)
          log({ resumed: sessionId })
        } else return json(response, 409, { error: 'It runs in a terminal: message it there' })
        return json(response, 200, { ok: true })
      }
      case 'interrupt':
        await sessions.interrupt(sessionId)
        return json(response, 200, { ok: true })
      case 'stop':
        sessions.stop(sessionId)
        log({ stopped: sessionId })
        return json(response, 200, { ok: true })
      default:
        return json(response, 404, { error: 'No such action' })
    }
  } catch (error) {
    return json(response, 400, { error: (error as Error).message })
  }
}

/** `POST /api/answer`: your answer to a prompt, from the office's own page. */
async function handleAnswer(request: IncomingMessage, response: ServerResponse, asks: Asks) {
  if (request.method !== 'POST' || !fromOwnPage(request)) return json(response, 403, { error: 'Not allowed' })
  let answer: AskAnswer
  try {
    answer = JSON.parse(await readBody(request, 64 * 1024)) as AskAnswer
  } catch {
    return json(response, 400, { error: 'Expected an answer' })
  }
  const result = asks.answer(answer)
  if (!result.ok) return json(response, 409, { error: result.error })
  log({ session: result.ask.sessionId, tool: result.ask.tool.name, choice: answer.choice })
  json(response, 200, { ok: true })
}

/** Only the office's own page: the `X-AgentHQ` header (needs a CORS preflight elsewhere) to a localhost `Host` (no DNS rebinding). */
function fromOwnPage(request: IncomingMessage): boolean {
  return request.headers['x-agenthq'] === '1' && localHost(request)
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
