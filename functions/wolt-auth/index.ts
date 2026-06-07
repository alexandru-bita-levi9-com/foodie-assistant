export async function onRequest(context: any) {
  const { request, env } = context
  const url = new URL(request.url)
  const base = '/wolt-auth'
  // Allow requests to pass the upstream path in the `path` query param
  // e.g. POST /wolt-auth?path=/v1/wauth2/access_token
  const qp = url.searchParams.get('path')
  let path = ''
  if (qp) {
    path = qp.startsWith('/') ? qp : '/' + qp
  } else {
    path = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname
    if (path === '' || path === '/') {
      path = ''
    } else if (!path.startsWith('/')) {
      path = '/' + path
    }
  }

  // Rebuild query string excluding our internal `path` param
  const params = new URLSearchParams(url.searchParams)
  params.delete('path')
  const qs = params.toString()
  const upstream = `https://authentication.wolt.com${path}${qs ? `?${qs}` : ''}`

  const forwarded = new Headers(request.headers)
  forwarded.set('Origin', 'https://wolt.com')
  forwarded.set('Referer', 'https://wolt.com/')
  forwarded.delete('host')

  if (!forwarded.get('authorization') && env?.WOLT_AUTH_TOKEN) {
    forwarded.set('Authorization', env.WOLT_AUTH_TOKEN)
  }

  const init: any = { method: request.method, headers: forwarded, redirect: 'manual' }

  // Special-case the token refresh endpoint: if the client did not provide a refresh_token
  // use the server-side `WOLT_REFRESH_TOKEN` secret so refresh can happen without exposing it.
  if (request.method === 'POST' && path.endsWith('/v1/wauth2/access_token')) {
    const contentType = forwarded.get('content-type') || ''
    let bodyText = ''

    try {
      bodyText = await request.text()
    } catch {
      bodyText = ''
    }

    const hasRefresh = /refresh_token\s*=/.test(bodyText)

    if (!hasRefresh && env?.WOLT_REFRESH_TOKEN) {
      const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.WOLT_REFRESH_TOKEN })
      init.body = params.toString()
      init.headers.set('content-type', 'application/x-www-form-urlencoded')
    } else {
      // forward original body - we already consumed it into `bodyText`, so reuse that
      if (request.method !== 'GET' && request.method !== 'HEAD') init.body = bodyText
    }
  } else {
    if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body
  }

  const resp = await fetch(upstream, init)
  const respHeaders = new Headers(resp.headers)
  return new Response(resp.body, { status: resp.status, headers: respHeaders })
}