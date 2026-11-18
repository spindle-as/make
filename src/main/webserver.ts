import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import https from 'node:https'
import { connect, createServer as createNetServer, type Socket } from 'node:net'
import { join } from 'node:path'
import type { SecureContext } from 'node:tls'
import { createSecureContext } from 'node:tls'
import { exec, run } from './exec'

// ---------------------------------------------------------------- certificates

/**
 * A local certificate authority (like Herd/Valet). Site certificates are issued on
 * demand per hostname and served via SNI, so every site gets a valid HTTPS cert.
 */
export class LocalCA {
  readonly keyFile: string
  readonly certFile: string
  private contexts = new Map<string, SecureContext>()

  constructor(private dir: string) {
    mkdirSync(join(dir, 'sites'), { recursive: true })
    this.keyFile = join(dir, 'ca.key')
    this.certFile = join(dir, 'ca.pem')
  }

  async ensure(): Promise<void> {
    if (existsSync(this.keyFile) && existsSync(this.certFile)) return
    await run('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', this.keyFile])
    const user = process.env.USER || 'local'
    await run('openssl', [
      'req', '-x509', '-new', '-key', this.keyFile, '-sha256', '-days', '3650', '-out', this.certFile,
      '-subj', `/O=Spindle Make/CN=Spindle Local CA (${user})`,
      '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
      '-addext', 'keyUsage=critical,keyCertSign,cRLSign'
    ])
  }

  /** SHA-256 fingerprint of the CA, in Electron's "sha256/<base64>" format. */
  fingerprint(): string {
    const pem = readFileSync(this.certFile, 'utf8')
    const der = Buffer.from(pem.replace(/-----[^-]+-----|\s+/g, ''), 'base64')
    return 'sha256/' + createHash('sha256').update(der).digest('base64')
  }

  pem(): string {
    return readFileSync(this.certFile, 'utf8')
  }

  /** Issue (or reuse) a certificate for one hostname. */
  async issue(host: string): Promise<{ key: string; cert: string }> {
    if (!/^[a-z0-9.-]+$/i.test(host)) throw new Error(`Invalid hostname ${host}`)
    const key = join(this.dir, 'sites', `${host}.key`)
    const cert = join(this.dir, 'sites', `${host}.pem`)
    if (existsSync(key) && existsSync(cert)) return { key, cert }
    await this.ensure()
    const csr = join(this.dir, 'sites', `${host}.csr`)
    const ext = join(this.dir, 'sites', `${host}.ext`)
    await run('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', key])
    await run('openssl', ['req', '-new', '-key', key, '-out', csr, '-subj', `/CN=${host}`])
    writeFileSync(
      ext,
      [`subjectAltName=DNS:${host}`, 'basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature', 'extendedKeyUsage=serverAuth'].join('\n')
    )
    // 397 days keeps within Apple's limit for TLS server certificates.
    await run('openssl', ['x509', '-req', '-in', csr, '-CA', this.certFile, '-CAkey', this.keyFile, '-CAcreateserial', '-out', cert, '-days', '397', '-sha256', '-extfile', ext])
    return { key, cert }
  }

  async context(host: string): Promise<SecureContext> {
    const cached = this.contexts.get(host)
    if (cached) return cached
    const { key, cert } = await this.issue(host)
    const ctx = createSecureContext({ key: readFileSync(key), cert: readFileSync(cert) + this.pem() })
    this.contexts.set(host, ctx)
    return ctx
  }

  /** Is the CA trusted by macOS (so Safari/Chrome accept the sites too)? */
  async trustedBySystem(): Promise<boolean> {
    if (!existsSync(this.certFile)) return false
    const { cert } = await this.issue('trust-check.localhost')
    const r = await exec('security', ['verify-cert', '-c', cert, '-r', this.certFile, '-p', 'ssl', '-s', 'trust-check.localhost', '-L', '-q'], { timeoutMs: 15_000 })
    const r2 = await exec('security', ['verify-cert', '-c', cert, '-p', 'ssl', '-s', 'trust-check.localhost', '-q'], { timeoutMs: 15_000 })
    return r.code === 0 && r2.code === 0
  }

  /** Add the CA to the login keychain as a trusted root. macOS asks the user to confirm. */
  async trustInSystem(): Promise<void> {
    await this.ensure()
    const keychain = join(process.env.HOME || '', 'Library/Keychains/login.keychain-db')
    await run('security', ['add-trusted-cert', '-r', 'trustRoot', '-p', 'ssl', '-k', keychain, this.certFile], { timeoutMs: 120_000 })
  }
}

// ---------------------------------------------------------------- sites + proxy

export interface Site {
  host: string
  /** project or worktree root */
  root: string
  /** directory served (public/ for Laravel) */
  docroot: string
  /** internal port of the PHP backend */
  port: number
  owner: string // feature id or `project:<id>`
}

export interface ServerHooks {
  /** start the site's backend if it isn't running; resolves when it accepts connections */
  ensureBackend(site: Site): Promise<void>
}

const isLoopback = (addr?: string) => !!addr && (addr === '::1' || addr.startsWith('127.') || addr === '::ffff:127.0.0.1' || addr.startsWith('::ffff:127.'))

export function waitForPort(port: number, timeoutMs = 15_000): Promise<boolean> {
  const until = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const attempt = () => {
      const s = connect({ port, host: '127.0.0.1' })
      s.once('connect', () => {
        s.destroy()
        resolve(true)
      })
      s.once('error', () => {
        s.destroy()
        if (Date.now() > until) resolve(false)
        else setTimeout(attempt, 150)
      })
    }
    attempt()
  })
}

/** Router for `php -S`: makes Laravel see the real HTTPS scheme/host and serves static files directly. */
export const PHP_ROUTER = `<?php
// Spindle / Make — router for PHP's built-in server behind the HTTPS proxy.
if (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') {
    $_SERVER['HTTPS'] = 'on';
    $_SERVER['REQUEST_SCHEME'] = 'https';
}
if (!empty($_SERVER['HTTP_X_FORWARDED_PORT'])) {
    $_SERVER['SERVER_PORT'] = $_SERVER['HTTP_X_FORWARDED_PORT'];
}
$docroot = getenv('SPINDLE_DOCROOT') ?: getcwd();
$path = urldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
if ($path !== '/' && is_file($docroot . $path)) {
    return false;
}
foreach (['/index.php', '/index.html'] as $front) {
    if (is_file($docroot . $front)) {
        if (str_ends_with($front, '.html')) { readfile($docroot . $front); return true; }
        $_SERVER['SCRIPT_FILENAME'] = $docroot . $front;
        $_SERVER['SCRIPT_NAME'] = $front;
        $_SERVER['PHP_SELF'] = $front;
        chdir($docroot);
        require $docroot . $front;
        return true;
    }
}
http_response_code(404);
echo 'Not found';
`

function startingPage(host: string, error?: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${host}</title>${error ? '' : '<meta http-equiv="refresh" content="1">'}
<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#11130f;color:#eeeee7;font:16px/1.5 -apple-system,'DM Sans',sans-serif}
.b{text-align:center;max-width:520px;padding:24px}.d{width:10px;height:10px;border-radius:50%;background:#c4ff48;display:inline-block;margin-right:8px;animation:p 1s infinite}
@keyframes p{50%{opacity:.3}}small{color:#a0a696}pre{color:#ff7a66;white-space:pre-wrap;text-align:left}</style></head>
<body><div class="b">${error ? `<div>Couldn’t start <b>${host}</b></div><pre>${error.replace(/</g, '&lt;')}</pre>` : `<div><span class="d"></span>Starting <b>${host}</b>…</div>`}<small>Spindle / Make</small></div></body></html>`
}

/**
 * Spindle's built-in web server: HTTPS on 443 (8443 when taken) and HTTP that redirects,
 * routing each hostname to its site's PHP backend. Only connections from this Mac are served.
 */
export class WebServer {
  private sites = new Map<string, Site>()
  private servers: (http.Server | https.Server)[] = []
  httpsPort = 0
  httpPort = 0

  constructor(
    private ca: LocalCA,
    private hooks: ServerHooks
  ) {}

  register(site: Site): void {
    this.sites.set(site.host.toLowerCase(), site)
  }

  unregister(host: string): void {
    this.sites.delete(host.toLowerCase())
  }

  list(): Site[] {
    return [...this.sites.values()]
  }

  get(host: string): Site | undefined {
    return this.sites.get(host.toLowerCase())
  }

  url(host: string): string {
    return `https://${host}${this.httpsPort === 443 ? '' : `:${this.httpsPort}`}`
  }

  async start(opts: { https: number[]; http: number[] } = { https: [443, 8443, 9443], http: [80, 8080, 9080] }): Promise<void> {
    await this.ca.ensure()
    const makeTls = () => {
      const tls = https.createServer(
        {
          SNICallback: (servername, cb) => {
            this.ca
              .context(servername.toLowerCase())
              .then((ctx) => cb(null, ctx))
              .catch((e) => cb(e as Error))
          }
        },
        (req, res) => void this.handle(req, res, 'https')
      )
      tls.on('upgrade', (req, socket, head) => void this.upgrade(req, socket as Socket, head))
      tls.on('connection', (sock: Socket) => {
        if (!isLoopback(sock.remoteAddress)) sock.destroy()
      })
      return tls
    }
    const makePlain = () =>
      http.createServer((req, res) => {
        if (!isLoopback(req.socket.remoteAddress)) return res.destroy()
        const host = (req.headers.host ?? '').split(':')[0]
        res.writeHead(301, { Location: this.url(host) + (req.url ?? '/') })
        res.end()
      })
    this.httpsPort = await this.listenDual(makeTls, opts.https)
    this.httpPort = await this.listenDual(makePlain, opts.http).catch(() => 0)
  }

  /** Low ports: wildcard (the only unprivileged option on macOS). High ports: loopback v4 + v6 only. */
  private async listenDual(make: () => http.Server | https.Server, candidates: number[]): Promise<number> {
    for (const port of candidates) {
      if (port < 1024) {
        const s = make()
        if (await tryListen(s, port, '::')) {
          this.servers.push(s)
          return port
        }
        continue
      }
      const v4 = make()
      if (!(await tryListen(v4, port, '127.0.0.1'))) continue
      // "*.localhost" resolves to ::1 first on macOS, so listen there too.
      const v6 = make()
      const ok6 = await tryListen(v6, port, '::1')
      this.servers.push(v4, ...(ok6 ? [v6] : []))
      return port
    }
    throw new Error(`No free port among ${candidates.join(', ')}`)
  }

  stop(): void {
    for (const s of this.servers) s.close()
    this.servers = []
  }

  private async handle(req: IncomingMessage, res: ServerResponse, proto: 'https' | 'http'): Promise<void> {
    if (!isLoopback(req.socket.remoteAddress)) return void res.destroy()
    const host = (req.headers.host ?? '').split(':')[0].toLowerCase()
    const site = this.sites.get(host)
    if (!site) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
      res.end(startingPage(host, `No site is set up for ${host} in Spindle / Make.`))
      return
    }
    try {
      await this.hooks.ensureBackend(site)
    } catch (e) {
      res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' })
      res.end(startingPage(host, (e as Error).message))
      return
    }
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: site.port,
        method: req.method,
        path: req.url,
        headers: {
          ...req.headers,
          'x-forwarded-proto': proto,
          'x-forwarded-host': req.headers.host ?? host,
          'x-forwarded-port': String(proto === 'https' ? this.httpsPort : this.httpPort),
          'x-forwarded-for': req.socket.remoteAddress ?? '127.0.0.1'
        }
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.statusMessage, up.headers)
        up.pipe(res)
      }
    )
    upstream.on('error', () => {
      if (res.headersSent) return res.destroy()
      // backend restarting: show the auto-refreshing "starting" page
      res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'retry-after': '1' })
      res.end(startingPage(host))
    })
    req.pipe(upstream)
  }

  /** WebSocket / upgrade passthrough (Reverb, Livewire, etc.). */
  private async upgrade(req: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
    if (!isLoopback(socket.remoteAddress)) return void socket.destroy()
    const host = (req.headers.host ?? '').split(':')[0].toLowerCase()
    const site = this.sites.get(host)
    if (!site) return void socket.destroy()
    try {
      await this.hooks.ensureBackend(site)
    } catch {
      return void socket.destroy()
    }
    const up = connect({ host: '127.0.0.1', port: site.port }, () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`]
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
      lines.push('X-Forwarded-Proto: https', '', '')
      up.write(lines.join('\r\n'))
      if (head.length) up.write(head)
      up.pipe(socket)
      socket.pipe(up)
    })
    up.on('error', () => socket.destroy())
    socket.on('error', () => up.destroy())
  }
}

function tryListen(server: http.Server | https.Server, port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const onError = () => {
      server.off('listening', onListening)
      resolve(false)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve(true)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen({ port, host, ipv6Only: host === '::1' })
  })
}

/** Free TCP port on loopback at or after `start`. */
export async function freePort(start: number): Promise<number> {
  for (let port = start; port < start + 500; port++) {
    const ok = await new Promise<boolean>((resolve) => {
      const srv = createNetServer()
      srv.once('error', () => resolve(false))
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)))
    })
    if (ok) return port
  }
  throw new Error('No free port')
}

/** Hostname for a site: "<feature>.<project>.localhost" or "<project>.localhost". */
export function siteHost(projectSlug: string, featureSlug?: string): string {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'site'
  return featureSlug ? `${clean(featureSlug)}.${clean(projectSlug)}.localhost` : `${clean(projectSlug)}.localhost`
}
