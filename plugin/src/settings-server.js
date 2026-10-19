import { readSettings, writeSettings } from './publish.js'

const SETTINGS_PATH = '/dsh-paper/settings'

export function registerSettingsRoute(ctx, pluginRoot) {
  return ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-paper',
    handler: async (request, response) => {
      try {
        const bodyText = request.method === 'POST' ? await readBody(request) : ''
        const result = handleSettingsRequest(pluginRoot, request.method, request.url, bodyText)
        sendJson(response, result.status, result.body)
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  })
}

export function handleSettingsRequest(pluginRoot, method, url, bodyText) {
  try {
    const pathname = new URL(url ?? '/', 'http://127.0.0.1').pathname.replace(/\/+$/, '') || '/'
    if (pathname !== SETTINGS_PATH) return { status: 404, body: { error: '没有这个地址' } }
    if (method === 'GET') return { status: 200, body: readSettings(pluginRoot) }
    if (method === 'POST') {
      let input
      try {
        input = JSON.parse(bodyText || '')
      } catch {
        return { status: 400, body: { error: '设置内容不是 JSON' } }
      }
      return { status: 200, body: writeSettings(pluginRoot, input) }
    }
    return { status: 405, body: { error: '只接受 GET 和 POST' } }
  } catch (error) {
    return { status: 400, body: { error: error instanceof Error ? error.message : String(error) } }
  }
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('设置内容过大'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}
