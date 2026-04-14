# OpenCode Session Analyzer

[中文说明](./README.zh-CN.md)

An OpenCode plugin for analyzing historical sessions and providing suggestions for users, aimed at improving project-level or global AGENTS.md memory files.

This project is focused on explicit, user-triggered analysis. It does not run hidden background analysis by default, and it does not maintain its own API keys. LLM-powered analysis uses the provider and model configuration already available in the user's OpenCode environment.

## Quick Start

Package name: `opencode-session-analyzer`

Recommended: add this to your OpenCode global config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-session-analyzer"],
  "command": {
    "session-analyzer": {
      "description": "Analyze the next 5 eligible sessions for the current project",
      "template": "Use the `session_analyzer` tool to analyze sessions for this workspace.\n\nArguments: `$ARGUMENTS`\n\nParse the arguments into this shape and call the tool exactly once unless the call fails and needs retry:\n\n```json\n{\n  \"arguments\": \"$ARGUMENTS\"\n}\n```\n\nAfter the tool returns, summarize in Chinese and keep it concise. Report analyzed progress, newly analyzed sessions, remaining eligible sessions, output directory, and any failures. Mention `/session-analyzer --project` when more eligible sessions remain.\n\nIf the tool call fails before analysis starts because `session_analyzer` is unavailable, the plugin package failed to install, or the error looks like a permission/write/install problem: explain that OpenCode installs the npm plugin implicitly from the `plugin` config entry and users do not need to preinstall it manually; clearly state this is usually a first-run permission problem while OpenCode is trying to write the plugin package; tell the user to close OpenCode and reopen it once with administrator privileges, then retry `/session-analyzer`; say that opening OpenCode as administrator once is usually enough for it to write the package successfully; do not present the run as analyzer success in this case."
    }
  }
}
```

On first use, OpenCode will automatically install `opencode-session-analyzer`. If the tool cannot be found, the install likely failed because OpenCode could not write the package during setup. Close OpenCode, then either reopen OpenCode once with administrator privileges or run `opencode` from an administrator terminal, and retry `/session-analyzer`. In practice, one elevated launch is usually enough for OpenCode to write the package successfully.

## Features

- analyzes historical OpenCode sessions on demand
- writes machine-readable JSON artifacts for session, project, and global summaries
- tracks stale vs. already-analyzed sessions
- preserves evidence-linked structured outputs
- suggests reusable workflow guidance without automatically rewriting project rules

## Included

- plugin entry: `.opencode/plugins/session-analyzer.ts`
- slash command: `.opencode/commands/session-analyzer.md`
- tool implementation: `src/opencode/tool.ts`
- main analysis pipeline: `src/opencode/analyze.ts`

## Usage

Run the slash command in OpenCode:

```text
/session-analyzer
```

Common variants:

- `/session-analyzer`
- `/session-analyzer --project`
- `/session-analyzer --recent 10`
- `/session-analyzer --session <id-or-path>`
- `/session-analyzer --force`
- `/session-analyzer --only-stale`

## Output Files

Running the tool writes artifacts to:

` .opencode/session-analyzer/ `

Files:

- `analysis-index.json`
- `run-progress.json`
- `run-events.jsonl`
- `project-summary.json`
- `global-summary.json`
- `sessions/<session-id>.json`

These are generated local artifacts and should not be committed or published.

## Supported Arguments

- `--recent <n>`
- `--project current`
- `--project <path>`
- `--session <id-or-path>`
- `--force`
- `--only-stale`

Default batching behavior:

- `/session-analyzer` analyzes the next 5 eligible sessions in the current project
- `/session-analyzer --project` analyzes all eligible sessions in the current project
- `/session-analyzer --recent <n>` selects the most recently updated `n` sessions in scope, then analyzes eligible ones from earliest to latest inside that window

## LLM Behavior

- the current MVP always uses the LLM analysis path
- if structured LLM output is unavailable or invalid for a session, that session is marked as failed
- the analyzer does not fall back to deterministic-only summaries when structured LLM analysis fails

## Verification

TypeScript check:

```powershell
node_modules\.bin\tsc -p tsconfig.json --noEmit
```

Package verification before publish:

```powershell
npm pack --dry-run
npm pack
```

## Privacy

- generated analysis artifacts can contain historical session content
- generated artifacts can also contain local machine paths and diagnostics
- keep `.opencode/session-analyzer/` ignored in git and out of published packages

## Current Limitations

- the repository is still primarily organized as a source workspace and local plugin setup
- final npm distribution should still be verified in a real OpenCode install
- the `/session-analyzer` command currently routes through an OpenCode custom tool instead of a built-in plugin command API
- project/global aggregation is still intentionally lightweight and does not yet implement full time-aware conflict resolution

## License

MIT
