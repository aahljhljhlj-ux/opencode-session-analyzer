# OpenCode Session Analyzer

[中文说明](./README.zh-CN.md)

An OpenCode plugin for analyzing historical sessions and writing stable, explainable JSON artifacts.

This project is focused on explicit, user-triggered analysis. It does not run hidden background analysis by default, and it does not maintain its own API keys. LLM-powered analysis uses the provider and model configuration already available in the user's OpenCode environment.

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

## Installation

### Local development

Use the checked-in local plugin files in this repository:

- `.opencode/plugins/session-analyzer.ts`
- `.opencode/commands/session-analyzer.md`

### npm package

Planned package name: `opencode-session-analyzer`

After publishing, add the package name to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-session-analyzer"
  ]
}
```

The package root exports `SessionAnalyzerPlugin`, and the repository also keeps the local `.opencode` plugin and command files for development.

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
