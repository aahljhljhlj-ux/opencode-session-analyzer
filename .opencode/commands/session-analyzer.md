---
description: 默认按当前项目从最早开始分析 5 个待分析 session；可继续执行，或用 --project 分析当前项目全部待分析 session
---
Use the `session_analyzer` tool to analyze sessions for this workspace.

Arguments: `$ARGUMENTS`

Parse the arguments into this shape and call the tool exactly once unless the call fails and needs retry:

```json
{
  "arguments": "$ARGUMENTS"
}
```

After the tool returns, summarize in Chinese and keep it concise.

If the tool call fails before analysis starts because `session_analyzer` is unavailable, the plugin package failed to install, or the error looks like a permission/write/install problem:
- explain that OpenCode installs the npm plugin implicitly from the `plugin` config entry and users do not need to preinstall it manually
- clearly state this is usually a first-run permission problem while OpenCode is trying to write the plugin package
- tell the user to close OpenCode and reopen it once with administrator privileges, then retry `/session-analyzer`
- say that opening OpenCode as administrator once is usually enough for it to write the package successfully
- do not present the run as analyzer success in this case

Default behavior to explain to the user:
- `/session-analyzer` analyzes the next 5 eligible sessions for the current project, ordered from earliest to latest
- excluded sessions are not counted in totals, including analyzer control sessions
- already up-to-date sessions are not part of the pending batch
- `/session-analyzer --project` analyzes all eligible sessions for the current project, ordered from earliest to latest
- `/session-analyzer --recent <n>` selects the most recently updated `n` sessions in scope, then analyzes eligible ones from earliest to latest inside that window

Summarize:
- progress as `已分析数量/总共数量`, using `completedEligibleSessions/totalEligibleSessions`
- how many sessions were newly analyzed in this run
- remaining eligible session count if any
- output directory
- any failures

Inspect `failedSessions[].reason` when present.

Do not include excluded sessions in the total, such as analyzer control sessions.

If `remainingEligibleSessions > 0`, tell the user they can continue with `/session-analyzer`.

If they want to continue analyzing the current project in larger batches, mention `/session-analyzer --project`.

Preferred response style example:
- `当前项目 session 已分析 5/17。`
- `本次新分析了 5 个 session。`
- `还剩 12 个待分析 session，可继续执行 /session-analyzer。`
- `如果要一次性分析当前项目全部待分析 session，可执行 /session-analyzer --project。`

If any session has `reason: "llm_unavailable"`, state that clearly as analysis unavailable instead of presenting the run as partially successful analysis.

If `ruleSuggestionPrompt` is present:
- first summarize the successful analysis result briefly
- then show `ruleSuggestionPrompt.targetSuggestions` in Chinese
- for each suggestion, clearly present:
  - the suggestion itself
  - whether it is recommended for `当前项目 AGENTS.md` or `全局 AGENTS.md`
  - a short Chinese reason that helps the user decide instead of making them infer scope themselves
- then tell the user: if they confirm, you will apply them following the recommended targets
- do not modify any `AGENTS.md` unless the user explicitly confirms

Do not add unrelated code changes.
