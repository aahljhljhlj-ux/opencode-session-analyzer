# OpenCode Plugin Research

## Purpose

This document summarizes the current OpenCode plugin ecosystem, plugin installation and loading model, relevant plugin APIs, and a practical design direction for a session analysis plugin.

The target idea is a plugin that reviews historical sessions and uses those patterns to improve:

- project-level guidance
- global guidance
- user prompt habits

---

## Current Local State

Observed local configuration on the research machine at the time of investigation:

- Global config file: `~/.config/opencode/opencode.jsonc`
- Global plugin directory: `~/.config/opencode/plugins/`
- Current configured npm plugins: none
- Current global local plugins: none

Relevant current config snippet:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": []
}
```

This means the sampled environment had plugin support available, but no plugins were installed yet.

---

## Official Plugin Installation Model

OpenCode supports two plugin forms.

### 1. Local file plugins

Plugin files can be placed in either of these directories:

- Project-level: `.opencode/plugins/`
- Global: `~/.config/opencode/plugins/`

OpenCode loads JavaScript or TypeScript files from those directories automatically at startup.

Example global path:

```txt
~/.config/opencode/plugins/
```

### 2. npm plugins

Plugins can also be installed by adding package names to the `plugin` array in config.

Example:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-helicone-session",
    "opencode-wakatime",
    "@my-org/custom-plugin"
  ]
}
```

Notes:

- Regular npm package names are supported
- Scoped packages are supported
- Installation is automatic on startup

---

## How Installation Works Internally

According to the OpenCode docs:

- npm plugins are installed automatically using Bun at startup
- Installed packages and dependencies are cached in `~/.cache/opencode/node_modules/`
- Local plugins are loaded directly from the plugin directory
- If local plugins need external dependencies, a `package.json` should be placed in the config directory
- OpenCode runs `bun install` at startup for those dependencies

Example local dependency file:

```json
{
  "dependencies": {
    "shescape": "^2.1.0"
  }
}
```

Typical locations:

- Global config directory package file: `~/.config/opencode/package.json`
- Project config directory package file: `.opencode/package.json`

---

## Plugin Load Order

Documented plugin load order:

1. Global config: `~/.config/opencode/opencode.json`
2. Project config: `opencode.json`
3. Global plugin directory: `~/.config/opencode/plugins/`
4. Project plugin directory: `.opencode/plugins/`

Implications:

- Global config provides baseline plugin configuration
- Project config can override config behavior
- Local project plugins are loaded after global plugins
- A local plugin and an npm plugin with similar names are treated as separate plugins
- Duplicate npm packages with the same name and version are loaded once

---

## Community Plugins Currently Listed

The OpenCode ecosystem page currently lists these plugins:

- `opencode-daytona`
- `opencode-helicone-session`
- `opencode-type-inject`
- `opencode-openai-codex-auth`
- `opencode-gemini-auth`
- `opencode-antigravity-auth`
- `opencode-devcontainers`
- `opencode-google-antigravity-auth`
- `opencode-dynamic-context-pruning`
- `opencode-vibeguard`
- `opencode-websearch-cited`
- `opencode-pty`
- `opencode-shell-strategy`
- `opencode-wakatime`
- `opencode-md-table-formatter`
- `opencode-morph-fast-apply`
- `opencode-morph-plugin`
- `oh-my-opencode`
- `opencode-notificator`
- `opencode-notifier`
- `opencode-zellij-namer`
- `opencode-skillful`
- `opencode-supermemory`
- `@plannotator/opencode`
- `@openspoon/subtask2`
- `opencode-scheduler`
- `opencode-conductor`
- `micode`
- `octto`
- `opencode-background-agents`
- `opencode-notify`
- `opencode-workspace`
- `opencode-worktree`
- `opencode-sentry-monitor`
- `opencode-firecrawl`

### Most relevant references for a session analysis idea

These appear conceptually closest to the proposed plugin direction:

- `opencode-supermemory`
  - persistent memory across sessions
- `opencode-dynamic-context-pruning`
  - session and context management optimization
- `opencode-skillful`
  - on-demand prompt or skill injection
- `micode`
  - workflow continuity and structured process
- `@openspoon/subtask2`
  - orchestration and command flow extension

These do not directly implement session analysis, but they are good references for:

- cross-session memory
- prompt augmentation
- session compaction strategy
- command and workflow orchestration

---

## Plugin Development Model

A plugin is a JavaScript or TypeScript module exporting one or more plugin functions.

Basic example:

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return {
    "session.updated": async (input, output) => {
      // hook logic here
    },
  }
}
```

Plugin context includes:

- `project`: current project information
- `directory`: current working directory
- `worktree`: git worktree path
- `client`: OpenCode SDK client
- `$`: Bun shell API

The most important item for a session analysis plugin is `client`, because it provides access to OpenCode server APIs.

---

## Relevant Plugin Events

Documented event and hook names include:

### Session-related

- `session.created`
- `session.compacted`
- `session.deleted`
- `session.diff`
- `session.error`
- `session.idle`
- `session.status`
- `session.updated`

### Message-related

- `message.part.removed`
- `message.part.updated`
- `message.removed`
- `message.updated`

### Command-related

- `command.executed`

### Tool-related

- `tool.execute.before`
- `tool.execute.after`

### Todo-related

- `todo.updated`

### TUI-related

- `tui.prompt.append`
- `tui.command.execute`
- `tui.toast.show`

### Shell-related

- `shell.env`

### Other useful signals

- `file.edited`
- `file.watcher.updated`
- `permission.asked`
- `permission.replied`
- `installation.updated`
- `lsp.client.diagnostics`
- `lsp.updated`

### Best candidate events for a session analysis plugin

Most useful hooks for the proposed plugin:

- `session.created`
- `session.updated`
- `session.idle`
- `session.compacted`
- `message.updated`
- `command.executed`
- `tool.execute.before`
- `tool.execute.after`
- `todo.updated`
- `tui.prompt.append`

These are enough to capture:

- prompt behavior
- repeated rework loops
- common commands
- common tool failures
- common task types
- project-specific workflow habits

---

## SDK Capabilities Relevant to Session Analysis

The OpenCode SDK exposes APIs that a plugin can use through `client`.

### Session APIs

- `session.list()`
- `session.get({ path })`
- `session.children({ path })`
- `session.create({ body })`
- `session.delete({ path })`
- `session.update({ path, body })`
- `session.init({ path, body })`
- `session.abort({ path })`
- `session.share({ path })`
- `session.unshare({ path })`
- `session.summarize({ path, body })`
- `session.messages({ path })`
- `session.message({ path })`
- `session.prompt({ path, body })`
- `session.command({ path, body })`
- `session.shell({ path, body })`
- `session.revert({ path, body })`
- `session.unrevert({ path })`

### Config and app APIs

- `config.get()`
- `config.providers()`
- `app.log()`
- `app.agents()`

### File and search APIs

- `find.text({ query })`
- `find.files({ query })`
- `find.symbols({ query })`
- `file.read({ query })`
- `file.status({ query })`

### TUI APIs

- `tui.appendPrompt({ body })`
- `tui.executeCommand({ body })`
- `tui.showToast({ body })`

### Key implication

The proposed plugin should prefer the SDK to inspect historical sessions instead of depending on undocumented internal storage formats.

That is the safest and most maintainable approach.

---

## Feasibility Assessment For a Session Analysis Plugin

### Short answer

Yes, it appears feasible.

### Why it is feasible

- There are session lifecycle events that can trigger analysis
- There are message-related events that can support prompt pattern tracking
- The plugin runtime has access to an SDK client
- The SDK can list sessions and retrieve messages
- The plugin can also inject prompts, show UI hints, log events, and define custom tools

### Main constraint

The documented interface does not explicitly promise direct access to all underlying stored session files or internal databases.

Therefore, the plugin should:

- use documented SDK APIs first
- maintain its own analysis cache or summaries
- avoid reverse-engineering undocumented OpenCode internals unless absolutely necessary

---

## Practical Design Direction

The best approach is to split the plugin into layers.

### Layer 1: Observation

Goal: capture useful session behavior without changing user experience.

Suggested captured data:

- session id
- project path
- timestamps
- number of user prompts
- average prompt length
- repeated correction phrases
- common commands
- common tool failures
- common files and directories involved
- inferred task category such as debug, feature, refactor, review

Suggested output:

- project-level JSON summaries
- global-level JSON summaries
- rolling metrics by date or session

### Layer 2: Recommendations

Goal: convert observed patterns into actionable guidance.

Possible recommendation types:

- suggest better prompt structure
- suggest using plan mode before implementation for certain task types
- suggest updating project `AGENTS.md`
- suggest extracting repeated instructions into global rules or skills
- suggest project-specific starter prompts

Examples:

- "This project repeatedly touches auth files. Consider adding auth constraints to project instructions."
- "Many sessions include follow-up corrections. Consider a short planning prompt before build requests."
- "You often omit target file paths. Add `@path` references more consistently."

### Layer 3: Controlled intervention

Goal: optionally improve workflows automatically, but conservatively.

Possible mechanisms:

- append prompt guidance using `tui.appendPrompt`
- inject compaction context using `experimental.session.compacting`
- add a custom tool for session analysis reports
- show non-intrusive TUI toasts with suggestions

This should remain conservative. A plugin that rewrites user intent too aggressively will likely become noisy or unpredictable.

---

## Recommended MVP

The simplest useful first version should avoid heavy automation.

### MVP goals

- observe sessions
- analyze patterns
- produce reports
- optionally surface suggestions

### MVP feature set

1. Listen to `session.idle` and `session.updated`
2. Use SDK methods to fetch session messages
3. Extract basic metrics:
   - prompt count
   - average input length
   - correction frequency
   - frequent directories or files
   - frequent task categories
4. Persist summaries in plugin-owned storage
5. Provide a way to inspect results

### Suggested storage locations

Global analysis storage:

```txt
~/.config/opencode/session-analyzer/
```

Project analysis storage:

```txt
.opencode/session-analyzer/
```

### Suggested initial outputs

- `global-summary.json`
- `project-summary.json`
- `recent-sessions.json`
- `suggestions.md`

---

## Potential Feature Directions After MVP

### 1. Prompt habit coaching

Analyze user prompts for:

- lack of file references
- ambiguous verbs
- missing constraints
- repeated correction loops
- frequent switching between planning and implementation

Then suggest:

- prompt templates
- file reference habits
- project-specific task framing

### 2. Project instruction optimization

Detect stable patterns that should move into project instructions, such as:

- preferred coding style
- project-specific architectural constraints
- recurring areas of confusion
- required verification steps

The plugin could generate candidate additions for:

- `AGENTS.md`
- `.opencode/commands/`
- project-specific rules

### 3. Global workflow optimization

Detect long-term user habits across repositories, such as:

- preferred development loop
- preferred model or agent types
- repeated prompt scaffolding
- repeated review patterns

The plugin could then propose global settings or reusable prompts.

### 4. Session compaction enhancement

Use compaction hooks to preserve:

- current task state
- repeated project constraints
- recurring user preferences
- unresolved blockers

This is especially valuable for long-running tasks.

### 5. Custom tooling

The plugin could expose a custom tool such as:

- `analyze_session`
- `analyze_project_habits`
- `suggest_prompt_improvements`

This would make the analysis explicitly callable instead of purely passive.

---

## Risks And Constraints

### 1. Over-automation risk

If the plugin auto-rewrites prompts or injects too much guidance, it may reduce predictability and become distracting.

Preferred approach:

- start with reporting and suggestions
- only later add opt-in automation

### 2. Internal storage coupling risk

If implementation depends on undocumented OpenCode internals, upgrades may break the plugin.

Preferred approach:

- use SDK APIs first
- treat internal file formats as unstable

### 3. Privacy and sensitivity risk

Historical sessions may contain:

- code snippets
- secrets mentioned by users
- internal design decisions
- personal working patterns

If this plugin stores summaries, it should define:

- what is stored
- what is redacted
- how long it is retained
- whether storage is per project or global

### 4. Quality of heuristic classification

Task-type detection and habit analysis may be noisy at first.

Preferred approach:

- start with simple deterministic heuristics
- add optional LLM summarization later

---

## Recommended Implementation Strategy

### Phase 1

Build a global local plugin, not an npm package.

Reasoning:

- easier iteration
- lower packaging overhead
- easier inspection and debugging
- best for validating event and SDK behavior

Suggested path during local prototyping:

```txt
~/.config/opencode/plugins/session-analyzer.ts
```

### Phase 2

Validate that the plugin can reliably:

- identify sessions
- fetch messages
- compute metrics
- store summaries
- surface suggestions

### Phase 3

If useful and stable, convert it into a publishable npm package.

Suggested eventual package shape:

- package name like `@your-scope/opencode-session-analyzer`
- configurable retention and privacy options
- opt-in suggestion modes
- optional custom tool commands

---

## Suggested Project Questions For Next Planning Step

Before implementation, it would be useful to answer:

1. Is the plugin global, project-level, or both?
2. Should it only suggest improvements, or also inject prompt/context automatically?
3. What exact user habits should be measured first?
4. What data can be stored safely?
5. Should analysis be deterministic, LLM-assisted, or hybrid?
6. Should the plugin expose a custom tool, a command, or only passive hooks?
7. How should users inspect reports: markdown, JSON, toast, or command output?
8. Should recommendations update files automatically, or only generate candidate edits?

---

## Provisional Recommendation

For the first implementation, the most practical product definition is:

"A local global OpenCode plugin that observes session behavior, builds lightweight project and global summaries, and suggests prompt and workflow improvements without automatically rewriting user intent."

This is narrow enough to build safely and useful enough to validate quickly.

---

## Sources Consulted

Primary sources used for this research:

- OpenCode docs: `https://opencode.ai/docs/plugins/`
- OpenCode docs: `https://opencode.ai/docs/ecosystem/`
- OpenCode docs: `https://opencode.ai/docs/config/`
- OpenCode docs: `https://opencode.ai/docs/sdk/`
- Example local config: `~/.config/opencode/opencode.jsonc`
- Example local rules: `~/.config/opencode/AGENTS.md`
- Example local global plugin directory: `~/.config/opencode/plugins/`
