import { NextResponse, type NextRequest } from 'next/server'

/**
 * Every request passes through here, so this is where the workspace is
 * protected.
 *
 * 1. HTTP Basic authentication from FRONTEND_AUTH_USER / FRONTEND_AUTH_PASSWORD.
 *    In production the server refuses to serve at all until both are set
 *    (or FRONTEND_AUTH_DISABLED=true says an upstream proxy does it).
 * 2. Cross-site request forgery: a mutating call to /api must come from this
 *    origin. Browsers say so with Sec-Fetch-Site or Origin; a request with
 *    neither is not a browser and is left to Basic auth.
 * 3. A Content-Security-Policy with a per-request nonce, which Next.js picks
 *    up for its own inline scripts.
 *
 * Health endpoints stay open for the kubelet's probes.
 */

export const config = {
  matcher: ['/((?!_next/static|_next/image|icon\\.svg|favicon\\.ico).*)'],
}

const USER = process.env.FRONTEND_AUTH_USER ?? ''
const PASSWORD = process.env.FRONTEND_AUTH_PASSWORD ?? ''
const AUTH_DISABLED = process.env.FRONTEND_AUTH_DISABLED === 'true'
const PRODUCTION = process.env.NODE_ENV === 'production'
const HEALTH = new Set(['/api/healthz', '/api/readyz'])
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const encoder = new TextEncoder()

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

/** Constant-time equality over fixed-length digests, so neither length nor prefix leaks. */
async function same(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([digest(a), digest(b)])
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

function credentials(header: string | null): { user: string; password: string } | null {
  if (!header || !header.startsWith('Basic ')) return null
  try {
    const decoded = atob(header.slice(6).trim())
    const at = decoded.indexOf(':')
    if (at < 0) return null
    return { user: decoded.slice(0, at), password: decoded.slice(at + 1) }
  } catch {
    return null
  }
}

async function authorised(request: NextRequest): Promise<boolean> {
  const presented = credentials(request.headers.get('authorization'))
  if (!presented) return false
  const [userOk, passwordOk] = await Promise.all([same(presented.user, USER), same(presented.password, PASSWORD)])
  return userOk && passwordOk
}

function sameOrigin(request: NextRequest): boolean {
  const site = request.headers.get('sec-fetch-site')
  if (site) return site === 'same-origin' || site === 'none'
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === request.headers.get('host')
  } catch {
    return false
  }
}

function challenge(): NextResponse {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'www-authenticate': 'Basic realm="All Dash", charset="UTF-8"', 'cache-control': 'no-store' },
  })
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname

  if (!HEALTH.has(path)) {
    if (USER && PASSWORD) {
      if (!(await authorised(request))) return challenge()
    } else if (PRODUCTION && !AUTH_DISABLED) {
      return NextResponse.json(
        {
          detail:
            'Frontend authentication is not configured: set FRONTEND_AUTH_USER and FRONTEND_AUTH_PASSWORD, or FRONTEND_AUTH_DISABLED=true behind an authenticating proxy.',
        },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      )
    }
    if (path.startsWith('/api/') && MUTATING.has(request.method) && !sameOrigin(request)) {
      return NextResponse.json({ detail: 'Cross-site request refused' }, { status: 403 })
    }
  }

  const nonce = btoa(crypto.randomUUID())
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${PRODUCTION ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('content-security-policy', csp)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('content-security-policy', csp)
  return response
}
