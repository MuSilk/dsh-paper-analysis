# 跳过的论文

选题门槛没过、不写解读的论文记在这里，一行一篇。`fetch_paper` 会把这个文件里的编号当成已经写过，下次跳过它们。

格式：

```
- <arxiv 编号> <英文标题> — <一句理由>
```

例：`- XXXX.XXXXX Some Paper Title — 纯 NLP，没有具身任务`
- 2610.17444 The belief-action gap in language model agents — 纯文本网格世界里的 LM agent 行为与可解释性研究，没有机器人本体、物理闭环或具身任务
- 2610.17448 TableVision: Recovering Verified Structure from Historical Tables — 历史表格 OCR 与版面结构恢复，属文档处理，与具身任务无关
- 2610.17449 Formal-Verification-Guided Bayesian Optimization for Non-Intrusive Last-Mile Coverage Closure — 芯片功能覆盖率验证流程，属 EDA，与具身智能无关
- 2610.17451 On Sleep-Wake Disorder Identification from Polysomnographic Representations — 睡眠多导睡眠图基础模型评测，属医学信号，与具身智能无关
- 2610.17453 Effect of Spherical Parameter Space on Number of Non-Forgetting Tasks and Capacity of Continual Learning — 持续学习的球面参数空间理论分析，无具身场景
- 2610.17456 Compositional RL: Evaluating and Training LLMs for Collaborative Reasoning — 多模型协作与 Shapley 值，纯 LLM 推理任务，无具身场景
- 2610.17457 BrowseSafe++: Benchmarking Prompt Injection Detection Across Web Contexts, Languages, and Browser Views — 浏览器 agent 的提示注入基准，不涉及机器人或物理环境
