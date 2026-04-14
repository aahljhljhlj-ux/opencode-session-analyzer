# OpenCode Session Analyzer

[English README](./README.md)

这是一个 OpenCode 插件，用于分析历史 session，并输出稳定、可解释的 JSON 产物。

本项目强调由用户显式触发分析，不默认进行隐藏的后台分析，也不单独维护自己的 API key。LLM 分析直接复用用户当前 OpenCode 环境中已经配置好的 provider 和 model。

## 功能

- 按需分析历史 OpenCode session
- 生成 session、project、global 级别的机器可读 JSON 产物
- 跟踪哪些 session 已分析、哪些已经 stale
- 保留带 evidence 引用的结构化分析结果
- 生成可复用的工作流建议，但不自动改写项目规则

## 包含内容

- 插件入口：`.opencode/plugins/session-analyzer.ts`
- slash command：`.opencode/commands/session-analyzer.md`
- 工具实现：`src/opencode/tool.ts`
- 主分析流程：`src/opencode/analyze.ts`

## 安装

### 本地开发

当前仓库已经包含本地开发用的插件文件：

- `.opencode/plugins/session-analyzer.ts`
- `.opencode/commands/session-analyzer.md`

### npm 包

计划发布包名：`opencode-session-analyzer`

发布后，可将包名加入 OpenCode 配置：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-session-analyzer"
  ]
}
```

包根目录会导出 `SessionAnalyzerPlugin`，仓库中也保留了开发期使用的本地 `.opencode` 插件和命令文件。

## 用法

在 OpenCode 中执行：

```text
/session-analyzer
```

常见变体：

- `/session-analyzer`
- `/session-analyzer --project`
- `/session-analyzer --recent 10`
- `/session-analyzer --session <id-or-path>`
- `/session-analyzer --force`
- `/session-analyzer --only-stale`

## 输出文件

运行后会写入：

` .opencode/session-analyzer/ `

包含：

- `analysis-index.json`
- `run-progress.json`
- `run-events.jsonl`
- `project-summary.json`
- `global-summary.json`
- `sessions/<session-id>.json`

这些都是本地生成产物，不应该提交到仓库，也不应该发布到 npm。

## 支持参数

- `--recent <n>`
- `--project current`
- `--project <path>`
- `--session <id-or-path>`
- `--force`
- `--only-stale`

默认批处理行为：

- `/session-analyzer` 会分析当前项目中下一批 5 个 eligible session
- `/session-analyzer --project` 会分析当前项目中全部 eligible session
- `/session-analyzer --recent <n>` 会先选出范围内最近更新的 `n` 个 session，再按这些 session 中从早到晚的顺序执行分析

## LLM 行为

- 当前 MVP 固定走 LLM 分析路径
- 如果某个 session 的 structured LLM output 缺失或无效，该 session 会被标记为失败
- 当 structured LLM analysis 失败时，不会退回 deterministic-only summary

## 验证

TypeScript 检查命令：

```powershell
node_modules\.bin\tsc -p tsconfig.json --noEmit
```

## 隐私

- 生成的分析产物可能包含历史 session 内容
- 生成产物也可能包含本机路径和诊断信息
- 应保持 `.opencode/session-analyzer/` 被 git 忽略，并且不要发布到 npm

## 当前限制

- 当前仓库仍主要按源码工作区和本地插件方式组织
- 最终 npm 分发形态仍建议在真实 OpenCode 安装环境中验证一次
- `/session-analyzer` 当前通过 OpenCode custom tool 路由，而不是内建 plugin command API
- project/global 聚合逻辑仍然比较轻量，还没有实现完整的时间冲突解析

## License

MIT
