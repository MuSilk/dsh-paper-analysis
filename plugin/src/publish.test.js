import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { PAGE_SIZE, formatPaper, htmlToText, parseAtom, selectPaper } from './arxiv.js'
import { findArxivIds, loadConfig, pickPaper, saveArticle, writeSettings } from './publish.js'
import { handleSettingsRequest } from './settings-server.js'

const root = mkdtempSync(join(tmpdir(), 'dsh-paper-'))
const pluginRoot = mkdtempSync(join(tmpdir(), 'dsh-paper-plugin-'))

after(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(pluginRoot, { recursive: true, force: true })
})

const atom = `<?xml version="1.0"?>
<feed>
  <entry>
    <id>http://arxiv.org/abs/2606.19926v1</id>
    <title>MemGUI-Agent: A &amp; B</title>
    <summary>先记住价格。</summary>
    <published>2026-06-18T00:00:00Z</published>
    <author><name>Guangyi Liu</name></author>
    <link title="pdf" href="https://arxiv.org/pdf/2606.19926" rel="related"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <title>Attention Is All You Need</title>
    <summary>Transformer.</summary>
    <published>2017-06-12T00:00:00Z</published>
    <author><name>Ashish Vaswani</name></author>
  </entry>
</feed>`

test('配置保留分组、回溯天数和 arXiv 地址', () => {
  writeFileSync(join(pluginRoot, 'paper.config.json'), '{"repoRoot":"","categories":["cs.CL"]}\n')
  assert.deepEqual(loadConfig(pluginRoot), {
    repoRoot: '',
    categories: ['cs.CL'],
    lookbackDays: 1,
    baseUrl: 'https://export.arxiv.org',
  })
})

test('解析 arXiv Atom，并跳过已经写过的编号', () => {
  const entries = parseAtom(atom)
  assert.equal(entries[0].arxiv, '2606.19926')
  assert.equal(entries[0].title, 'MemGUI-Agent: A & B')
  assert.equal(entries[0].authors[0], 'Guangyi Liu')
  assert.equal(selectPaper(entries, new Set(['2606.19926'])).arxiv, '1706.03762')
  assert.equal(selectPaper(entries, new Set(['2606.19926', '1706.03762'])), null)
  assert.match(formatPaper(entries[1]), /不要使用网页获取/)
  assert.equal(htmlToText('<html><body><script>secret()</script><p>只留这句话</p></body></html>'), '只留这句话')
})

test('写入 frontmatter，并拒绝重复的 arXiv 号和路径', () => {
  const saved = saveArticle({
    repoRoot: root,
    title: '格式示例：一篇解读在站点里长什么样',
    slug: 'Attention_论文解读_格式示例',
    arxiv: '1706.03762',
    topic: '视觉语言动作模型',
    date: '2026-10-17',
    body: '正文只示范结构。',
  })
  assert.equal(saved.relativePath, 'papers/202610/20261017_Attention_论文解读_格式示例.md')
  const text = readFileSync(join(root, 'papers', '202610', '20261017_Attention_论文解读_格式示例.md'), 'utf8')
  assert.match(text, /^---\n/)
  assert.match(text, /arxiv: 1706.03762/)
  assert.match(text, /^# 格式示例：一篇解读在站点里长什么样$/m)

  const duplicateId = saveArticle({
    repoRoot: root,
    title: '另一篇',
    slug: 'Attention_论文解读_另一版',
    arxiv: '1706.03762v7',
    topic: '其他',
    date: '2026-10-18',
    body: '不该写进去。',
  })
  assert.match(duplicateId.error, /已经写过 1706.03762/)

  const duplicatePath = saveArticle({
    repoRoot: root,
    title: '格式示例：一篇解读在站点里长什么样',
    slug: 'Attention_论文解读_格式示例',
    arxiv: '2606.19926',
    topic: '其他',
    date: '2026-10-17',
    body: '路径撞了。',
  })
  assert.match(duplicatePath.error, /同名文件已存在/)
})

test('指定编号时，写过的论文不再拉取', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-paper-seen-'))
  saveArticle({
    repoRoot: dir,
    title: '已有',
    slug: 'seen',
    arxiv: '1706.03762',
    topic: '其他',
    date: '2026-10-17',
    body: '已经在库里。',
  })
  let called = false
  const picked = await pickPaper({
    repoRoot: dir,
    categories: ['cs.AI'],
    arxiv: '1706.03762',
    fetchImpl: async () => {
      called = true
      return { ok: true, text: async () => '' }
    },
  })
  assert.equal(picked.text, '已经写过 1706.03762')
  assert.equal(called, false)
  rmSync(dir, { recursive: true, force: true })
})

test('未写过的列表取投稿最早的一篇', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-paper-fresh-'))
  const picked = await pickPaper({
    repoRoot: dir,
    categories: ['cs.AI'],
    fetchImpl: async () => ({ ok: true, text: async () => atom }),
  })
  assert.match(picked.text, /arxiv: 1706.03762/)
  assert.doesNotMatch(picked.text, /2606\.19926/)
  rmSync(dir, { recursive: true, force: true })
})

test('写过的较早论文会翻到下一页', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-paper-page-'))
  saveArticle({
    repoRoot: dir,
    title: '已有',
    slug: 'seen',
    arxiv: '1706.03762',
    topic: '其他',
    date: '2026-10-17',
    body: '已经在库里。',
  })
  const filler = `<feed>${Array.from({ length: PAGE_SIZE }, () => `
    <entry>
      <id>http://arxiv.org/abs/1706.03762v1</id>
      <title>Old</title>
      <summary>Seen.</summary>
      <published>2026-10-16T00:00:00Z</published>
      <author><name>A</name></author>
    </entry>`).join('')}</feed>`
  const fresh = `<feed><entry>
      <id>http://arxiv.org/abs/2606.19926v1</id>
      <title>New</title>
      <summary>Fresh.</summary>
      <published>2026-10-17T00:00:00Z</published>
      <author><name>B</name></author>
    </entry></feed>`
  const urls = []
  const picked = await pickPaper({
    repoRoot: dir,
    categories: ['cs.AI', 'cs.CL'],
    lookbackDays: 1,
    now: new Date('2026-10-18T00:00:00Z'),
    fetchImpl: async (url) => {
      const href = String(url)
      if (!href.includes('/api/query')) {
        return { ok: false, text: async () => '', arrayBuffer: async () => Buffer.from('') }
      }
      urls.push(href)
      const start = new URL(href).searchParams.get('start')
      return { ok: true, text: async () => (start === '0' ? filler : fresh) }
    },
  })
  assert.match(picked.text, /arxiv: 2606.19926/)
  assert.equal(urls.length, 2)
  const query = new URL(urls[0]).searchParams
  assert.equal(query.get('sortBy'), 'submittedDate')
  assert.equal(query.get('sortOrder'), 'ascending')
  assert.match(query.get('search_query'), /submittedDate:\[202610170000 TO 202610180000\]/)
  assert.match(query.get('search_query'), /cat:cs\.AI OR cat:cs\.CL/)
  assert.equal(new URL(urls[1]).searchParams.get('start'), String(PAGE_SIZE))
  rmSync(dir, { recursive: true, force: true })
})

test('全文写到 papers/_source，返回里只有路径', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-paper-source-'))
  const html = '<html><body><p>实验部分的完整数字 42.0</p></body></html>'
  const picked = await pickPaper({
    repoRoot: dir,
    categories: ['cs.AI'],
    arxiv: '2606.19926',
    fetchImpl: async (url) => {
      const href = String(url)
      if (href.includes('/pdf/')) {
        return { ok: true, arrayBuffer: async () => Buffer.from('%PDF-1.7 fake') }
      }
      return { ok: true, text: async () => (href.includes('/html/') ? html : atom) }
    },
  })
  assert.match(picked.text, /html: papers\/_source\/2606\.19926\.html/)
  assert.match(picked.text, /pdf: papers\/_source\/2606\.19926\.pdf/)
  assert.doesNotMatch(picked.text, /42\.0/)
  assert.match(readFileSync(join(dir, 'papers', '_source', '2606.19926.html'), 'utf8'), /实验部分的完整数字 42\.0/)
  assert.equal(readFileSync(join(dir, 'papers', '_source', '2606.19926.pdf')).subarray(0, 5).toString(), '%PDF-')
  rmSync(dir, { recursive: true, force: true })
})

test('跳过的论文记在 _skip 里也算已经写过', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-paper-skip-'))
  mkdirSync(join(dir, 'papers', '_skip'), { recursive: true })
  writeFileSync(join(dir, 'papers', '_skip', 'skipped.md'), '- 2606.11111 Some CV Paper — 纯分割基准\n')
  assert.equal(findArxivIds(dir).has('2606.11111'), true)
  const skipped = saveArticle({
    repoRoot: dir,
    title: '不该写的一篇',
    slug: '不该写的一篇',
    arxiv: '2606.11111',
    topic: '其他',
    date: '2026-10-18',
    body: '跳过。',
  })
  assert.match(skipped.error, /已经写过 2606\.11111/)
  rmSync(dir, { recursive: true, force: true })
})

test('设置可以改分组、回溯天数、地址和主题', () => {
  const repo = mkdtempSync(join(tmpdir(), 'dsh-paper-repo-'))
  const plugin = mkdtempSync(join(tmpdir(), 'dsh-paper-cfg-'))
  writeFileSync(join(plugin, 'paper.config.json'), JSON.stringify({ repoRoot: repo, categories: ['cs.AI'] }))
  writeFileSync(join(repo, 'topics.json'), '["其他"]\n')
  const saved = writeSettings(plugin, {
    categories: ['cs.CL', 'cs.LG'],
    lookbackDays: 2,
    baseUrl: 'https://export.arxiv.org/',
    topics: ['记忆系统', '其他'],
  })
  assert.deepEqual(saved.categories, ['cs.CL', 'cs.LG'])
  assert.equal(saved.lookbackDays, 2)
  assert.equal(saved.baseUrl, 'https://export.arxiv.org')
  assert.deepEqual(saved.topics, ['记忆系统', '其他'])
  const read = handleSettingsRequest(plugin, 'GET', '/dsh-paper/settings', '')
  assert.equal(read.status, 200)
  assert.deepEqual(read.body.topics, ['记忆系统', '其他'])
  const missing = handleSettingsRequest(plugin, 'GET', '/dsh-paper/other', '')
  assert.equal(missing.status, 404)
  rmSync(repo, { recursive: true, force: true })
  rmSync(plugin, { recursive: true, force: true })
})
