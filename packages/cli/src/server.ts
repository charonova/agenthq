import { readFile } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { watch, type FSWatcher } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverOffices, type Office } from '@agenthq/core'

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
  const clients = new Set<ServerResponse>()
  let latest = ''
  let offices: Office[] = []

  const scan = () => {
    try {
      offices = discoverOffices({ home, ignore })
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
