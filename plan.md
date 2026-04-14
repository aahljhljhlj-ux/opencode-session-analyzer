# Session Analyzer 计划文档

## 背景

`research.md` 已经确认，OpenCode 插件可以通过文档化的 SDK API 访问 session 历史，并且可以作为本地插件实现。对于这个项目，当前最重要的问题已经不是“能不能做 session 分析”，而是“第一版应该如何定义，才能足够安全、清晰、可用”。

本计划文档采用一个保守的产品方向：

- 分析必须由用户显式触发
- 插件默认不在后台持续分析 session
- 第一版默认使用 LLM 完成分析与建议生成；当 LLM 不可用或结构化输出无效时，分析应显式失败，不提供确定性降级输出
- 产出以报告和摘要为主，不自动改写 prompt，也不自动修改项目文件

## 产品目标

构建一个 OpenCode 插件，让用户可以显式触发对指定范围内的历史 session 进行分析，提取工作流模式和 prompt 使用习惯，并生成项目级和全局级的摘要与可执行建议。

插件应帮助回答以下问题：

- 这个项目中最常见的任务类型是什么？
- 哪些场景中反复出现纠正和返工？
- 哪些文件、目录和命令最常出现？
- 用户有哪些 prompt 习惯或工作流习惯值得优化？
- 哪些结论只是历史现象，哪些仍然代表当前活跃方向？

## 产品形态

MVP 应是一个命令驱动的分析插件，而不是一个持续被动观察的后台插件。

核心交互模型如下：

1. 用户执行一个自定义命令。
2. 命令接受参数，用来指定分析范围。
3. 插件通过 SDK 获取匹配范围内的 session 历史。
4. 插件判断哪些 session 需要重新分析。
5. 插件执行分析并更新摘要结果。
6. 插件输出结构化结果和可读报告。

选择这个模型的原因是：行为明确、成本可控、容易理解，也更方便后续逐步扩展。

## 非目标

MVP 明确不做以下事情：

- 默认在每个 session 事件上自动后台分析
- 在被动钩子中隐式调用 LLM
- 自动改写用户 prompt
- 自动修改 `AGENTS.md`、规则文件或其他项目文件
- 依赖 OpenCode 未文档化的内部存储格式
- 做重度实时 UI 交互
- 使用高度黑盒、难以解释的分类逻辑

## 用户触发与分析范围

插件应提供一个统一的分析命令，通过参数表达不同分析范围，而不是做很多分散命令。

典型使用场景包括：

- 分析最近若干个 session
- 分析当前项目相关的 session
- 分析指定项目路径下的 session
- 分析某一个具体 session
- 强制重新分析已分析过的 session
- 只分析已经过期的 session

建议 MVP 支持以下范围参数：

- `--recent <n>`：分析最近 `n` 个 session
- `--project current`：分析当前项目相关的 session
- `--project <path>`：分析指定项目路径相关的 session
- `--session <id-or-path>`：分析某个指定 session
- `--force`：忽略缓存状态，强制重跑分析
- `--only-stale`：只分析结果已过期的 session

建议默认行为为：

- 当用户没有提供范围参数时，默认分析当前项目中下一批待处理的 5 个 eligible session

补充约束：

- 分析结果不应依赖“先分析哪一批 session、后分析哪一批 session”的顺序
- 每条分析结论都必须带明确的时间标注，后续聚合出现冲突时，应优先依据时间判断结论是否仍然有效

## 端到端工作流

一次由用户触发的分析请求，整体流程应为：

1. 解析命令参数。
2. 解析分析范围。
3. 通过 SDK 列出候选 session。
4. 读取插件自己的分析索引。
5. 比较当前 session 状态与历史分析状态。
6. 选出需要分析的 session：包括新 session、过期 session、上次失败的 session，或用户强制指定重跑的 session。
7. 获取这些 session 的消息内容。
8. 执行本地预处理，生成带时间信息的结构化分析输入。
9. 将结构化输入发送给 LLM，生成 session 级结论与建议；若 LLM 不可用或返回无效结构化结果，则该 session 记为失败并跳过产物写入。
10. 更新 session 级产物。
11. 更新项目级和全局级摘要。
12. 生成可读建议并向用户返回简洁的执行结果。

## 架构

插件建议围绕少量职责清晰的模块来组织。

### 1. 命令入口

职责：

- 注册自定义命令
- 解析参数
- 分发分析请求

### 2. Session 发现模块

职责：

- 调用 SDK 的 session 列表 API
- 归一化 session 与 project 的关联关系
- 按请求范围筛选 session

### 3. 分析索引模块

职责：

- 记录哪些 session 已经分析过
- 记录上次成功分析时看到的 session 状态
- 记录当时使用的分析器版本
- 判断某个 session 当前是最新、过期还是失败状态

### 4. Session 分析模块

职责：

- 获取并检查 session 消息
- 计算确定性的指标和信号
- 构造发送给 LLM 的结构化输入
- 区分累计历史结论与当前活跃结论
- 输出 session 级摘要结果

### 5. 聚合模块

职责：

- 基于 session 级结果重算项目级摘要
- 在需要时重算全局级摘要
- 基于带时间标注的结论处理冲突和覆盖关系

### 6. 报告模块

职责：

- 写出机器可读的 JSON 文件
- 写出人类可读的 Markdown 建议
- 向用户输出一段简洁的成功/失败摘要

## 建议落地到规则的交互

分析完成后的产品目标不应停留在“生成一段总结”，而应在合适时机帮助用户把高价值建议沉淀为后续可复用的规则。

但这一步必须是显式确认的用户动作，不能由插件自动修改 `AGENTS.md` 或其他规则文件。

### 目标

- 在分析结果足够明确时，给用户一个自然的下一步入口
- 把可复用的优化建议沉淀到项目级或全局级规则中
- 保持用户控制权，避免自动修改带来的误伤

### 建议交互流程

推荐在一次成功分析完成后，按以下顺序与用户交互：

1. 先展示本次分析结果摘要。
2. 再展示 1 到 3 条最值得落地的建议。
3. 询问用户是否将这些建议写入规则。
4. 由用户选择写入当前项目的 `AGENTS.md`、全局 `AGENTS.md`，或暂不处理。

推荐的最小提示文案可以是：

```text
本次分析提炼出了可复用的工作建议，是否要落地为规则？

可选：
- 写入当前项目的 AGENTS.md
- 写入全局 AGENTS.md
- 暂不处理
```

### 触发条件

不应在每次分析后都提示用户落地规则。建议仅在以下条件同时满足时触发提示：

- 本次分析成功完成
- 没有 `failedSessions`
- 至少存在一条清晰、可执行、非一次性的建议
- 该建议对未来会话具有复用价值，而不是只适用于本次排查

以下情况不应触发提示：

- 本次结果证据较弱，只有模糊观察，没有明确建议
- 本次只是数据刷新，没有新的工作方式结论
- 建议明显属于一次性操作或临时排查步骤
- 本次分析存在失败，或用户当前更需要先处理错误

### 建议筛选原则

用于落地到规则的建议，必须优先满足以下要求：

- 可以转化为明确行为约束或检查顺序
- 能在未来多个会话中复用
- 有足够证据支撑，不依赖单条弱证据
- 写入规则后，确实有助于提升后续建议质量或协作效率

不应因为某条总结“看起来像建议”，就默认进入规则候选。

### 项目级与全局级的区分

建议默认按以下原则帮助用户理解范围选择：

- 项目级 `AGENTS.md`：适合当前仓库特有的工作约束、输出格式、验证顺序、分析边界
- 全局 `AGENTS.md`：适合跨项目通用的工作方法、证据标准、协作习惯和建议生成原则

例如：

- “先检查 `run-progress.json` 再检查 `run-events.jsonl`”更适合项目级规则
- “分类必须服务建议生成”更适合全局规则

如果一条建议同时包含项目特定细节和通用方法论，不应自动决定范围，而应保留给用户选择。

### 与产品边界的一致性

该交互必须遵守以下边界：

- 分析必须由用户显式触发
- 规则修改必须由用户显式确认
- 插件可以提出“是否落地”的建议，但不能自动改写规则文件

这一设计使 analyzer 的价值闭环更完整：

- 先分析历史工作方式
- 再产出可执行建议
- 最后由用户决定是否把高价值建议沉淀为规则

## LLM 分析流程

本插件的主产品路径默认依赖 LLM。命令触发后，LLM 应承担“语义归纳、建议生成、阶段解释、冲突结论解释”等工作。

本地逻辑不负责替代 LLM 的语义分析，而是负责控制输入质量、时间边界、范围裁剪和结果可验证性。

### 默认模式

- 默认启用 LLM 分析
- 本版本不提供关闭 LLM 的降级模式
- 当 LLM 不可用或输出无效时，分析应显式失败（而不是输出低置信度的降级结果）

### 命令触发后的 LLM 工作流

1. 插件按范围获取 session。
2. 插件对每个 session 做本地预处理。
3. 插件提取时间边界、基础指标、显著信号和有限证据片段。
4. 插件把这些信息整理为结构化输入发送给 LLM。
5. LLM 输出 session 级分析结论。
6. 插件再基于多个 session 的结果生成项目级和全局级摘要。

推荐采用两阶段调用方式：

1. 先逐个 session 调用 LLM，生成 session 级结构化结论。
2. 再基于多个 session 的结论，调用一次聚合分析，生成项目级或全局级摘要。

不建议一开始就把大量原始 session 一次性整体发给 LLM，因为这样会带来：

- token 不可控
- 旧内容噪声过多
- 时间边界更难表达
- 冲突结论更难回溯到来源

### 本地预处理的作用

本地预处理的职责不是代替 LLM 做最终判断，而是为了：

- 限制 token 开销
- 给 LLM 提供更干净、更少噪声的输入
- 明确每条结论的时间边界
- 避免旧 session 内容无约束污染当前结论
- 为 LLM 输出后的冲突合并提供可验证依据

### 消息归一化与证据引用

从 `opencode export <sessionID>` 的实际结构看，message 和 part 的类型较多（例如 `text`、`file`、`tool`、`reasoning`、`step-start` 等）。为避免噪声污染 LLM 结论，并保证 `evidenceRefs` 可回溯，MVP 必须定义明确的归一化规则。

#### messageIndex 生成规则

- SDK 返回的 `messages` 列表是有序数组；MVP 直接以该数组顺序生成 `messageIndex`（从 0 或 1 开始均可，但需全局一致）。
- `messageId` 以 `message.info.id` 为准。
- `timestamp` 以 `message.info.time.created` 为准（必要时可同时保留 assistant 的 `completed`）。

#### 可分析内容提取规则

- 默认仅将 user/assistant 的 `text` part 作为主要语义输入。
- `file` part 默认只保留元数据（例如 `filename`、`source.path`、`url`），不把文件全文作为证据片段直接发送给 LLM。
- `tool` part 默认不直接全量发送；只提取结构化信号（例如工具名、状态、错误、关键输出摘要），避免把大段工具回显注入。
- `reasoning`、`step-start`、`step-finish` 默认不进入 LLM 输入。
- 标记为 `synthetic` 的 text 默认降权；只在其承载“工具调用摘要”且无法替代时才保留。

#### evidenceRefs 规则

- `evidenceRefs` 必须引用 `messageId`，而不是 messageIndex 或自由文本。
- 如需更细粒度回溯，可在内部额外记录 `partId`，但对外的主引用仍以 `messageId` 为准。
- 每条 finding/recommendation 的 `evidenceRefs` 应尽量落在 `deltaRange` 或 `activeRange` 中，避免引用明显已失效的早期片段。

### 发给 LLM 的信息建议分层

#### 1. Session 元数据

- `sessionId`
- `projectPath`
- `createdAt`
- `updatedAt`
- `analyzedAt`
- `analyzerVersion`

#### 2. 时间范围信息

- `fullRange`
- `deltaRange`
- `activeRange`

#### 3. 本地提取的结构化指标

- `totalPromptCount`
- `newPromptCount`
- `avgPromptLength`
- `toolFailureCount`
- `topFiles`
- `topDirectories`
- `topCommands`
- `correctionSignals`
- `directionChangeSignals`

#### 4. 受控证据片段

应只发送有限数量的证据片段，而不是完整 transcript。

每个片段建议带：

- `messageId`
- `messageIndex`
- `role`
- `timestamp`
- `rangeType`，例如 `delta` 或 `active`
- `text`

证据片段建议遵循以下裁剪原则：

- 优先保留 `activeRange` 和 `deltaRange` 中的消息
- 明显早于当前活跃阶段、且已经失效的错误上下文应降权或不发送
- 每个 session 只发送有限数量的片段，避免 transcript 全量透传
- 当片段涉及敏感信息时，应优先做本地脱敏

### Session 级 LLM 输入结构

建议把发送给 LLM 的 session 级输入定义为显式 schema，而不是自由拼接文本。

建议字段：

- `sessionMeta`
- `timeRanges`
- `deterministicMetrics`
- `signals`
- `evidenceSnippets`
- `analysisGoal`

其中：

- `sessionMeta` 用于标识 session 来源和分析上下文
- `timeRanges` 用于明确 full、delta、active 三类时间边界

建议 `timeRanges` 同时包含：

- message 维度边界（例如 `startMessageIndex` / `endMessageIndex`，并尽量能映射到对应 `messageId`）
- 时间戳维度边界（例如 `startAt` / `endAt`）
- `deterministicMetrics` 用于提供本地统计结果
- `signals` 用于提供已识别的纠正、切换、返工等模式
- `evidenceSnippets` 用于给 LLM 提供有限但足够的语义证据
- `analysisGoal` 用于明确这次调用的任务，例如“生成当前有效建议”或“解释当前方向变化”

建议把发送内容组织成如下逻辑结构：

```json
{
  "sessionMeta": {
    "sessionId": "...",
    "projectPath": "...",
    "updatedAt": "...",
    "analyzerVersion": "..."
  },
  "timeRanges": {
    "fullRange": {"start": "...", "end": "..."},
    "deltaRange": {"start": "...", "end": "..."},
    "activeRange": {"start": "...", "end": "..."}
  },
  "deterministicMetrics": {
    "totalPromptCount": 0,
    "newPromptCount": 0,
    "toolFailureCount": 0,
    "topFiles": []
  },
  "signals": {
    "correctionSignals": [],
    "directionChangeSignals": []
  },
  "evidenceSnippets": [],
  "analysisGoal": "生成当前有效建议并给出时间边界"
}
```

### LLM 输出要求

LLM 输出必须是结构化结果，而不是只输出自由文本。建议至少包括：

- `findings`
- `currentRecommendations`
- `workflowSuggestions`
- `validFrom`
- `validTo`
- `evidence`

这样后续聚合时，插件才能基于时间和证据判断冲突结论是否仍然有效。

建议进一步约束 LLM 输出 schema，使其至少满足：

- 每条结论都带 `observedAt`
- 每条结论都带 `validFrom`
- `validTo` 默认为 `null`
- 每条结论都带 `evidenceRefs`
- 每条建议都带 `scope`，例如 `session`、`project`、`global`

建议逻辑结构如下：

```json
{
  "findings": [
    {
      "id": "...",
      "scope": "session",
      "summary": "...",
      "observedAt": "...",
      "validFrom": "...",
      "validTo": null,
      "evidenceRefs": ["<messageId>", "<messageId>"]
    }
  ],
  "currentRecommendations": [
    {
      "summary": "...",
      "validFrom": "...",
      "validTo": null,
      "evidenceRefs": ["<messageId>"]
    }
  ],
  "workflowSuggestions": []
}
```

### 项目级与全局级聚合输入

项目级和全局级分析不应再次回看大量原始消息，而应优先基于 session 级结论做二次归纳。

推荐聚合输入包括：

- session 级 `findings`
- session 级 `currentRecommendations`
- session 级时间边界信息
- session 级核心指标摘要

也就是说，聚合阶段更接近“分析分析结果”，而不是“重新分析原始对话”。

### 冲突结论合并规则

当多个 session 级或聚合级结论出现冲突时，插件应按以下顺序处理：

1. 先比较 `validTo`，已失效结论不能覆盖仍然有效的结论。
2. 再比较 `validFrom` 和 `observedAt`，时间更新的有效结论优先。
3. 如仍冲突，则比较 `evidenceRefs` 的新鲜度和覆盖范围。
4. 最终保留的结论应显式记录其来源，避免“被覆盖后无法追踪”。

这一规则必须由插件控制，不能完全交给 LLM 自由决定。

### LLM 不可用时的行为

本版本不提供 `--no-llm` 或确定性降级输出。

当 LLM 不可用、返回缺少结构化输出、或结构化输出无法通过 schema 约束时：

- 对应 session 标记为失败（failed）
- 不写入该 session 的摘要产物
- 命令执行结果中必须显式列出失败原因

## 时间模型

session 分析必须是带时间语义的。session 不是静态文档，而是一个不断演化的对话过程，其中可能包含错误方向、纠正、任务切换，以及很久之后被重新继续使用的情况。

因此，插件不能把 session 结论当成永远有效的静态结论，而应该把它们视为带时间边界的结论。

### 为什么时间顺序重要

如果不考虑时间顺序，插件很容易出现以下问题：

- 把已经失效的问题描述继续当作当前问题
- 把历史失败尝试与当前有效方向混在一起
- 夸大只在早期阶段出现过的文件或模块的重要性
- 根据过时上下文给出当前建议

### 三种分析视角

每个被分析的 session，都建议同时支持以下三种视角。

#### 1. 全量历史视角

用途：

- 保留整个 session 生命周期内的累计指标
- 反映总的纠正次数、命令摩擦、整体任务形态

适合产出的内容：

- 总 prompt 数
- 总纠正次数
- 整体任务类型
- 总工具失败次数
- 全 session 高关注文件与命令

#### 2. 增量视角

用途：

- 只分析上一次成功分析之后新增的内容
- 避免把旧上下文直接当成当前状态

适合产出的内容：

- 上次分析后新增的 prompt 数
- 新增纠正信号
- 新出现的文件或目录
- 本次是否发生了实质变化

#### 3. 当前活跃视角

用途：

- 表示 session 当前最新的有效方向
- 支撑当前建议，不被早期已失效内容污染

适合产出的内容：

- 当前关注领域
- 当前可能的任务类型
- 当前关注的文件或目录
- 当前建议信号

### 设计原则

历史内容可以保留用于累计统计，但当前建议应主要基于最新活跃片段，以及上次分析之后新增的 delta 内容。

### 分析顺序与“旧 session 污染”

用户可能会先分析最近 20 个 session，随后又分析更早的 40 个 session。为了保证结果可预期，聚合层必须满足以下规则：

- 聚合应是顺序无关（order-independent）的：同一批 session 的集合，无论分析顺序如何，最终聚合结果应一致。
- 每条 session 级结论、项目级结论和全局级结论都应带明确时间标注，例如结论生成时间、证据覆盖时间、结论生效时间。
- 每条结论都应显式声明是否存在有效期；如果没有特别约束，默认视为“无有效期”。
- 后续分析到更旧的 session 时，可以补充历史事实，但不应覆盖时间上更新的结论。
- 当多个结论冲突时，应比较时间与有效性边界，优先保留更新且仍有效的结论，而不是简单按最近一次运行覆盖。

## 增量分析策略

插件不能只问“这个 session 以前分析过没有”，而应该问：

“这个 session 的当前内容，是否已经被当前版本的分析器处理过？”

### 分析器版本

`analyzerVersion` 指的是插件自身分析逻辑和输出结构的版本，而不是 session 的版本。

当以下内容发生变化，并且足以影响输出时，都应视为分析器版本变化：

- 任务分类规则变了
- 纠正或失败识别规则变了
- 路径归一化规则变了
- 输出 schema 变了
- 建议生成逻辑变了

如果 `analyzerVersion` 变化，即使 session 内容没变，旧分析结果也应视为过期。

### Session 新鲜度状态

建议使用以下状态值：

- `never_analyzed`
- `up_to_date`
- `stale_due_to_new_messages`
- `stale_due_to_session_update`
- `stale_due_to_analyzer_change`
- `failed`

### 需要重分析的条件

满足以下任一条件时，应重新分析该 session：

- 从未分析过
- 上次成功分析之后又增加了新消息
- session 的 `updatedAt` 晚于上次分析时记录的状态
- 分析器版本变化了
- 上次分析失败
- 用户显式传入 `--force`

### 重分析时的处理方式

重新分析一个 session 时，应区分两部分：

- 上次已经分析过的基线部分
- 上次分析之后新增的 delta 部分

基线部分主要用于累计统计。
delta 部分主要用于刷新当前状态和当前建议。

## 数据模型

MVP 需要持久化足够的元数据，以支持重复运行、过期判断和用户可读输出。

### 分析索引

用途：

- 跟踪插件跨多次运行的状态
- 判断某个 session 是否需要重新分析

建议字段：

- `analyzerVersion`
- `lastRunAt`
- `sessions` 映射表，按 session id 或规范化 session path 建立索引

每个 session 的索引字段建议包括：

- `sessionId`
- `sessionPath`
- `projectPath`
- `status`
- `lastAnalyzedAt`
- `lastSeenUpdatedAt`
- `lastSeenMessageCount`
- `lastAnalyzedMessageIndex`
- `analyzerVersion`
- `summaryPath`
- `error`

### Session 摘要

用途：

- 记录单个 session 的结构化分析结果
- 为项目级和全局级聚合提供输入

建议字段：

- `sessionId`
- `projectPath`
- `analyzedAt`
- `sessionUpdatedAt`
- `fullRange`
- `deltaRange`
- `activeRange`
- `validFrom`
- `validTo`
- `expires`
- `overallTaskCategory`
- `currentTaskCategory`
- `totalPromptCount`
- `newPromptCount`
- `avgPromptLength`
- `totalCorrectionCount`
- `newCorrectionCount`
- `topFiles`
- `topDirectories`
- `topCommands`
- `toolFailureCount`
- `signals`
- `currentRecommendations`

### 项目级摘要

用途：

- 聚合某个项目下所有相关 session 的结果

建议字段：

- `projectPath`
- `generatedAt`
- `evidenceRange`
- `validFrom`
- `validTo`
- `sessionCount`
- `analyzedSessionCount`
- `taskCategoryDistribution`
- `frequentFiles`
- `frequentDirectories`
- `frequentCommands`
- `correctionPatterns`
- `activeFindings`
- `suggestions`

### 全局摘要

用途：

- 聚合跨项目的长期使用模式

建议字段：

- `generatedAt`
- `evidenceRange`
- `validFrom`
- `validTo`
- `projectCount`
- `sessionCount`
- `commonTaskPatterns`
- `commonPromptHabits`
- `commonWorkflowFriction`
- `suggestions`

## 分析启发式

MVP 第一版中的启发式规则主要用于构造更高质量的 LLM 输入与控制 token 噪声，不作为独立的降级输出模式。

建议第一批支持的指标和规则包括：

- prompt 数量
- 平均 prompt 长度
- 纠正循环频率
- 常见命令
- 常见文件和目录
- 工具失败次数
- 粗粒度任务类型识别，例如 `debug`、`feature`、`refactor`、`review`、`docs`
- 后期消息中的任务切换信号

建议优先实现的规则族包括：

### 纠正信号

识别体现返工、修正、方向调整的短语或模式。

### 任务类型信号

通过关键词和上下文匹配，推断 broad task type。

### 文件引用习惯

统计 prompt 中是否经常带明确路径、文件名或目标范围。

### 工作流摩擦信号

记录重复命令失败、重复尝试、工具错误等模式。

### 方向切换信号

识别后续消息中是否出现“推翻前结论”“切换关注点”“转向新阶段”等现象。

## 输出产物

插件应把内部状态、session 明细和用户可读报告分开存储。

建议的产物结构：

- `analysis-index.json`
- `sessions/<session-id>.json`
- `project-summary.json`
- `global-summary.json`
- `suggestions.md`

说明：

- `project-summary.json` 和 `global-summary.json` 中的结论应附带时间相关字段，例如 `generatedAt`、`evidenceRange`、`validFrom`、`validTo`，以便在后续分析更旧 session 时，通过比较时间判断哪些结论仍然有效。
- `validTo = null` 或等价表达应表示“当前无明确有效期限制”，不能默认推断为即将过期。

建议用途如下：

- `analysis-index.json`：缓存与新鲜度控制
- `sessions/<session-id>.json`：单个 session 的可解释分析结果
- `project-summary.json`：项目级汇总
- `global-summary.json`：跨项目汇总
- `suggestions.md`：面向用户的可读建议

## 存储策略

插件应维护自己的存储，不依赖 OpenCode 未文档化的内部 session 文件。

建议原则：

- 通过文档化 SDK API 读取 session
- 仅将插件自己的分析结果写入插件自有文件

建议存储位置仍保持此前调研中的方向：

- 全局分析数据放在全局 OpenCode 配置目录下
- 在适用时，项目级摘要可以写到项目本地的 OpenCode 目录中

具体最终路径可以在实现阶段再定，但产物结构应尽量稳定。

## 隐私与保留策略

MVP 应采用保守的持久化策略。

建议默认规则：

- 默认不保存完整原始消息正文，除非后续明确需要
- 优先保存聚合指标和推导信号，而不是完整 transcript
- 仅保存增量分析所需的必要元数据
- 在需要时对近期 session 明细保留有限窗口，避免无限增长

即使默认启用 LLM，隐私与存储范围也应保持显式和可控。

## 验证计划

只有满足以下条件，才应认为实现达标：

1. 自定义命令可以成功调用。
2. 插件可以正确解析分析范围。
3. 插件可以通过文档化 SDK API 正确列出 session 并读取消息。
4. 插件可以判断 session 是新的、过期的，还是已是最新状态。
5. 在 session 内容没有变化的情况下，重复执行不会做不必要的重复分析，除非显式 `--force`。
6. 当旧 session 被继续提问后，插件能把它标记为过期并正确刷新结果。
7. 当前建议主要来自最新活跃内容，而不是早期已失效内容。
8. 插件能稳定写出 JSON 和 Markdown 结果文件。
9. 插件不依赖 OpenCode 未文档化的内部存储结构。
10. 在先分析较新的 session、再分析更旧的 session 的情况下，旧 session 不会覆盖时间上更新的结论，且冲突结论可以通过时间字段判断有效性。

## 实施阶段

### Phase 1：命令与 Session 发现

交付内容：

- 命令注册
- 参数解析
- session 列表获取与范围过滤
- 基础分析索引

### Phase 2：Session 级分析

交付内容：

- 确定性指标提取
- session 新鲜度判断
- 支持 delta 的分析输出
- 发给 LLM 的结构化输入构建
- 单 session 摘要产物

### Phase 3：聚合与报告

交付内容：

- LLM 输出解析
- 项目级摘要生成
- 全局级摘要生成
- Markdown 建议文件输出
- 简洁的命令执行结果输出

### Phase 4：可选后续增强

后续可能扩展：

- 更细粒度的 session phase 切分
- 可选的低频被动汇总刷新
- 更明确的 inspection tool 或 UI 入口
- 更细粒度的 LLM 策略和预算控制

## 未决问题

以下问题属于实现阶段需要最终拍板的细节，而不是当前方案的阻塞项：

- OpenCode 插件命令注册在真实环境中的最终语法应该如何设计
- 当 session 与 project 的关联信息不完整时，如何稳定归属到项目
- 最近时间窗口摘要默认应采用 7 天、14 天还是 30 天
- 当前活跃片段第一版应基于 message index 切分，还是基于简单 phase heuristics 切分
- 项目级摘要是否只保留在全局存储中，还是同时镜像到项目本地目录

## 暂定建议

推荐的 MVP 定义如下：

一个由用户显式命令触发的 OpenCode 插件。它按需分析指定范围内的历史 session，跟踪每个 session 是否已经被当前分析器逻辑处理过，区分累计历史与新增内容，并通过 LLM 生成带时间语义的项目级和全局级摘要与建议。插件不自动改写 prompt，也不在被动钩子中隐藏触发 token 消耗；当 LLM 不可用时，分析应显式失败而不是降级输出。
