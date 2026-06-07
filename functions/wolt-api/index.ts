export async function onRequest(context: any) {
  const { request, env } = context
  const url = new URL(request.url)
  const base = '/wolt-api'
  let path = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname
  if (path === '' || path === '/') {
    path = ''
  } else if (!path.startsWith('/')) {
    path = '/' + path
  }
  const upstream = `https://consumer-api.wolt.com${path}${url.search}`

  const forwarded = new Headers(request.headers)
  forwarded.set('Origin', 'https://wolt.com')
  forwarded.set('Referer', 'https://wolt.com/')
  forwarded.delete('host')

  if (!forwarded.get('authorization') && env?.WOLT_AUTH_TOKEN) {
    forwarded.set('Authorization', env.WOLT_AUTH_TOKEN)
  }

  const init: any = { method: request.method, headers: forwarded, redirect: 'manual' }
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body

  const resp = await fetch(upstream, init)

  const respHeaders = new Headers(resp.headers)
  // Pass through response headers
  return new Response(resp.body, { status: resp.status, headers: respHeaders })
}