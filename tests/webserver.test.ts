import { spawn, type ChildProcess } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { connect as tlsConnect } from 'node:tls'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LocalCA, PHP_ROUTER, WebServer, freePort, siteHost, waitForPort, type Site } from '../src/main/webserver'

const root = mkdtempSync(join(tmpdir(), 'sf-web-'))
const procs: ChildProcess[] = []
let ca: LocalCA
let server: WebServer
let started = 0

/**
 * *.localhost resolves to loopback on macOS, but not on every machine (e.g. CI runners).
 * Resolve it here the way macOS does, so the tests don't depend on the host's resolver.
 */
const localLookup = ((host: string, options: dns.LookupOptions, cb: (...a: unknown[]) => void) => {
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return options.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)
  }
  return dns.lookup(host, options, cb as never)
}) as unknown as typeof dns.lookup

function get(url: string, opts: { ca?: string } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(url, { ca: opts.ca, lookup: localLookup } as https.RequestOptions, (res) => {
      let body = ''
      res.on('data', (d) => (body += d))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
    })
    req.on('error', reject)
  })
}

beforeAll(async () => {
  ca = new LocalCA(join(root, 'certs'))
  // PHP site
  const app = join(root, 'app')
  mkdirSync(join(app, 'public', 'css'), { recursive: true })
  writeFileSync(join(app, 'public', 'index.php'), `<?php header('content-type: application/json'); echo json_encode(['https' => $_SERVER['HTTPS'] ?? null, 'host' => $_SERVER['HTTP_HOST'], 'port' => $_SERVER['SERVER_PORT'], 'path' => $_SERVER['REQUEST_URI']]);`)
  writeFileSync(join(app, 'public', 'css', 'app.css'), 'body{color:green}')
  writeFileSync(join(root, 'router.php'), PHP_ROUTER)
  // Node site that speaks WebSocket-style upgrades
  const wsPort = await freePort(19600)
  const ws = http.createServer()
  ws.on('upgrade', (_req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n')
    socket.on('data', (d) => socket.write(d.toString().toUpperCase()))
  })
  await new Promise<void>((r) => ws.listen(wsPort, '127.0.0.1', () => r()))

  const phpPort = await freePort(19700)
  server = new WebServer(ca, {
    async ensureBackend(site: Site) {
      if (site.host.startsWith('ws.')) return
      if (await waitForPort(site.port, 50)) return
      started++
      const p = spawn('php', ['-S', `127.0.0.1:${site.port}`, '-t', site.docroot, join(root, 'router.php')], {
        env: { ...process.env, SPINDLE_DOCROOT: site.docroot, PHP_CLI_SERVER_WORKERS: '2' },
        stdio: 'ignore'
      })
      procs.push(p)
      if (!(await waitForPort(site.port))) throw new Error('backend did not start')
    }
  })
  server.register({ host: siteHost('Demo Shop', 'csv-export'), root: app, docroot: join(app, 'public'), port: phpPort, owner: 'f1' })
  server.register({ host: 'ws.demo.localhost', root: app, docroot: app, port: wsPort, owner: 'f2' })
  await server.start({ https: [19443, 19444], http: [19080, 19081] })
}, 30_000)

afterAll(() => {
  server?.stop()
  for (const p of procs) p.kill()
  rmSync(root, { recursive: true, force: true })
})

describe('built-in web server', () => {
  it('names sites under .localhost', () => {
    expect(siteHost('Demo Shop', 'csv-export')).toBe('csv-export.demo-shop.localhost')
    expect(siteHost('shop')).toBe('shop.localhost')
  })

  it('issues certificates signed by the local CA for each hostname', async () => {
    const { cert } = await ca.issue('csv-export.demo-shop.localhost')
    const text = execFileSync('openssl', ['x509', '-in', cert, '-noout', '-text'], { encoding: 'utf8' })
    expect(text).toContain('DNS:csv-export.demo-shop.localhost')
    expect(text).toContain('Spindle Local CA')
    expect(ca.fingerprint()).toMatch(/^sha256\//)
    // The chain must hold up for both OpenSSL and Node's own X.509 checks.
    const caPath = join(root, 'certs', 'ca.pem')
    expect(execFileSync('openssl', ['verify', '-CAfile', caPath, cert], { encoding: 'utf8' })).toContain(': OK')
    const leaf = new X509Certificate(readFileSync(cert))
    const issuer = new X509Certificate(ca.pem())
    expect(leaf.checkIssued(issuer)).toBe(true)
    expect(leaf.verify(issuer.publicKey)).toBe(true)
    expect(issuer.ca).toBe(true)
  })

  it('creates one CA even when the first requests arrive at the same time', async () => {
    const fresh = new LocalCA(join(root, 'certs-concurrent'))
    const hosts = ['a.demo.localhost', 'b.demo.localhost', 'a.demo.localhost', 'c.demo.localhost']
    const issued = await Promise.all([fresh.ensure(), ...hosts.map((h) => fresh.issue(h))])
    const issuer = new X509Certificate(fresh.pem())
    for (const r of issued.slice(1) as { cert: string }[]) {
      expect(new X509Certificate(readFileSync(r.cert)).verify(issuer.publicKey)).toBe(true)
    }
  })

  it('serves a site over HTTPS by hostname, starting its PHP backend on first request', async () => {
    const r = await get(`https://csv-export.demo-shop.localhost:${server.httpsPort}/dashboard?x=1`, { ca: ca.pem() })
    expect(r.status).toBe(200)
    const j = JSON.parse(r.body)
    // the app sees a real HTTPS request on the public host and port
    expect(j).toEqual({ https: 'on', host: `csv-export.demo-shop.localhost:${server.httpsPort}`, port: String(server.httpsPort), path: '/dashboard?x=1' })
    expect(started).toBe(1)
  }, 20_000)

  it('serves static files directly and reuses the running backend', async () => {
    const r = await get(`https://csv-export.demo-shop.localhost:${server.httpsPort}/css/app.css`, { ca: ca.pem() })
    expect(r.body).toBe('body{color:green}')
    expect(started).toBe(1)
  })

  it('redirects HTTP to HTTPS', async () => {
    const r = await get(`http://csv-export.demo-shop.localhost:${server.httpPort}/login`)
    expect(r.status).toBe(301)
    expect(r.headers.location).toBe(`https://csv-export.demo-shop.localhost:${server.httpsPort}/login`)
  })

  it('answers unknown hosts with a helpful page', async () => {
    const r = await get(`https://nope.localhost:${server.httpsPort}/`, { ca: ca.pem() })
    expect(r.status).toBe(404)
    expect(r.body).toContain('No site is set up for nope.localhost')
  })

  it('rejects certificates for hosts when the CA is not trusted', async () => {
    await expect(get(`https://csv-export.demo-shop.localhost:${server.httpsPort}/`)).rejects.toThrow(/certificate|self-signed|issuer/i)
  })

  it('passes WebSocket upgrades through', async () => {
    const reply = await new Promise<string>((resolve, reject) => {
      const sock = tlsConnect({ host: '127.0.0.1', port: server.httpsPort, servername: 'ws.demo.localhost', ca: ca.pem() }, () => {
        sock.write('GET /socket HTTP/1.1\r\nHost: ws.demo.localhost\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n')
      })
      let buf = ''
      sock.on('data', (d) => {
        buf += d.toString()
        if (buf.includes('101') && !buf.includes('HELLO')) sock.write('hello')
        if (buf.includes('HELLO')) {
          sock.destroy()
          resolve(buf)
        }
      })
      sock.on('error', reject)
    })
    expect(reply).toContain('101 Switching Protocols')
    expect(reply).toContain('HELLO')
  })
})
