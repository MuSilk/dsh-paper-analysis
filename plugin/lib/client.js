;(() => {
window.__ModuleLoader__.load({
  id: 'dsh-paper',
  factory: (require) => {
    const react = require('react')
    const { useEffect, useState } = react
    const h = react.createElement

    const CSS = [
      '.dsh-paper-cfg{display:flex;flex-direction:column;gap:12px;max-width:720px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}',
      '.dsh-paper-cfg__title{margin:0;font-size:16px;font-weight:500;line-height:24px}',
      '.dsh-paper-cfg__card{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px}',
      '.dsh-paper-cfg__label{font-size:13px;font-weight:500}',
      '.dsh-paper-cfg__hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.dsh-paper-cfg__input{box-sizing:border-box;width:100%;min-height:28px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;outline:none;resize:vertical}',
      '.dsh-paper-cfg__input:focus{border-color:var(--dsw-alias-state-business-primary)}',
      '.dsh-paper-cfg textarea{min-height:96px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}',
      '.dsh-paper-cfg__actions{display:flex;align-items:center;gap:8px}',
      '.dsh-paper-cfg__btn{border:1px solid var(--dsw-alias-button-info-fill,var(--dsw-alias-state-business-primary));background:var(--dsw-alias-button-info-fill,var(--dsw-alias-state-business-primary));color:#fff;border-radius:8px;padding:4px 14px;font:inherit;font-size:12px;line-height:20px;cursor:pointer}',
      '.dsh-paper-cfg__btn:disabled{opacity:.5;cursor:default}',
      '.dsh-paper-cfg__msg{font-size:12px;color:var(--dsw-alias-state-success-primary)}',
      '.dsh-paper-cfg__msg.is-err{color:var(--dsw-alias-state-error-primary)}',
    ].join('\n')

    function injectCss() {
      if (document.querySelector('style[data-plugin-css="dsh-paper/settings.css"]')) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-paper'
      tag.dataset.pluginCss = 'dsh-paper/settings.css'
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    function lines(value) {
      return String(value).split(/\n/).map((item) => item.trim()).filter(Boolean)
    }

    function PaperSettings() {
      const [categories, setCategories] = useState('')
      const [lookbackDays, setLookbackDays] = useState('1')
      const [baseUrl, setBaseUrl] = useState('')
      const [topics, setTopics] = useState('')
      const [status, setStatus] = useState('')
      const [failed, setFailed] = useState(false)
      const [saving, setSaving] = useState(false)

      useEffect(() => {
        injectCss()
        let cancelled = false
        fetch('/dsh-paper/settings')
          .then(async (response) => {
            const data = await response.json()
            if (!response.ok || data.error) throw new Error(data.error || '读取设置失败')
            return data
          })
          .then((data) => {
            if (cancelled) return
            setCategories(data.categories.join('\n'))
            setLookbackDays(String(data.lookbackDays))
            setBaseUrl(data.baseUrl)
            setTopics(data.topics.join('\n'))
          })
          .catch((error) => {
            if (cancelled) return
            setFailed(true)
            setStatus(error instanceof Error ? error.message : String(error))
          })
        return () => {
          cancelled = true
        }
      }, [])

      async function save(event) {
        event.preventDefault()
        setSaving(true)
        setFailed(false)
        setStatus('正在保存')
        try {
          const response = await fetch('/dsh-paper/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              categories: lines(categories),
              lookbackDays: Number(lookbackDays),
              baseUrl,
              topics: lines(topics),
            }),
          })
          const data = await response.json()
          if (!response.ok || data.error) throw new Error(data.error || '保存失败')
          setCategories(data.categories.join('\n'))
          setLookbackDays(String(data.lookbackDays))
          setBaseUrl(data.baseUrl)
          setTopics(data.topics.join('\n'))
          setStatus('已保存。')
        } catch (error) {
          setFailed(true)
          setStatus(error instanceof Error ? error.message : String(error))
        } finally {
          setSaving(false)
        }
      }

      return h('form', { className: 'dsh-paper-cfg', onSubmit: save },
        h('h2', { className: 'dsh-paper-cfg__title' }, '论文设置'),
        field('arXiv 分组', '一行一个，例如 cs.AI。不指定编号时，fetch_paper 从这些分组里取。',
          h('textarea', { className: 'dsh-paper-cfg__input', value: categories, onChange: (event) => setCategories(event.target.value) })),
        field('回溯天数', '在最近这么多天的投稿里，挑最早一篇还没写过的。范围 1 到 14。',
          h('input', { className: 'dsh-paper-cfg__input', type: 'number', min: 1, max: 14, required: true, value: lookbackDays, onChange: (event) => setLookbackDays(event.target.value) })),
        field('arXiv 地址', '接口、HTML 和 PDF 都从这个网站根地址下载。',
          h('input', { className: 'dsh-paper-cfg__input', type: 'url', required: true, value: baseUrl, onChange: (event) => setBaseUrl(event.target.value) })),
        field('主题列表', '一行一个，顺序就是站点导航顺序。paper_save 的 topic 必须是其中一项。',
          h('textarea', { className: 'dsh-paper-cfg__input', value: topics, onChange: (event) => setTopics(event.target.value) })),
        h('div', { className: 'dsh-paper-cfg__actions' },
          h('button', { className: 'dsh-paper-cfg__btn', type: 'submit', disabled: saving }, '保存'),
          status ? h('span', { className: failed ? 'dsh-paper-cfg__msg is-err' : 'dsh-paper-cfg__msg' }, status) : null,
        ),
      )
    }

    function field(label, hint, control) {
      return h('label', { className: 'dsh-paper-cfg__card' },
        h('span', { className: 'dsh-paper-cfg__label' }, label),
        h('p', { className: 'dsh-paper-cfg__hint' }, hint),
        control,
      )
    }

    const name = 'dsh-paper'
    const inject = ['slots']
    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'paper-settings',
        order: 40,
        label: '论文设置',
      }, PaperSettings))
    }

    return { apply, inject, name }
  },
})
})()
