import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { DEFAULT_BASE_URL, MAX_PAGES, PAGE_SIZE, fetchArxivEntries, fetchPaperFiles, formatPaper, normalizeArxivId, normalizeBaseUrl, selectPaper } from './arxiv.js'

export const TOPICS = [
  '视觉语言动作模型',
  '机器人操作与抓取',
  '强化学习与运动控制',
  '人形与移动操作',
  '仿真与 Sim2Real',
  '数据与数据引擎',
  '评测与基准',
  '世界模型与三维感知',
  '具身推理与规划',
  '硬件与系统',
  '其他',
]

const DEFAULT_CATEGORIES = ['cs.RO', 'cs.CV', 'cs.LG', 'cs.AI', 'cs.HC']
const DEFAULT_LOOKBACK_DAYS = 1
const MAX_LOOKBACK_DAYS = 14
const CATEGORY_RE = /^[a-z-]+\.[A-Z]{2}$/
const SLUG_RE = /^[\p{L}\p{N}_-]{1,80}$/u
const MONTH_RE = /^\d{6}$/
const SKIP_DIR = '_skip'
const ARTICLE_RE = /^\d{8}_[^/\\]+\.md$/

export function loadConfig(pluginRoot) {
  const path = join(pluginRoot, 'paper.config.json')
  if (!existsSync(path)) return defaultConfig()
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('paper.config.json 必须是对象')
  }
  if (raw.repoRoot !== undefined && typeof raw.repoRoot !== 'string') {
    throw new Error('repoRoot 必须是字符串')
  }
  return {
    repoRoot: typeof raw.repoRoot === 'string' ? raw.repoRoot.trim() : '',
    categories: parseCategories(raw.categories),
    lookbackDays: parseLookbackDays(raw.lookbackDays),
    baseUrl: normalizeBaseUrl(raw.baseUrl),
  }
}

function defaultConfig() {
  return {
    repoRoot: '',
    categories: [...DEFAULT_CATEGORIES],
    lookbackDays: DEFAULT_LOOKBACK_DAYS,
    baseUrl: DEFAULT_BASE_URL,
  }
}

function parseLookbackDays(value) {
  if (value === undefined || value === '') return DEFAULT_LOOKBACK_DAYS
  const days = Number(value)
  if (!Number.isInteger(days) || days < 1 || days > MAX_LOOKBACK_DAYS) {
    throw new Error(`lookbackDays 必须是 1 到 ${MAX_LOOKBACK_DAYS} 的整数`)
  }
  return days
}

function parseCategories(value) {
  if (value === undefined) return [...DEFAULT_CATEGORIES]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !CATEGORY_RE.test(item))) {
    throw new Error('categories 必须是 arXiv 分类数组，例如 cs.AI')
  }
  return value.length > 0 ? value : [...DEFAULT_CATEGORIES]
}

export function resolveRepoRoot(pluginRoot, config) {
  const target = config.repoRoot ? resolve(config.repoRoot) : resolve(pluginRoot, '..')
  return realpathSync(target)
}

export function loadTopics(repoRoot) {
  const path = join(repoRoot, 'topics.json')
  if (!existsSync(path)) return [...TOPICS]
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error('topics.json 必须是非空字符串数组')
  }
  return raw.map((item) => item.trim())
}

export function readSettings(pluginRoot) {
  const config = loadConfig(pluginRoot)
  const root = resolveRepoRoot(pluginRoot, config)
  return {
    categories: config.categories,
    lookbackDays: config.lookbackDays,
    baseUrl: config.baseUrl,
    topics: loadTopics(root),
  }
}

export function writeSettings(pluginRoot, input) {
  const current = loadConfig(pluginRoot)
  const categories = parseCategories(input?.categories)
  const lookbackDays = parseLookbackDays(input?.lookbackDays)
  const baseUrl = normalizeBaseUrl(input?.baseUrl)
  const topics = parseTopics(input?.topics)
  const root = resolveRepoRoot(pluginRoot, current)
  writeFileSync(join(root, 'topics.json'), `${JSON.stringify(topics, null, 2)}\n`, 'utf8')
  writeFileSync(
    join(pluginRoot, 'paper.config.json'),
    `${JSON.stringify({ repoRoot: current.repoRoot, categories, lookbackDays, baseUrl }, null, 2)}\n`,
    'utf8',
  )
  return readSettings(pluginRoot)
}

function parseTopics(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 40) {
    throw new Error('主题列表需要 1 到 40 项')
  }
  const topics = value.map((item) => String(item ?? '').trim())
  if (topics.some((item) => !item || item.length > 40)) throw new Error('每个主题不能为空，且不超过 40 字')
  if (new Set(topics).size !== topics.length) throw new Error('主题不能重复')
  return topics
}

function parseDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  const y = Number(match[1])
  const mo = Number(match[2])
  const d = Number(match[3])
  const dt = new Date(y, mo - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
  return { y, mo, d }
}

function isInside(root, abs) {
  const rel = relative(root, abs)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function yamlString(value) {
  if (/[:#\n"'&]/.test(value) || value.trim() !== value) return JSON.stringify(value)
  return value
}

export function composeMarkdown({ title, arxiv, topic, date, body }) {
  const heading = String(title ?? '').trim()
  if (!heading) return { error: '标题不能为空' }
  if (heading.length > 200) return { error: '标题超过 200 字' }
  const trimmed = String(body ?? '').replace(/\r\n/g, '\n').trim()
  if (!trimmed) return { error: '正文不能为空' }
  if (trimmed.length > 512 * 1024) return { error: '正文超过 512 KiB' }
  if (trimmed.startsWith('---')) return { error: '正文不要自带 frontmatter，论文信息由工具写入' }
  const h1 = `# ${heading}`
  let article = trimmed
  if (trimmed.startsWith('# ')) {
    const first = trimmed.split('\n', 1)[0].trim()
    if (first !== h1) return { error: `正文第一行是「${first}」，与标题不一致` }
    article = trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`
  } else {
    article = `${h1}\n\n${trimmed}\n`
  }
  const content = [
    '---',
    `title: ${yamlString(heading)}`,
    `arxiv: ${arxiv}`,
    `topic: ${yamlString(topic)}`,
    `date: ${date}`,
    '---',
    '',
    article,
  ].join('\n')
  return { content }
}

export function findArxivIds(repoRoot) {
  const seen = new Set()
  const papersRoot = join(repoRoot, 'papers')
  let names = []
  try {
    names = readdirSync(papersRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && MONTH_RE.test(entry.name))
      .map((entry) => entry.name)
  } catch {
    return seen
  }
  for (const month of names) {
    const dir = join(papersRoot, month)
    for (const file of readdirSync(dir)) {
      if (!ARTICLE_RE.test(file)) continue
      const text = readFileSync(join(dir, file), 'utf8')
      for (const match of text.matchAll(/\d{4}\.\d{4,5}/g)) seen.add(match[0])
    }
  }
  collectIds(join(papersRoot, SKIP_DIR), seen)
  return seen
}

// 跳过记录不计入站点，只用来让 fetch_paper 下次别再取同一篇。
function collectIds(dir, seen) {
  let files = []
  try {
    files = readdirSync(dir).filter((name) => name.endsWith('.md'))
  } catch {
    return
  }
  for (const file of files) {
    const text = readFileSync(join(dir, file), 'utf8')
    for (const match of text.matchAll(/\d{4}\.\d{4,5}/g)) seen.add(match[0])
  }
}

export function planArticle({ repoRoot, title, slug, arxiv, topic, date, body }) {
  const root = realpathSync(repoRoot)
  const name = String(slug ?? '').trim()
  if (!SLUG_RE.test(name)) return { error: '短名只允许字母、数字、中文、下划线和连字符，最长 80 字' }
  const id = normalizeArxivId(arxiv)
  if (!id) return { error: 'arxiv 必须是类似 2606.19926 的编号' }
  const topics = loadTopics(root)
  const topicName = String(topic ?? '').trim()
  if (!topics.includes(topicName)) return { error: `topic 必须是其中之一：${topics.join('、')}` }
  const iso = String(date ?? '').trim()
  const parsed = parseDate(iso)
  if (!parsed) return { error: 'date 必须是 arXiv 第一版挂载日期，格式 YYYY-MM-DD' }
  if (findArxivIds(root).has(id)) return { error: `已经写过 ${id}` }

  const composed = composeMarkdown({ title, arxiv: id, topic: topicName, date: iso, body })
  if (composed.error) return composed
  const month = `${parsed.y}${String(parsed.mo).padStart(2, '0')}`
  const day = `${month}${String(parsed.d).padStart(2, '0')}`
  const relativePath = `papers/${month}/${day}_${name}.md`
  const absolutePath = resolve(root, 'papers', month, `${day}_${name}.md`)
  if (!isInside(root, absolutePath)) return { error: '路径越出了站点仓库' }
  if (existsSync(absolutePath)) return { error: `同名文件已存在：${relativePath}` }
  return { root, relativePath, absolutePath, content: composed.content }
}

export function writePlanned(plan) {
  mkdirSync(dirname(plan.absolutePath), { recursive: true })
  const dir = realpathSync(dirname(plan.absolutePath))
  if (!isInside(plan.root, dir) && dir !== plan.root) return { error: '月份目录越出了站点仓库' }
  try {
    writeFileSync(plan.absolutePath, plan.content, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if (error && error.code === 'EEXIST') return { error: `同名文件已存在：${plan.relativePath}` }
    throw error
  }
  return { relativePath: plan.relativePath }
}

export function saveArticle(input) {
  const plan = planArticle(input)
  if (plan.error) return plan
  const written = writePlanned(plan)
  if (written.error) return written
  return { relativePath: written.relativePath, title: String(input.title).trim() }
}

export async function pickPaper({ repoRoot, categories, arxiv, fetchImpl, lookbackDays = DEFAULT_LOOKBACK_DAYS, baseUrl = DEFAULT_BASE_URL, now = new Date(), peek = false }) {
  const root = realpathSync(repoRoot)
  const seen = findArxivIds(root)
  const id = normalizeArxivId(arxiv)
  if (id && seen.has(id)) return { text: `已经写过 ${id}` }
  let paper = null
  if (id) {
    const entries = await fetchArxivEntries({ categories, arxiv: id, fetchImpl, baseUrl })
    paper = entries.find((entry) => entry.arxiv === id) ?? null
    if (!paper) return { text: `arXiv 上没有找到 ${id}` }
  } else {
    const days = parseLookbackDays(lookbackDays)
    const submittedTo = new Date(now)
    const submittedFrom = new Date(submittedTo.getTime() - days * 24 * 60 * 60 * 1000)
    let covered = false
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const entries = await fetchArxivEntries({
        categories,
        fetchImpl,
        start: page * PAGE_SIZE,
        maxResults: PAGE_SIZE,
        submittedFrom,
        submittedTo,
        baseUrl,
      })
      paper = selectPaper(entries, seen)
      covered = entries.length < PAGE_SIZE
      if (paper || covered) break
    }
    if (!paper) {
      return {
        text: covered
          ? `最近 ${days} 天里没有还没写过的论文。可以把回溯天数调大，或给 fetch_paper 传入一个 arxiv 号。`
          : `最近 ${days} 天的论文太多，翻了 ${MAX_PAGES * PAGE_SIZE} 篇还没找到没写过的。可以把回溯天数调小，或传入一个 arxiv 号。`,
      }
    }
  }
  const rootUrl = normalizeBaseUrl(baseUrl)
  if (peek) {
    return {
      text: [
        '只取摘要，没有下载全文。这是用来判方向的，确认要写再用它的编号取全文。',
        '',
        `arxiv: ${paper.arxiv}`,
        `title: ${paper.title}`,
        `authors: ${paper.authors.join(', ')}`,
        `published: ${paper.published}`,
        `abs: ${rootUrl}/abs/${paper.arxiv}`,
        '',
        'summary:',
        paper.summary,
      ].join('\n'),
    }
  }
  let files = {}
  try {
    const downloaded = await fetchPaperFiles({ arxiv: paper.arxiv, fetchImpl, baseUrl })
    files = writePaperSource(root, paper.arxiv, downloaded)
  } catch {
    files = {}
  }
  return {
    text: formatPaper({ ...paper, abs: `${rootUrl}/abs/${paper.arxiv}` }, files),
  }
}

export function writePaperSource(repoRoot, arxiv, downloaded) {
  const root = realpathSync(repoRoot)
  const id = normalizeArxivId(arxiv)
  const dir = resolve(root, 'papers', '_source')
  if (!isInside(root, dir)) return {}
  mkdirSync(dir, { recursive: true })
  const realDir = realpathSync(dir)
  if (!isInside(root, realDir) && realDir !== root) return {}
  const saved = {}
  const htmlPath = resolve(dir, `${id}.html`)
  const pdfPath = resolve(dir, `${id}.pdf`)
  const txtPath = resolve(dir, `${id}.txt`)
  if (existsSync(txtPath)) unlinkSync(txtPath)
  if (downloaded.html) {
    writeFileSync(htmlPath, downloaded.html, 'utf8')
    saved.html = `papers/_source/${id}.html`
  }
  if (downloaded.pdf) {
    writeFileSync(pdfPath, downloaded.pdf)
    saved.pdf = `papers/_source/${id}.pdf`
  }
  return saved
}
