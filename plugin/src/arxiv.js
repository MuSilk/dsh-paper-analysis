const ARXIV_ID_RE = /(\d{4}\.\d{4,5})/

export function normalizeArxivId(value) {
  const match = ARXIV_ID_RE.exec(String(value ?? ''))
  return match ? match[1] : ''
}

function decodeXml(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => fromCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => fromCode(Number(dec)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&#10;', '\n')
    .replaceAll('&amp;', '&')
}

function fromCode(code) {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return ''
  return String.fromCodePoint(code)
}

function textOf(xml, tag) {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml)
  return match ? decodeXml(match[1]).replace(/\s+/g, ' ').trim() : ''
}

export function parseAtom(xml) {
  const entries = []
  for (const chunk of String(xml).split('<entry>').slice(1)) {
    const body = chunk.split('</entry>')[0]
    const arxiv = normalizeArxivId(textOf(body, 'id'))
    if (!arxiv) continue
    const pdfLink =
      /<link[^>]*title="pdf"[^>]*href="([^"]+)"/.exec(body) ||
      /<link[^>]*href="([^"]+)"[^>]*title="pdf"/.exec(body)
    const authors = [...body.matchAll(/<name>([^<]*)<\/name>/g)].map((item) => decodeXml(item[1]).trim())
    entries.push({
      arxiv,
      title: textOf(body, 'title'),
      summary: textOf(body, 'summary'),
      published: textOf(body, 'published').slice(0, 10),
      authors,
      pdf: pdfLink ? pdfLink[1] : `https://arxiv.org/pdf/${arxiv}`,
      abs: `https://arxiv.org/abs/${arxiv}`,
    })
  }
  return entries
}

export function selectPaper(entries, seen) {
  let chosen = null
  for (const entry of entries) {
    if (!entry.arxiv || seen.has(entry.arxiv)) continue
    const published = entry.published || '9999-99-99'
    if (!chosen || published < (chosen.published || '9999-99-99')) chosen = entry
  }
  return chosen
}

export const PAGE_SIZE = 100
export const MAX_PAGES = 20

export function formatSubmittedStamp(date) {
  const y = date.getUTCFullYear()
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const h = String(date.getUTCHours()).padStart(2, '0')
  const mi = String(date.getUTCMinutes()).padStart(2, '0')
  return `${y}${mo}${d}${h}${mi}`
}

export const DEFAULT_BASE_URL = 'https://export.arxiv.org'

export function normalizeBaseUrl(value) {
  const raw = String(value ?? DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('baseUrl 必须是 https 地址，例如 https://export.arxiv.org')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('baseUrl 必须是不带账号和查询参数的 https 地址')
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('baseUrl 只写网站根地址，不要带路径')
  }
  return url.origin
}

export function arxivQueryUrl({ categories, arxiv, start = 0, maxResults = PAGE_SIZE, submittedFrom, submittedTo, baseUrl = DEFAULT_BASE_URL }) {
  const root = normalizeBaseUrl(baseUrl)
  const id = normalizeArxivId(arxiv)
  if (id) return `${root}/api/query?id_list=${encodeURIComponent(id)}`
  let search = categories.map((category) => `cat:${category}`).join(' OR ')
  if (submittedFrom && submittedTo) {
    const from = formatSubmittedStamp(submittedFrom)
    const to = formatSubmittedStamp(submittedTo)
    search = `(${search}) AND submittedDate:[${from} TO ${to}]`
  }
  const params = new URLSearchParams({
    search_query: search,
    sortBy: 'submittedDate',
    sortOrder: 'ascending',
    start: String(start),
    max_results: String(maxResults),
  })
  return `${root}/api/query?${params}`
}

export const API_TIMEOUT_MS = 30_000
export const API_ATTEMPTS = 3
export const API_MIN_INTERVAL_MS = 3_000
export const API_RETRY_BASE_MS = 5_000
const HTML_TIMEOUT_MS = 30_000
const PDF_TIMEOUT_MS = 15_000
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const USER_AGENT = 'dsh-paper/0.1.0 (+https://github.com/MuSilk/dsh-paper-analysis)'

let lastApiRequestAt = Number.NEGATIVE_INFINITY

export function resetApiPacer() {
  lastApiRequestAt = Number.NEGATIVE_INFINITY
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function arxivOptions(timeoutMs) {
  return {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  }
}

function retryAfterMs(response) {
  const raw = response?.headers?.get?.('retry-after')
  if (!raw) return 0
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(raw)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0
}

function backoffMs(attempt, baseMs) {
  const base = baseMs * 2 ** (attempt - 1)
  return Math.round(base + Math.random() * base * 0.25)
}

function isRetryableNetworkError(error) {
  const name = error?.name
  return name === 'TimeoutError' || name === 'AbortError' || error instanceof TypeError
}

function requestFailure(status, attempts) {
  if (status === 429) {
    return new Error(`arXiv 接口限流（HTTP 429），已尝试 ${attempts} 次。请等几分钟再试，或直接传入 arXiv 编号。`)
  }
  if (status >= 500) {
    return new Error(`arXiv 接口暂时不可用（HTTP ${status}），已尝试 ${attempts} 次。请稍后再试，或直接传入 arXiv 编号。`)
  }
  return new Error(`arXiv 请求失败：${status}`)
}

async function paceRequest({ minIntervalMs, sleepImpl, now }) {
  if (!(minIntervalMs > 0)) return
  const wait = lastApiRequestAt + minIntervalMs - now()
  if (wait > 0) await sleepImpl(wait)
  lastApiRequestAt = now()
}

export async function fetchArxivEntries({
  categories,
  arxiv,
  fetchImpl = fetch,
  start = 0,
  maxResults = PAGE_SIZE,
  submittedFrom,
  submittedTo,
  baseUrl = DEFAULT_BASE_URL,
  attempts = API_ATTEMPTS,
  timeoutMs = API_TIMEOUT_MS,
  minIntervalMs = API_MIN_INTERVAL_MS,
  retryBaseMs = API_RETRY_BASE_MS,
  sleepImpl = sleep,
  now = () => Date.now(),
}) {
  const url = arxivQueryUrl({ categories, arxiv, start, maxResults, submittedFrom, submittedTo, baseUrl })
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await paceRequest({ minIntervalMs, sleepImpl, now })
    let response
    try {
      response = await fetchImpl(url, arxivOptions(timeoutMs))
    } catch (error) {
      if (attempt === attempts || !isRetryableNetworkError(error)) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
          throw new Error(`arXiv 接口超时（${Math.round(timeoutMs / 1000)} s，已尝试 ${attempt} 次）。请稍后再试，或直接传入 arXiv 编号。`)
        }
        throw new Error(`arXiv 请求失败（已尝试 ${attempt} 次）：${error instanceof Error ? error.message : String(error)}`)
      }
      await sleepImpl(backoffMs(attempt, retryBaseMs))
      continue
    }
    if (response.ok) return parseAtom(await response.text())
    if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts) {
      throw requestFailure(response.status, attempt)
    }
    await sleepImpl(Math.max(retryAfterMs(response), backoffMs(attempt, retryBaseMs)))
  }
  throw new Error('arXiv 请求失败')
}

export function htmlToText(html) {
  const source = /<article\b[\s\S]*<\/article>/i.exec(String(html))?.[0]
    ?? /<body\b[\s\S]*<\/body>/i.exec(String(html))?.[0]
    ?? String(html)
  const text = decodeXml(
    source
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
      .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<[^>]+>/g, '\n'),
  )
  return text
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

export async function fetchPaperFiles({ arxiv, fetchImpl = fetch, baseUrl = DEFAULT_BASE_URL }) {
  const id = normalizeArxivId(arxiv)
  if (!id) return { html: '', pdf: null }
  const root = normalizeBaseUrl(baseUrl)
  const [html, pdf] = await Promise.all([
    fetchHtml(root, id, fetchImpl).catch(() => ''),
    fetchPdf(root, id, fetchImpl).catch(() => null),
  ])
  return { html, pdf }
}

async function fetchHtml(root, id, fetchImpl) {
  const response = await fetchImpl(
    `${root}/html/${encodeURIComponent(id)}`,
    arxivOptions(HTML_TIMEOUT_MS),
  )
  if (!response.ok) return ''
  const raw = await response.text()
  return /<html[\s>]/i.test(raw) ? raw : ''
}

async function fetchPdf(root, id, fetchImpl) {
  const response = await fetchImpl(
    `${root}/pdf/${encodeURIComponent(id)}`,
    arxivOptions(PDF_TIMEOUT_MS),
  )
  if (!response.ok || typeof response.arrayBuffer !== 'function') return null
  const bytes = Buffer.from(await response.arrayBuffer())
  return bytes.subarray(0, 5).toString() === '%PDF-' ? bytes : null
}

export function formatPaper(paper, files = {}) {
  const html = files.html || ''
  const pdf = files.pdf || ''
  return [
    '先用 skill 工具加载 paper-analysis，按其中的结构写解读，然后调用 paper_save。',
    '不要使用网页获取去打开 arXiv。本机把 arxiv.org 解析到代理地址，网页获取会拒绝。',
    html || pdf
      ? '全文在下面的文件里，请自己读取。优先读 html，里面有章节和公式。'
      : '没有下到 HTML 或 PDF，只能根据 summary 写。仍然不要使用网页获取。',
    'paper_save 的 date 填下面的 published，这是 arXiv 第一版挂载日期，月份目录按它分。不要填今天下载的日期。',
    '落盘后用你自己的 git 工具提交并推送。提交说明：docs: 新增论文解读 <标题>',
    '',
    `arxiv: ${paper.arxiv}`,
    `title: ${paper.title}`,
    `authors: ${paper.authors.join(', ')}`,
    `published: ${paper.published}`,
    `abs: ${paper.abs}`,
    html ? `html: ${html}` : '',
    pdf ? `pdf: ${pdf}` : html ? 'pdf: 没下到，读 html 即可' : '',
    '',
    'summary:',
    paper.summary,
  ].filter((line) => line !== '').join('\n')
}
