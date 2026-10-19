# AI Paper Analysis

具身智能方向的论文解读站，外加一个 DeepSeek Harness 插件。插件从 arXiv 的机器人、视觉、学习、AI、人机交互分组里选题，skill 再按摘要筛一遍方向，只写落在具身智能上的论文。推到 `main` 之后，GitHub Actions 用 MkDocs 发布站点。

需要 Node.js 22.12 或更高版本、已安装的 `dsh`、Git，以及用来预览站点的 Python 3.9+。

## 怎么跑

### 1. 装上插件依赖

插件要引用 DSH 提供的 `@deepseek-ai/dsh-tools`。没装过的话，在 `plugin` 目录执行一次：

```powershell
cd plugin
npm install
cd ..
```

`plugin/cordis.local.yml` 里的 `name` 必须是本机 `plugin/src/index.js` 的绝对路径。换机器或换目录后，先改这一行再启动。

### 2. 从仓库根目录启动 DSH

```powershell
dsh web --patch plugin/cordis.local.yml
```

桌面版把 `web` 换成 `desktop`。

会话的工作目录就是启动 `dsh` 时的目录，所以要从本仓库根目录启动。这样模型才能加载 `.dsh/skills/paper-analysis`，`paper_save` 也会写进这个仓库的 `papers/`。

### 3. 手动写一篇

在这个会话里直接说「写今天的论文解读」。模型会：

1. 调用 `fetch_paper`。回溯天数里的论文都写过就停，并说明停了。
2. 用 `fetch_paper` 的 `peek` 模式取摘要（不下载全文），按 skill 里的选题门槛判断方向。不是具身的记进 `papers/_skip/skipped.md`，再 peek 下一篇，跳到合方向的为止；窗口翻完才停。过了门槛的再用它的编号取一次全文。
3. 用 skill 工具加载 `paper-analysis`，再读取 `fetch_paper` 返回的 HTML。不要再用网页获取去打开 arXiv。按技能里的结构写成一篇。
4. 调用 `paper_save`，写入 `papers/YYYYMM/YYYYMMDD_短名.md`。`YYYYMMDD` 用 `fetch_paper` 返回的 `published`，也就是 arXiv 第一版挂载日期。
5. 用它自己的 git 工具提交并推送当前分支。提交说明：`docs: 新增论文解读 <标题>`。
6. 回复相对路径和 arXiv 号。

要指定论文时，说「写 1706.03762」。模型会把这个编号传给 `fetch_paper`。

每天一篇。同一 arXiv 号或同一路径已存在时，`paper_save` 会拒绝覆盖。

### 4. 每天 06:00 自动跑

先在网页侧栏的插件管理里，启用「官方」分组中带闹钟图标的「自动化任务」。然后新建一个专用会话，不要和日常聊天混用。任务绑在创建它的会话上，到点后提醒发回这个会话。

把下面这段发给模型：

```text
用 schedule_create 建一条每天 06:00 的任务。标题：每日论文解读。时间只用 daily，时区 Asia/Shanghai，不要用 every_seconds。prompt 用下面这段：

1. 调用 fetch_paper。没有新论文就停，并说明停了。
2. 用 skill 工具加载 paper-analysis，再读取 fetch_paper 返回的 HTML。不要再用网页获取去打开 arXiv。按技能里的结构写成一篇。
3. 调用 paper_save。
4. 用你自己的 git 工具提交并推送到当前分支。提交说明：docs: 新增论文解读 <标题>。
5. 回复相对路径和 arXiv 号。
```

会话里会出现任务卡片。侧栏「自动化任务」里也能改名称、指令和运行时间。

到点时这台电脑上的 `dsh web` 必须开着。关机错过的日子只补最近一次。这个会话在任务还开着时不能归档。

### 5. 本地看站点

用虚拟环境，避免改到系统里的 Python：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r scripts/requirements.txt
python scripts/build_mkdocs.py
mkdocs serve
```

浏览器打开命令打印出来的地址。构建脚本按 frontmatter 生成首页、左侧「按主题」和按月导航，并写出 `mkdocs.yml`。主题是 Read the Docs。`docs/`、`site/` 和 `mkdocs.yml` 都是生成结果。

### 6. 发布

GitHub 仓库的 Pages 源选 `gh-pages` 分支。把解读推到 `main` 且 `papers/` 有变动时，`.github/workflows/deploy-docs.yml` 会构建并发布。只改 skill 或 README 不会触发这次发布。

## 插件

| 工具 | 作用 |
|---|---|
| `fetch_paper` | 从配置的 arXiv 分组里，取回溯天数内最早一篇还没写过的论文，把 HTML 和 PDF 下载到 `papers/_source/`。传入 `arxiv` 则改取这一篇 |
| `paper_save` | 写入 `papers/YYYYMM/YYYYMMDD_短名.md`。月份按 arXiv 第一版挂载日期分，带上 frontmatter。同号或同路径已存在就拒绝 |

在 DSH 里打开设置，左侧有「论文设置」。保存后下一次 `fetch_paper` 就会用上：

- arXiv 分组。默认是 `cs.RO`、`cs.CV`、`cs.LG`、`cs.AI`、`cs.HC`，用 `cat:X OR cat:Y` 拼起来查，所以分组越宽噪声越多，靠 skill 的选题门槛兜住
- 回溯天数。在这段时间的投稿里取最早一篇还没写过的
- arXiv 网站根地址
- 主题列表。顺序同时用于站点导航，`paper_save` 的 `topic` 必须是其中一项

arXiv 的检索接口会限流。插件在两次请求之间至少隔 3 秒；遇到 429、5xx 或超时会按 5 秒、10 秒退避重试，最多 3 次，有 `Retry-After` 时优先按它等。仍然失败时 `fetch_paper` 返回「失败：arXiv 接口限流…」，这时等几分钟再试，或者直接传一个 arXiv 编号绕过列表查询。

`plugin/paper.config.json`：

```json
{
  "repoRoot": "",
  "categories": ["cs.RO", "cs.CV", "cs.LG", "cs.AI", "cs.HC"],
  "lookbackDays": 7,
  "baseUrl": "https://export.arxiv.org"
}
```

`repoRoot` 为空时，写入目录是本仓库根目录下的 `papers/`。主题枚举在根目录的 `topics.json`。短名只允许字母、数字、中文、下划线和连字符。正文不要自带 frontmatter。

### 跳过的论文

`fetch_paper` 只会跳过已经写过的论文，判方向要靠 skill。方向不对的论文记一行到 `papers/_skip/skipped.md`：

```
- 2601.01234 Some CV Paper — 纯分割基准，没有机器人任务
```

插件读这个文件里的编号，下次选题就跳过它们。这个目录不参与站点构建。

## 文章

```yaml
---
title: 格式示例：一篇解读在站点里长什么样
arxiv: 1706.03762
topic: 视觉语言动作模型
date: 2017-06-12
---
```

`date` 是这篇论文在 arXiv 上的第一版挂载日期，站点按它分到 `papers/201706/`。`topic` 必须是 `topics.json` 里的一项。结构和句式在 `.dsh/skills/paper-analysis/SKILL.md`，DSH 会把它登记成名为 `paper-analysis` 的技能。

## 测试

```powershell
node --test plugin/src/publish.test.js
```
