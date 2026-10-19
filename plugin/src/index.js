import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { loadConfig, pickPaper, resolveRepoRoot, saveArticle } from './publish.js'
import { registerSettingsRoute } from './settings-server.js'

export const name = 'dsh-paper'
export const inject = ['tools']

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url))

function rootAndConfig() {
  const config = loadConfig(PLUGIN_ROOT)
  return { config, root: resolveRepoRoot(PLUGIN_ROOT, config) }
}

export function apply(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => registerSettingsRoute(webCtx, PLUGIN_ROOT), 'dsh-paper: settings')
  })

  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'fetch_paper',
          description:
            '从 arXiv 选一篇仓库里还没写过的论文。默认把 HTML 和 PDF 下载到 papers/_source 并返回这两个路径；传 peek 只返回摘要，用来先判方向。先用 skill 工具加载 paper-analysis，再自己读取 html。不要再用网页获取去打开 arXiv。不操作 git。',
          parameters: {
            arxiv: { type: 'string', description: '指定要写的 arXiv 编号，例如 2606.19926。省略则从最近若干天的投稿里取最早一篇还没写过的。' },
            peek: { type: 'boolean', description: '只取摘要、不下载全文，用来快速判断方向。确认要写再用它的 arxiv 编号取一次全文。' },
          },
          output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: String(value) }],
          },
          async execute(args) {
            try {
              const { config, root } = rootAndConfig()
              const picked = await pickPaper({
                repoRoot: root,
                categories: config.categories,
                lookbackDays: config.lookbackDays,
                baseUrl: config.baseUrl,
                arxiv: args.arxiv,
                peek: args.peek === true,
              })
              return picked.text
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              return message.startsWith('arXiv ') ? `失败：${message}` : `拒绝：${message}`
            }
          },
        }),
      ),
    'dsh-paper: fetch_paper',
  )

  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'paper_save',
          description:
            '把一篇论文解读写入 papers/YYYYMM/YYYYMMDD_短名.md。月份和文件名前缀用 arXiv 第一版挂载日期，不用今天下载或写作的日期。同 arXiv 号或同路径已存在则拒绝。不操作 git。',
          parameters: {
            title: { type: 'string', required: true, description: '文章一级标题，不含 # 号' },
            body: { type: 'string', required: true, description: '标题以下的 Markdown，不要自带 frontmatter' },
            slug: { type: 'string', required: true, description: '文件名短名，例如 Attention_论文解读_格式示例' },
            arxiv: { type: 'string', required: true, description: 'arXiv 编号，例如 1706.03762' },
            topic: { type: 'string', required: true, description: '主题，必须是设置页主题列表里的一项' },
            date: { type: 'string', required: true, description: 'arXiv 第一版挂载日期 YYYY-MM-DD，用 fetch_paper 返回的 published。不要填今天下载或写作的日期。' },
          },
          output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: String(value) }],
          },
          async execute(args) {
            try {
              const { root } = rootAndConfig()
              const saved = saveArticle({
                repoRoot: root,
                title: args.title,
                body: args.body,
                slug: args.slug,
                arxiv: args.arxiv,
                topic: args.topic,
                date: args.date,
              })
              if (saved.error) return `拒绝：${saved.error}`
              return `已写入 ${saved.relativePath}\n请用你自己的 git 工具提交并推送。提交说明：docs: 新增论文解读 ${saved.title}`
            } catch (error) {
              return `拒绝：${error instanceof Error ? error.message : String(error)}`
            }
          },
        }),
      ),
    'dsh-paper: paper_save',
  )
}
