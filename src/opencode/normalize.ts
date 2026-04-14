import { DEFAULT_ACTIVE_MESSAGE_WINDOW, DEFAULT_EVIDENCE_SNIPPET_LIMIT } from "./constants"
import type {
  AnalysisIndexEntry,
  DeterministicMetrics,
  EvidenceSnippet,
  NormalizedFilePart,
  NormalizedMessage,
  NormalizedTextPart,
  NormalizedToolPart,
  RangeBoundary,
  SessionAnalysisInput,
  SessionCandidate,
  SessionSignals,
} from "./types"
import {
  asArray,
  asRecord,
  asString,
  clipText,
  dirnameFromPath,
  incrementCounter,
  normalizeWhitespace,
  topEntries,
  toIsoString,
  uniqueByKey,
} from "./utils"
import { ANALYZER_VERSION } from "./constants"

const CORRECTION_PATTERNS = [
  /fix/i,
  /instead/i,
  /actually/i,
  /retry/i,
  /again/i,
  /not that/i,
  /rework/i,
  /wrong/i,
]

const DIRECTION_CHANGE_PATTERNS = [
  /switch/i,
  /different approach/i,
  /new direction/i,
  /let'?s do/i,
  /focus on/i,
  /move to/i,
]

// Keep patterns conservative: MVP wants low-noise signals.
// We intentionally do not match arbitrary `foo.bar` tokens to avoid URLs/domains and event names.
const PATH_LIKE_PATTERN = /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|\/|\\)[^\s"'`<>|]+/g
const FILENAME_PATTERN = /\b[\w.-]+\.[A-Za-z0-9]{1,6}\b/g

const SHELL_FENCE_LANGS = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "shell",
  "console",
  "powershell",
  "pwsh",
  "ps1",
])

const ALLOWED_FILE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "md",
  "txt",
  "yml",
  "yaml",
  "toml",
  "lock",
  "py",
  "go",
  "rs",
  "java",
  "kt",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "cs",
  "php",
  "rb",
  "sh",
  "ps1",
  "bat",
])

const ANALYZER_ARTIFACT_FILE_BASENAMES = new Set([
  "analysis-index.json",
  "project-summary.json",
  "global-summary.json",
])

export function normalizeMessages(messages: unknown[]): NormalizedMessage[] {
  return messages
    .map((message, messageIndex) => normalizeMessage(message, messageIndex))
    .filter((message): message is NormalizedMessage => message !== null)
}

function normalizeMessage(message: unknown, messageIndex: number): NormalizedMessage | null {
  const record = asRecord(message)
  const info = asRecord(record.info)
  const parts = asArray<unknown>(record.parts)
  const messageId = asString(info.id) ?? `message-${messageIndex}`
  const role = asString(info.role) ?? asString(record.role) ?? "unknown"
  const timestamp =
    toIsoString(asRecord(info.time).created) ?? toIsoString(info.createdAt) ?? toIsoString(record.createdAt)

  const textParts: NormalizedTextPart[] = []
  const fileParts: NormalizedFilePart[] = []
  const toolParts: NormalizedToolPart[] = []

  for (const part of parts) {
    const normalized = normalizePart(part)
    if (!normalized) {
      continue
    }

    if (normalized.type === "text") {
      textParts.push(normalized)
      continue
    }

    if (normalized.type === "file") {
      fileParts.push(normalized)
      continue
    }

    toolParts.push(normalized)
  }

  const usableText = textParts
    .filter((part) => !part.synthetic)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n")

  return {
    messageId,
    messageIndex,
    role,
    timestamp,
    text: usableText,
    hasUsableText: usableText.length > 0,
    textParts,
    fileParts,
    toolParts,
  }
}

function normalizePart(part: unknown): NormalizedTextPart | NormalizedFilePart | NormalizedToolPart | null {
  const record = asRecord(part)
  const type = asString(record.type)

  if (type === "text") {
    const text = asString(record.text)
    if (!text) {
      return null
    }

    return {
      type,
      text,
      synthetic: record.synthetic === true,
    }
  }

  if (type === "file") {
    const source = asRecord(record.source)
    return {
      type,
      path: asString(source.path) ?? asString(record.path),
      filename: asString(record.filename) ?? asString(source.filename),
      url: asString(record.url) ?? asString(source.url),
    }
  }

  if (type === "tool") {
    const tool = asRecord(record.tool)
    const toolName = asString(tool.name) ?? asString(record.name)
    const state = asString(record.state) ?? asString(asRecord(record.status).type)
    const error = asString(record.error) ?? asString(asRecord(record.result).error)
    const summary = error ?? asString(record.summary) ?? asString(asRecord(record.result).output)

    return {
      type,
      toolName,
      state,
      isError: Boolean(error) || /error|failed/i.test(state ?? ""),
      summary: summary ? clipText(normalizeWhitespace(summary), 280) : null,
    }
  }

  return null
}

export function buildSessionAnalysisInput(args: {
  session: SessionCandidate
  messages: NormalizedMessage[]
  indexEntry: AnalysisIndexEntry | null
  analyzedAt: string
}): SessionAnalysisInput {
  const { session, messages, indexEntry, analyzedAt } = args
  const fullRange = createRange(messages, 0, messages.length - 1)
  const deltaStartIndex = indexEntry?.lastSeenMessageCount ?? 0
  const deltaRange =
    deltaStartIndex < messages.length
      ? createRange(messages, deltaStartIndex, messages.length - 1)
      : createEmptyRange()
  const activeStartIndex = Math.max(0, messages.length - DEFAULT_ACTIVE_MESSAGE_WINDOW)
  const activeRange = messages.length > 0 ? createRange(messages, activeStartIndex, messages.length - 1) : createEmptyRange()
  const deterministicMetrics = computeMetrics(messages, deltaStartIndex)
  const signals = detectSignals(messages, deltaStartIndex)
  const evidenceSnippets = buildEvidenceSnippets(messages, deltaRange, activeRange)

  return {
    sessionMeta: {
      sessionId: session.id,
      projectPath: session.projectPath,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      analyzedAt,
      analyzerVersion: ANALYZER_VERSION,
    },
    timeRanges: {
      fullRange,
      deltaRange,
      activeRange,
    },
    deterministicMetrics,
    signals,
    evidenceSnippets,
    analysisGoal: "Generate session-level JSON-ready findings with clear time boundaries for current active work.",
  }
}

function computeMetrics(messages: NormalizedMessage[], deltaStartIndex: number): DeterministicMetrics {
  const userMessages = messages.filter((message) => message.role === "user" && message.hasUsableText)
  const newUserMessages = userMessages.filter((message) => message.messageIndex >= deltaStartIndex)
  const promptLengths = userMessages.map((message) => message.text.length)
  const averageLength =
    promptLengths.length === 0
      ? 0
      : Math.round(promptLengths.reduce((sum, value) => sum + value, 0) / promptLengths.length)

  const fileCounter = new Map<string, number>()
  const directoryCounter = new Map<string, number>()
  const commandCounter = new Map<string, number>()
  let toolFailureCount = 0

  for (const message of messages) {
    for (const filePart of message.fileParts) {
      addFileReferenceCounters(filePart.path ?? filePart.filename, fileCounter, directoryCounter)
    }

    for (const token of extractFileTokens(message.text)) {
      addFileReferenceCounters(token, fileCounter, directoryCounter)
    }

    for (const cmd of extractCommandTokens(message.text)) {
      incrementCounter(commandCounter, cmd)
    }

    for (const toolPart of message.toolParts) {
      incrementCounter(commandCounter, toolPart.toolName)
      if (toolPart.isError) {
        toolFailureCount += 1
      }
    }
  }

  return {
    totalPromptCount: userMessages.length,
    newPromptCount: newUserMessages.length,
    avgPromptLength: averageLength,
    toolFailureCount,
    topFiles: topEntries(fileCounter),
    topDirectories: topEntries(directoryCounter),
    topCommands: topEntries(commandCounter),
  }
}

function addFileReferenceCounters(
  token: string | null,
  fileCounter: Map<string, number>,
  directoryCounter: Map<string, number>,
): void {
  const normalized = normalizeFileToken(token)
  if (!normalized || !shouldCountFile(normalized)) {
    return
  }

  incrementCounter(fileCounter, normalized)
  const dir = dirnameFromPath(normalized)
  if (dir !== normalized) {
    incrementCounter(directoryCounter, dir)
  }
}

function extractFileTokens(text: string): string[] {
  const results: string[] = []

  for (const match of text.match(PATH_LIKE_PATTERN) ?? []) {
    results.push(match)
  }

  // Also allow explicit filenames like `plan.md` (but only for allowlisted extensions).
  for (const match of text.match(FILENAME_PATTERN) ?? []) {
    results.push(match)
  }

  return results
}

function normalizeFileToken(token: string | null): string | null {
  if (!token) {
    return null
  }

  let value = token.trim()

  // Strip leading file-reference marker.
  if (value.startsWith("@")) {
    value = value.slice(1)
  }

  // Strip surrounding punctuation that often appears around paths.
  value = value.replace(/^[`"'(\[]+/, "").replace(/[)`"'\],.;:!?]+$/, "")

  if (value.length === 0) {
    return null
  }

  return value
}

function shouldCountFile(value: string): boolean {
  // Exclude URLs and URL-like fragments.
  if (/^[a-z]+:\/\//i.test(value) || value.includes("://")) {
    return false
  }

  const normalized = value.replace(/\\/g, "/")
  const basename = normalized.split("/").at(-1) ?? normalized

  // Exclude analyzer's own artifacts and storage directory.
  if (normalized.includes("/.opencode/session-analyzer/") || normalized.includes(".opencode/session-analyzer/")) {
    return false
  }

  // Exclude global OpenCode config/plugin paths; project-local .opencode files are still useful.
  if (/\/\.config\/opencode\//i.test(normalized) || /C:\/Users\/[^/]+\/\.config\/opencode\//i.test(normalized)) {
    return false
  }

  if (ANALYZER_ARTIFACT_FILE_BASENAMES.has(basename)) {
    return false
  }

  const ext = basename.includes(".") ? (basename.split(".").at(-1) ?? "").toLowerCase() : ""
  if (!ALLOWED_FILE_EXTENSIONS.has(ext)) {
    return false
  }

  // Exclude OpenCode event names that look like `session.updated`.
  if (/^(session|message|tool|tui|lsp|file)\.[a-z0-9_.-]+$/i.test(basename)) {
    return false
  }

  return true
}

function extractCommandTokens(text: string): string[] {
  const commands = new Set<string>()

  // 1) Explicit `$ cmd ...` shell lines.
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("$")) {
      continue
    }

    const after = trimmed.replace(/^\$\s*/, "")
    const cmd = after.split(/\s+/)[0] ?? ""
    if (cmd && cmd.length <= 40) {
      commands.add(cmd)
    }
  }

  // 2) Commands inside fenced shell blocks.
  const fenceCommands = extractCommandsFromFences(text)
  for (const cmd of fenceCommands) {
    commands.add(cmd)
  }

  return [...commands]
}

function extractCommandsFromFences(text: string): string[] {
  const commands: string[] = []
  const lines = text.split("\n")
  let inFence = false
  let fenceLang: string | null = null

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const fenceStart = line.match(/^```\s*([a-zA-Z0-9_-]+)?\s*$/)
    if (fenceStart) {
      if (!inFence) {
        inFence = true
        fenceLang = (fenceStart[1] ?? "").toLowerCase()
      } else {
        inFence = false
        fenceLang = null
      }
      continue
    }

    if (!inFence) {
      continue
    }

    if (fenceLang && !SHELL_FENCE_LANGS.has(fenceLang)) {
      continue
    }

    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }

    const withoutPrompt = trimmed.startsWith("$") ? trimmed.replace(/^\$\s*/, "") : trimmed
    const cmd = withoutPrompt.split(/\s+/)[0] ?? ""
    if (cmd && /^[a-zA-Z][\w.-]*$/.test(cmd) && cmd.length <= 40) {
      commands.push(cmd)
    }
  }

  return commands
}

function detectSignals(messages: NormalizedMessage[], deltaStartIndex: number): SessionSignals {
  const correctionSignals = []
  const directionChangeSignals = []

  for (const message of messages) {
    if (message.role !== "user" || !message.hasUsableText) {
      continue
    }

    if (CORRECTION_PATTERNS.some((pattern) => pattern.test(message.text))) {
      correctionSignals.push({
        type: message.messageIndex >= deltaStartIndex ? "new_correction" : "correction",
        messageId: message.messageId,
        messageIndex: message.messageIndex,
        timestamp: message.timestamp,
        text: clipText(message.text, 240),
      })
    }

    if (DIRECTION_CHANGE_PATTERNS.some((pattern) => pattern.test(message.text))) {
      directionChangeSignals.push({
        type: message.messageIndex >= deltaStartIndex ? "new_direction_change" : "direction_change",
        messageId: message.messageId,
        messageIndex: message.messageIndex,
        timestamp: message.timestamp,
        text: clipText(message.text, 240),
      })
    }
  }

  return {
    correctionSignals,
    directionChangeSignals,
  }
}

function buildEvidenceSnippets(
  messages: NormalizedMessage[],
  deltaRange: RangeBoundary,
  activeRange: RangeBoundary,
): EvidenceSnippet[] {
  const snippets: EvidenceSnippet[] = []

  const addRangeSnippets = (range: RangeBoundary, rangeType: "delta" | "active" | "full") => {
    if (range.startMessageIndex === null || range.endMessageIndex === null) {
      return
    }

    for (let index = range.startMessageIndex; index <= range.endMessageIndex; index += 1) {
      const message = messages[index]
      if (!message || !message.hasUsableText) {
        continue
      }

      snippets.push({
        messageId: message.messageId,
        messageIndex: message.messageIndex,
        role: message.role,
        timestamp: message.timestamp,
        rangeType,
        text: clipText(message.text, 500),
      })
    }
  }

  addRangeSnippets(deltaRange, "delta")
  addRangeSnippets(activeRange, "active")

  return uniqueByKey(snippets, (snippet) => snippet.messageId).slice(0, DEFAULT_EVIDENCE_SNIPPET_LIMIT)
}

function createRange(messages: NormalizedMessage[], startIndex: number, endIndex: number): RangeBoundary {
  if (messages.length === 0 || startIndex > endIndex || startIndex >= messages.length) {
    return createEmptyRange()
  }

  const safeEndIndex = Math.min(endIndex, messages.length - 1)
  const start = messages[startIndex]
  const end = messages[safeEndIndex]

  return {
    startMessageIndex: start.messageIndex,
    endMessageIndex: end.messageIndex,
    startMessageId: start.messageId,
    endMessageId: end.messageId,
    startAt: start.timestamp,
    endAt: end.timestamp,
  }
}

function createEmptyRange(): RangeBoundary {
  return {
    startMessageIndex: null,
    endMessageIndex: null,
    startMessageId: null,
    endMessageId: null,
    startAt: null,
    endAt: null,
  }
}
