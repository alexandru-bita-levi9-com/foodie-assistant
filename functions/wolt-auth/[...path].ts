export async function onRequest(context: any) {
  const { request, env, params } = context
  const url = new URL(request.url)
  const path = params?.path ? `/${params.path.join('/')}` : ''
  const upstream = `https://authentication.wolt.com${path}${url.search}`

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
      // forward original body
      if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body
    }
  } else {
    if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body
  }

  const resp = await fetch(upstream, init)
  const respHeaders = new Headers(resp.headers)
  return new Response(resp.body, { status: resp.status, headers: respHeaders })
}
