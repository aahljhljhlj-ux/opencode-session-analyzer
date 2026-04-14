# AGENTS.md

## Project Purpose

This repository contains a local OpenCode session analyzer plugin.

The current goal is not UI polish. The primary goal is to reliably analyze historical OpenCode sessions and write machine-readable JSON artifacts that can later support reports, summaries, and workflow suggestions.

The product value should remain centered on helping users improve how they work. Analysis artifacts, summaries, and any future classification or aggregation logic should ultimately support effective, explainable optimization suggestions for the user rather than analysis for its own sake.

Key product constraints:

- analysis must be explicitly triggered by the user
- no hidden background analysis by default
- prefer documented OpenCode SDK APIs over undocumented storage internals
- do not rewrite prompts or modify unrelated project files automatically
- JSON outputs must remain stable and explainable

## Current Entry Points

- Slash command: `.opencode/commands/session-analyzer.md`
- Plugin registration: `.opencode/plugins/session-analyzer.ts`
- Tool implementation: `src/opencode/tool.ts`
- Main analysis pipeline: `src/opencode/analyze.ts`

## Output Directory

Generated artifacts are written to:

- `.opencode/session-analyzer/analysis-index.json`
- `.opencode/session-analyzer/project-summary.json`
- `.opencode/session-analyzer/global-summary.json`
- `.opencode/session-analyzer/sessions/<session-id>.json`

These outputs are product artifacts. Changes to their schema should be deliberate and paired with an `ANALYZER_VERSION` bump.

## Architecture Notes

The codebase is intentionally small and split by responsibility:

- Reference Claude Memory design: note its passive update mechanism differs from this project's explicit trigger approach. Avoid introducing background analysis logic.

- `src/opencode/args.ts`: parse `/session-analyzer` flags
- `src/opencode/discovery.ts`: list and scope candidate sessions
- `src/opencode/indexing.ts`: stale detection and index updates
- `src/opencode/normalize.ts`: message normalization, metrics, evidence, signals
- `src/opencode/llm.ts`: session-level structured LLM analysis and fallback
- `src/opencode/analyze.ts`: orchestration, persistence, aggregation
- `src/opencode/storage.ts`: JSON read/write and artifact layout
- `src/opencode/types.ts`: shared analysis types and persisted schema

Prefer keeping logic in these modules instead of adding new layers unless the existing file becomes clearly overloaded.

## Development Rules

- Keep changes minimal and product-driven.
- Prefer changes that improve the analyzer's ability to produce useful, actionable user-facing optimization suggestions.
- Classification must serve recommendation quality. Prefer task/category signals that directly improve user-facing optimization suggestions over broad or weak labels collected for their own sake.
- Preserve deterministic behavior where possible.
- If analysis semantics change, bump `ANALYZER_VERSION` in `src/opencode/constants.ts`.
- Prefer improving input quality before adding more LLM complexity.
- Treat analyzer control sessions as noise and avoid including them in analysis outputs.
- Do not depend on undocumented OpenCode internal session files.

## LLM Rules

- Default path may use LLM.
- Analysis requires LLM availability. If structured LLM output is missing/invalid, mark the session as failed instead of falling back.
- LLM output must stay structured and evidence-linked.
- `evidenceRefs` must reference message IDs, not free text.
- Do not silently degrade to deterministic-only summaries.

## Aggregation Rules

- Session-level outputs are the source of truth for project/global aggregation.
- Older analysis must not overwrite newer valid conclusions only because it ran later.
- Favor time-aware fields such as `validFrom`, `validTo`, and evidence ranges.

## Verification

Before considering implementation changes complete, run:

```powershell
node_modules\.bin\tsc -p tsconfig.json --noEmit
```

When behavior changes affect summaries or persisted output, rerun the analyzer and inspect:

- `analysis-index.json`
- one or more `sessions/*.json`
- `project-summary.json`
- `global-summary.json`

For debugging, use `run-events.jsonl` to inspect the full progress event sequence together with `run-progress.json` snapshots.

## Known Current Risks

- `projectPath` attribution is still incomplete and may remain `null`.
- Heuristics for files/directories are conservative but still reflect conversation content, not only edited code.
- LLM integration currently uses temporary sessions to avoid self-queue deadlocks.

## Change Guidance

Good next steps:

- improve project attribution
- refine control-session filtering
- improve summary/report generation
- tighten time-aware aggregation

## Workflow Rules

- After wiring new structured-analysis fields or other analyzer schema changes, run the compile check immediately to catch integration mistakes early.
- Ignore greeting-only sessions in downstream summaries unless later messages add real work context.
- Keep toast/progress presentation logic localized to `src/opencode/tool.ts` unless there is concrete evidence that the event model in `analyze.ts` is insufficient.

Avoid for now unless explicitly requested:

- complex UI work
- passive background hooks
- automatic prompt rewriting
- automatic edits to project rules based on analyzer output
