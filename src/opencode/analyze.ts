import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import type {
  AnalyzeCommandOptions,
  AnalyzeFailure,
  AnalyzeFailureReason,
  AnalyzeProgressCounts,
  AnalyzeProgressEvent,
  AnalyzeProgressUpdate,
  AnalyzeProgressSnapshot,
  AnalyzeRunResult,
  AnalysisIndex,
  GlobalSummary,
  ProjectSummary,
  RuleCandidateDecision,
  RuleSuggestionPrompt,
  SessionCandidate,
  SessionSummary,
} from "./types"
import { ANALYZER_VERSION } from "./constants"
import { discoverSessions } from "./discovery"
import { getIndexEntry, evaluateFreshness, updateIndexEntry } from "./indexing"
import { generateSessionLlmResult } from "./llm"
import { logBestEffort } from "./logging"
import { buildSessionAnalysisInput, normalizeMessages } from "./normalize"
import {
  emptyIndex,
  appendRunEvent,
  ensureStorageLayout,
  getSessionSummaryPath,
  readJsonFile,
  resetRunEvents,
  writeGlobalSummary,
  writeJsonFile,
  writeProjectSummary,
  writeRunProgress,
  writeSessionSummary,
} from "./storage"

export async function runSessionAnalyzer(args: {
  client: any
  directory: string
  options: AnalyzeCommandOptions
  onProgress?: (event: AnalyzeProgressUpdate) => void | Promise<void>
}): Promise<AnalyzeRunResult> {
  const { client, directory, options, onProgress } = args
  const storage = await ensureStorageLayout(directory)
  const now = new Date().toISOString()
  const index = await readJsonFile<AnalysisIndex>(storage.indexPath, emptyIndex(ANALYZER_VERSION))
  index.analyzerVersion = ANALYZER_VERSION
  const analyzedSessions: string[] = []
  const skippedUpToDateSessions: string[] = []
  const skippedAnalyzerSessions: string[] = []
  const staleSessions: Array<{ sessionId: string; status: SessionSummary["freshnessStatus"] }> = []
  const failedSessions: AnalyzeFailure[] = []
  const summaries: SessionSummary[] = []
  let progressEventIndex = 0

  await resetRunEvents(storage.eventsPath)

  const scopedSessions = await inspectSessions({
    client,
    options,
    index,
    sessionsDir: storage.sessionsDir,
    skippedAnalyzerSessions,
  })
  const eligibleSessions = scopedSessions.filter((item) => item.freshnessStatus !== "up_to_date")
  const sessions = options.batchSize !== null ? eligibleSessions.slice(0, options.batchSize) : eligibleSessions
  const totalEligibleSessions = eligibleSessions.length

  for (const item of scopedSessions) {
    if (item.freshnessStatus !== "up_to_date") {
      continue
    }

    skippedUpToDateSessions.push(item.session.id)
    if (item.existingSummary) {
      summaries.push(item.existingSummary)
    }
  }

  const LLM_WAIT_PROGRESS_DELAY_MS = 30_000

  const publishProgress = async (event: AnalyzeProgressUpdate) => {
    const counts = event.counts ?? currentProgressCounts({
      analyzedSessions,
      skippedUpToDateSessions,
      skippedAnalyzerSessions,
      failedSessions,
      totalEligibleSessions,
    })

    const snapshot: AnalyzeProgressSnapshot = {
      analyzerVersion: ANALYZER_VERSION,
      status: event.phase === "finished" ? "completed" : "running",
      phase: event.phase,
      runStartedAt: now,
      updatedAt: new Date().toISOString(),
      sessionId: event.sessionId ?? null,
      position: event.position ?? null,
      total: event.total ?? null,
      detail: event.message ?? null,
      counts,
      outputDirectory: storage.rootDir,
      options,
    }

    const progressEvent: AnalyzeProgressEvent = {
      ...snapshot,
      eventIndex: progressEventIndex,
    }

    await writeRunProgress(storage.progressPath, snapshot)
    await appendRunEvent(storage.eventsPath, progressEvent)
    progressEventIndex += 1
    await onProgress?.({ ...event, counts })
  }

  await logBestEffort(client, "info", "Session analyzer run started", {
    directory,
    sessionCount: sessions.length,
    totalEligibleSessions,
    options,
  })
  await publishProgress({
    phase: "started",
    total: totalEligibleSessions,
  })

  for (let sessionIndex = 0; sessionIndex < sessions.length; sessionIndex += 1) {
    await processSession({
      client,
      sessionItem: sessions[sessionIndex],
      index,
      options,
      analyzedAt: now,
      totalEligibleSessions,
      llmWaitProgressDelayMs: LLM_WAIT_PROGRESS_DELAY_MS,
      state: {
        analyzedSessions,
        skippedAnalyzerSessions,
        staleSessions,
        failedSessions,
        summaries,
      },
      publishProgress,
    })
  }

  const projectSummary = buildProjectSummary(summaries, now)
  const globalSummary = buildGlobalSummary(summaries, now)

  await writeProjectSummary(storage.projectSummaryPath, projectSummary)
  await writeGlobalSummary(storage.globalSummaryPath, globalSummary)
  index.lastRunAt = now
  await writeJsonFile(storage.indexPath, index)

  await logBestEffort(client, "info", "Session analyzer run finished", {
    directory,
    sessionCount: sessions.length,
    totalEligibleSessions,
    completedEligibleSessions: analyzedSessions.length,
    analyzedCount: analyzedSessions.length,
    skippedUpToDateCount: skippedUpToDateSessions.length,
    skippedAnalyzerSessionCount: skippedAnalyzerSessions.length,
    staleCount: staleSessions.length,
    failedCount: failedSessions.length,
    outputDirectory: storage.rootDir,
  })
  await publishProgress({
    phase: "finished",
    total: totalEligibleSessions,
  })

  const ruleSuggestionPrompt = await buildRuleSuggestionPrompt({
    client,
    directory,
    projectSummary,
    globalSummary,
    summaries,
    analyzedSessionCount: analyzedSessions.length,
    failedSessions,
  })

  return {
    outputDirectory: storage.rootDir,
    progressPath: storage.progressPath,
    eventsPath: storage.eventsPath,
    totalEligibleSessions,
    completedEligibleSessions: analyzedSessions.length,
    remainingEligibleSessions: Math.max(totalEligibleSessions - analyzedSessions.length, 0),
    analyzedSessions,
    skippedUpToDateSessions,
    skippedAnalyzerSessions,
    staleSessions,
    failedSessions,
    projectSummaryPath: storage.projectSummaryPath,
    globalSummaryPath: storage.globalSummaryPath,
    indexPath: storage.indexPath,
    ruleSuggestionPrompt,
  }
}

function currentProgressCounts(args: {
  analyzedSessions: string[]
  skippedUpToDateSessions: string[]
  skippedAnalyzerSessions: string[]
  failedSessions: AnalyzeFailure[]
  totalEligibleSessions: number
}): AnalyzeProgressCounts {
  const {
    analyzedSessions,
    skippedUpToDateSessions,
    skippedAnalyzerSessions,
    failedSessions,
    totalEligibleSessions,
  } = args

  return {
    analyzed: analyzedSessions.length,
    skippedUpToDate: skippedUpToDateSessions.length,
    skippedAnalyzer: skippedAnalyzerSessions.length,
    failed: failedSessions.length,
    completedEligible: analyzedSessions.length,
    totalEligible: totalEligibleSessions,
  }
}

interface RunState {
  analyzedSessions: string[]
  skippedAnalyzerSessions: string[]
  staleSessions: Array<{ sessionId: string; status: SessionSummary["freshnessStatus"] }>
  failedSessions: AnalyzeFailure[]
  summaries: SessionSummary[]
}

async function processSession(args: {
  client: any
  sessionItem: InspectedSession
  index: AnalysisIndex
  options: AnalyzeCommandOptions
  analyzedAt: string
  totalEligibleSessions: number
  llmWaitProgressDelayMs: number
  state: RunState
  publishProgress: (event: AnalyzeProgressUpdate) => Promise<void>
}): Promise<void> {
  const {
    client,
    sessionItem,
    index,
    options,
    analyzedAt,
    totalEligibleSessions,
    llmWaitProgressDelayMs,
    state,
    publishProgress,
  } = args
  const { session, summaryPath } = sessionItem

  try {
    await logBestEffort(client, "info", "Analyzing session", {
      sessionId: session.id,
      position: state.analyzedSessions.length + 1,
      total: totalEligibleSessions,
      projectPath: session.projectPath,
      updatedAt: session.updatedAt,
    })
    await publishProgress({
      phase: "session_started",
      sessionId: session.id,
      position: state.analyzedSessions.length + 1,
      total: totalEligibleSessions,
    })

    const rawMessages = await client.session.messages({ path: { id: session.id } })
    const messages = normalizeMessages(Array.isArray(rawMessages?.data) ? rawMessages.data : [])

    if (isAnalyzerControlSession(messages)) {
      state.skippedAnalyzerSessions.push(session.id)
      await logBestEffort(client, "info", "Skipped analyzer control session", {
        sessionId: session.id,
        position: state.analyzedSessions.length,
        total: totalEligibleSessions,
      })
      await publishProgress({
        phase: "session_skipped",
        sessionId: session.id,
        position: state.analyzedSessions.length,
        total: totalEligibleSessions,
        message: "control_session",
      })
      return
    }

    const entry = getIndexEntry(index, session.id)
    const freshnessStatus = evaluateFreshness({
      session,
      entry,
      messageCount: messages.length,
      force: options.force,
    })

    if (freshnessStatus === "up_to_date") {
      await logBestEffort(client, "info", "Skipped up-to-date session", {
        sessionId: session.id,
        position: state.analyzedSessions.length,
        total: totalEligibleSessions,
        messageCount: messages.length,
      })
      await publishProgress({
        phase: "session_skipped",
        sessionId: session.id,
        position: state.analyzedSessions.length,
        total: totalEligibleSessions,
        message: "up_to_date",
      })
      return
    }

    if (options.onlyStale && !isOnlyStaleEligible(freshnessStatus)) {
      await logBestEffort(client, "info", "Skipped non-stale session due to onlyStale", {
        sessionId: session.id,
        position: state.analyzedSessions.length,
        total: totalEligibleSessions,
        freshnessStatus,
      })
      await publishProgress({
        phase: "session_skipped",
        sessionId: session.id,
        position: state.analyzedSessions.length,
        total: totalEligibleSessions,
        message: "not_stale",
      })
      return
    }

    if (freshnessStatus !== "failed") {
      state.staleSessions.push({ sessionId: session.id, status: freshnessStatus })
    }

    const summary = await analyzeSessionWithLlm({
      client,
      session,
      entry,
      messages,
      freshnessStatus,
      analyzedAt,
      totalEligibleSessions,
      llmWaitProgressDelayMs,
      analyzedCount: state.analyzedSessions.length,
      publishProgress,
    })

    await writeSessionSummary(summaryPath, summary)
    state.summaries.push(summary)
    state.analyzedSessions.push(session.id)
    await logBestEffort(client, "info", "Session analysis completed", {
      sessionId: session.id,
      position: state.analyzedSessions.length,
      total: totalEligibleSessions,
      freshnessStatus,
      messageCount: messages.length,
    })
    await publishProgress({
      phase: "session_completed",
      sessionId: session.id,
      position: state.analyzedSessions.length,
      total: totalEligibleSessions,
      message: freshnessStatus,
    })
    updateIndexEntry({
      index,
      session,
      freshnessStatus,
      analyzedAt,
      messageCount: messages.length,
      summaryPath,
      error: null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const reason = classifyAnalyzeFailureReason(message)
    state.failedSessions.push({ sessionId: session.id, reason, error: message })
    await logBestEffort(client, "warn", "Session analysis failed", {
      sessionId: session.id,
      position: state.analyzedSessions.length + 1,
      total: totalEligibleSessions,
      reason,
      error: message,
    })
    await publishProgress({
      phase: "session_failed",
      sessionId: session.id,
      position: state.analyzedSessions.length + 1,
      total: totalEligibleSessions,
      message,
    })
    updateIndexEntry({
      index,
      session,
      freshnessStatus: "failed",
      analyzedAt,
      messageCount: 0,
      summaryPath,
      error: message,
    })
  }
}

async function analyzeSessionWithLlm(args: {
  client: any
  session: SessionCandidate
  entry: ReturnType<typeof getIndexEntry>
  messages: ReturnType<typeof normalizeMessages>
  freshnessStatus: SessionSummary["freshnessStatus"]
  analyzedAt: string
  totalEligibleSessions: number
  llmWaitProgressDelayMs: number
  analyzedCount: number
  publishProgress: (event: AnalyzeProgressUpdate) => Promise<void>
}): Promise<SessionSummary> {
  const {
    client,
    session,
    entry,
    messages,
    freshnessStatus,
    analyzedAt,
    totalEligibleSessions,
    llmWaitProgressDelayMs,
    analyzedCount,
    publishProgress,
  } = args
  const llmInput = buildSessionAnalysisInput({
    session,
    messages,
    indexEntry: entry,
    analyzedAt,
  })
  const waitStartedAt = Date.now()
  let llmWaitTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    void publishProgress({
      phase: "session_started",
      sessionId: session.id,
      position: analyzedCount + 1,
      total: totalEligibleSessions,
      message: `waiting_for_llm: 第 ${analyzedCount + 1}/${totalEligibleSessions} 个 session 已等待 ${Math.max(Math.floor((Date.now() - waitStartedAt) / 1000), 30)} 秒`,
    })
  }, llmWaitProgressDelayMs)

  let llm: Awaited<ReturnType<typeof generateSessionLlmResult>>
  try {
    llm = await generateSessionLlmResult({
      client,
      llmInput,
      generatedAt: analyzedAt,
    })
  } finally {
    if (llmWaitTimer) {
      clearTimeout(llmWaitTimer)
      llmWaitTimer = null
    }
  }

  return {
    sessionId: session.id,
    projectPath: session.projectPath,
    analyzedAt,
    sessionUpdatedAt: session.updatedAt,
    freshnessStatus,
    fullRange: llmInput.timeRanges.fullRange,
    deltaRange: llmInput.timeRanges.deltaRange,
    activeRange: llmInput.timeRanges.activeRange,
    validFrom: llmInput.timeRanges.activeRange.startAt ?? llmInput.timeRanges.fullRange.startAt,
    validTo: null,
    expires: null,
    totalPromptCount: llmInput.deterministicMetrics.totalPromptCount,
    newPromptCount: llmInput.deterministicMetrics.newPromptCount,
    avgPromptLength: llmInput.deterministicMetrics.avgPromptLength,
    totalCorrectionCount: llmInput.signals.correctionSignals.length,
    newCorrectionCount: llmInput.signals.correctionSignals.filter((signal) => signal.type === "new_correction").length,
    topFiles: llmInput.deterministicMetrics.topFiles,
    topDirectories: llmInput.deterministicMetrics.topDirectories,
    topCommands: llmInput.deterministicMetrics.topCommands,
    toolFailureCount: llmInput.deterministicMetrics.toolFailureCount,
    signals: llmInput.signals,
    llmInput,
    llm,
  }
}

function isAnalyzerControlSession(
  messages: Array<{ role: string; text: string; toolParts?: Array<{ toolName: string | null }> }>,
): boolean {
  for (const message of messages) {
    for (const toolPart of message.toolParts ?? []) {
      if (toolPart.toolName === "session_analyzer") {
        return true
      }
    }
  }

  const combinedUserText = messages
    .filter((message) => message.role === "user")
    .map((message) => message.text)
    .join("\n\n")
    .trim()

  if (!combinedUserText) {
    return false
  }

  if (/(^|\s)\/session-analyzer(\s|$)/i.test(combinedUserText)) {
    return true
  }

  return (
    combinedUserText.includes("Use the `session_analyzer` tool to analyze sessions for this workspace.") ||
    combinedUserText.includes("You are analyzing one OpenCode session.")
  )
}

function isOnlyStaleEligible(freshnessStatus: SessionSummary["freshnessStatus"]): boolean {
  return freshnessStatus === "stale_due_to_new_messages" ||
    freshnessStatus === "stale_due_to_session_update" ||
    freshnessStatus === "stale_due_to_analyzer_change"
}

interface InspectedSession {
  session: SessionCandidate
  freshnessStatus: SessionSummary["freshnessStatus"]
  summaryPath: string
  existingSummary: SessionSummary | null
}

async function inspectSessions(args: {
  client: any
  options: AnalyzeCommandOptions
  index: AnalysisIndex
  sessionsDir: string
  skippedAnalyzerSessions: string[]
}): Promise<InspectedSession[]> {
  const { client, options, index, sessionsDir, skippedAnalyzerSessions } = args
  const discoveredSessions = await discoverSessions(client, options)
  const inspectedSessions: InspectedSession[] = []

  for (const session of discoveredSessions) {
    const summaryPath = getSessionSummaryPath(sessionsDir, session.id)
    const rawMessages = await client.session.messages({ path: { id: session.id } })
    const messages = normalizeMessages(Array.isArray(rawMessages?.data) ? rawMessages.data : [])

    if (isAnalyzerControlSession(messages)) {
      skippedAnalyzerSessions.push(session.id)
      continue
    }

    const entry = getIndexEntry(index, session.id)
    const freshnessStatus = evaluateFreshness({
      session,
      entry,
      messageCount: messages.length,
      force: options.force,
    })

    if (options.onlyStale && !isOnlyStaleEligible(freshnessStatus)) {
      continue
    }

    const existingSummary = freshnessStatus === "up_to_date"
      ? await readJsonFile<SessionSummary | null>(summaryPath, null)
      : null

    inspectedSessions.push({
      session,
      freshnessStatus,
      summaryPath,
      existingSummary,
    })
  }

  return selectScopedSessions(inspectedSessions, options)
}

function selectScopedSessions(
  sessions: InspectedSession[],
  options: AnalyzeCommandOptions,
): InspectedSession[] {
  if (options.session) {
    return sessions
  }

  if (options.recent !== null) {
    return sessions.slice(-options.recent)
  }

  return sessions
}

function classifyAnalyzeFailureReason(message: string): AnalyzeFailureReason {
  if (/structured llm analysis input invalid/i.test(message)) {
    return "invalid_input"
  }

  if (/did not return info\.structured_output or info\.structured/i.test(message)) {
    return "structured_output_missing"
  }

  if (new RegExp(
    [
      "(llm|model|provider).*(unavailable|not available|disabled|offline)",
      "(unavailable|not available).*(llm|model|provider)",
      "rate limit",
      "timed out",
      "timeout",
      "network error",
      "connection error",
      "econn",
      "enotfound",
      "503",
      "429",
    ].join("|"),
    "i",
  ).test(message)) {
    return "llm_unavailable"
  }

  if (/structured llm analysis failed/i.test(message)) {
    return "analysis_request_failed"
  }

  return "unknown"
}

function buildProjectSummary(summaries: SessionSummary[], generatedAt: string): ProjectSummary {
  const projectSummaries = summaries
  const targetProjectPath = resolveDominantProjectPath(projectSummaries)
  const projectFindings = collectFindings(projectSummaries)
  const projectRecommendations = collectRecommendations(projectSummaries)

  return {
    projectPath: targetProjectPath,
    generatedAt,
    evidenceRange: buildEvidenceRange(projectSummaries),
    validFrom: minimumTime(projectSummaries.map((summary) => summary.validFrom)),
    validTo: null,
    sessionCount: projectSummaries.length,
    analyzedSessionCount: projectSummaries.length,
    taskCategoryDistribution: summarizeTaskCategories(projectSummaries),
    frequentFiles: mergeCounts(projectSummaries.flatMap((summary) => summary.topFiles)),
    frequentDirectories: mergeCounts(projectSummaries.flatMap((summary) => summary.topDirectories)),
    frequentCommands: mergeCounts(projectSummaries.flatMap((summary) => summary.topCommands)),
    correctionPatterns: mergeCounts(
      projectSummaries.flatMap((summary) =>
        summary.signals.correctionSignals.map((signal) => ({ value: signal.type, count: 1 })),
      ),
    ),
    activeFindings: projectFindings.slice(0, 5).map((finding) => finding.summary),
    suggestions: mergeTextValues(projectRecommendations.map((item) => item.summary), 10, buildSuggestions(projectSummaries)),
  }
}

function buildGlobalSummary(summaries: SessionSummary[], generatedAt: string): GlobalSummary {
  const projectPaths = new Set(summaries.map((summary) => summary.projectPath ?? "<unknown>"))
  const findings = collectFindings(summaries)
  const recommendations = collectRecommendations(summaries)

  return {
    generatedAt,
    evidenceRange: buildEvidenceRange(summaries),
    validFrom: minimumTime(summaries.map((summary) => summary.validFrom)),
    validTo: null,
    projectCount: projectPaths.size,
    sessionCount: summaries.length,
    commonTaskPatterns: mergeCounts(findings.map((finding) => ({ value: finding.scope, count: 1 }))),
    commonPromptHabits: [
      {
        value: summaries.some((summary) => summary.avgPromptLength > 300) ? "long_prompts" : "short_prompts",
        count: summaries.length,
      },
    ],
    commonWorkflowFriction: mergeCounts(
      summaries.flatMap((summary) => summary.signals.correctionSignals.map((signal) => ({ value: signal.type, count: 1 }))),
    ),
    suggestions: mergeTextValues(recommendations.map((item) => item.summary), 10, buildSuggestions(summaries)),
  }
}

function collectFindings(summaries: SessionSummary[]) {
  return summaries.flatMap((summary) => summary.llm.output.findings)
}

function collectRecommendations(summaries: SessionSummary[]) {
  return summaries.flatMap((summary) => [
    ...summary.llm.output.currentRecommendations,
    ...summary.llm.output.workflowSuggestions,
  ])
}

function buildEvidenceRange(summaries: SessionSummary[]): { startAt: string | null; endAt: string | null } {
  return {
    startAt: minimumTime(summaries.map((summary) => summary.fullRange.startAt)),
    endAt: maximumTime(summaries.map((summary) => summary.fullRange.endAt)),
  }
}

function mergeCounts(entries: Array<{ value: string; count: number }>): Array<{ value: string; count: number }> {
  const map = new Map<string, number>()

  for (const entry of entries) {
    map.set(entry.value, (map.get(entry.value) ?? 0) + entry.count)
  }

  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([value, count]) => ({ value, count }))
}

function summarizeTaskCategories(summaries: SessionSummary[]): Record<string, number> {
  const values = summaries.flatMap((summary) => inferTaskCategories(summary))
  return toDistributionRecord(values, summaries.length)
}

function inferTaskCategories(summary: SessionSummary): string[] {
  const categories = new Set<string>()
  const texts = [
    ...summary.llm.output.findings.map((finding) => finding.summary),
    ...summary.llm.output.currentRecommendations.map((recommendation) => recommendation.summary),
    ...summary.llm.output.workflowSuggestions.map((recommendation) => recommendation.summary),
  ]

  for (const text of texts) {
    const normalized = text.toLowerCase()
    if (/debug|bug|error|failure|fix/.test(normalized)) {
      categories.add("debug")
    }
    if (/feature|implement|build|add/.test(normalized)) {
      categories.add("feature")
    }
    if (/refactor|cleanup|restructure/.test(normalized)) {
      categories.add("refactor")
    }
    if (/review|audit|inspect/.test(normalized)) {
      categories.add("review")
    }
    if (/doc|readme|plan|write/.test(normalized)) {
      categories.add("docs")
    }
  }

  return categories.size > 0 ? [...categories] : ["unknown"]
}

function resolveDominantProjectPath(summaries: SessionSummary[]): string | null {
  if (summaries.length === 0) {
    return null
  }

  const counts = new Map<string | null, number>()
  for (const summary of summaries) {
    counts.set(summary.projectPath, (counts.get(summary.projectPath) ?? 0) + 1)
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null
}

function buildSuggestions(summaries: SessionSummary[]): string[] {
  const suggestions: string[] = []

  if (summaries.some((summary) => summary.newCorrectionCount >= 2)) {
    suggestions.push("当实现型请求容易进入反复修正时，先补一条简短的规划提示，再开始动手实现。")
  }

  if (summaries.some((summary) => summary.avgPromptLength > 400)) {
    suggestions.push("当提示词偏长时，更早明确目标文件和预期结果，减少来回确认。")
  }

  if (summaries.some((summary) => summary.toolFailureCount > 0)) {
    suggestions.push("如果某些命令因当前项目环境约束反复失败，把这些约束和正确验证方式写进项目规则。")
  }

  return suggestions.length > 0 ? suggestions : ["暂时没有高置信度的工作流建议。"]
}

async function buildRuleSuggestionPrompt(args: {
  client: any
  directory: string
  projectSummary: ProjectSummary
  globalSummary: GlobalSummary
  summaries: SessionSummary[]
  analyzedSessionCount: number
  failedSessions: AnalyzeFailure[]
}): Promise<RuleSuggestionPrompt | null> {
  const { client, directory, projectSummary, globalSummary, summaries, analyzedSessionCount, failedSessions } = args

  if (analyzedSessionCount === 0 || failedSessions.length > 0) {
    return null
  }

  const uncoveredDecisions = await collectUncoveredRuleDecisions({
    client,
    directory,
    projectSummary,
    globalSummary,
    summaries,
  })
  if (uncoveredDecisions.length === 0) {
    return null
  }

  return {
    targetSuggestions: uncoveredDecisions,
    promptText: buildRuleSuggestionPromptText(uncoveredDecisions),
    reasoning: {
      triggered: true,
      analyzedSessionCount,
      suggestionCount: uncoveredDecisions.length,
    },
  }
}

async function collectUncoveredRuleDecisions(args: {
  client: any
  directory: string
  projectSummary: ProjectSummary
  globalSummary: GlobalSummary
  summaries: SessionSummary[]
}): Promise<RuleCandidateDecision[]> {
  const { client, directory, projectSummary, globalSummary, summaries } = args
  const candidateTexts = pickRuleCandidateSuggestions(projectSummary, globalSummary)
  if (candidateTexts.length === 0) {
    return []
  }

  const [agentFiles, decisions] = await Promise.all([
    readAgentFiles(directory),
    classifyRuleCandidates({
      client,
      projectSummary,
      globalSummary,
      summaries,
      candidateTexts,
    }),
  ])

  return filterUncoveredRuleDecisions(decisions, agentFiles)
}

function filterUncoveredRuleDecisions(
  decisions: RuleCandidateDecision[],
  agentFiles: { projectAgentsText: string; globalAgentsText: string },
): RuleCandidateDecision[] {
  return decisions
    .map((decision) => applyCoverageToDecision(decision, agentFiles))
    .filter((decision) => !decision.alreadyCovered)
}

function buildRuleSuggestionPromptText(uncoveredDecisions: RuleCandidateDecision[]): string {
  return [
    "本次分析提炼出了可复用的工作建议：",
    "",
    "建议：",
    ...uncoveredDecisions.map((decision, index) => [
      `${index + 1}. ${decision.summary}`,
      `建议写入：${decision.recommendedScope === "project" ? "当前项目 AGENTS.md" : "全局 AGENTS.md"}`,
      `原因：${decision.reason}`,
    ].join("\n")),
    "",
    "如确认无误，我将按上述“建议写入”位置自动写入规则。",
  ].join("\n")
}

function pickRuleCandidateSuggestions(projectSummary: ProjectSummary, globalSummary: GlobalSummary): string[] {
  const candidates = mergeTextValues(
    [
      ...projectSummary.suggestions,
      ...globalSummary.suggestions,
    ],
    6,
    [],
  )

  return candidates
    .filter((suggestion) => isRuleCandidateSuggestion(suggestion))
    .slice(0, 3)
}

function isRuleCandidateSuggestion(suggestion: string): boolean {
  const normalized = suggestion.trim()
  if (!normalized) {
    return false
  }

  if (/^no high-confidence workflow suggestions yet\.?$/i.test(normalized) || /^暂时没有高置信度的工作流建议。?$/.test(normalized)) {
    return false
  }

  if (normalized.length < 24) {
    return false
  }

  const actionablePattern = /(consider|capture|add|make|prefer|avoid|verify|check|run|document|explicit|before|if they reflect|建议|优先|避免|验证|检查|运行|记录|写入|明确|同步更新|减少|补一条|开始动手)/i
  return actionablePattern.test(normalized)
}

async function classifyRuleCandidates(args: {
  client: any
  projectSummary: ProjectSummary
  globalSummary: GlobalSummary
  summaries: SessionSummary[]
  candidateTexts: string[]
}): Promise<RuleCandidateDecision[]> {
  const { client, projectSummary, globalSummary, summaries, candidateTexts } = args
  const evidenceLookup = buildRecommendationSummaryLookup(summaries)

  const decisions: RuleCandidateDecision[] = []
  for (const candidateText of candidateTexts) {
    const summary = evidenceLookup.get(candidateText)
    const decision = await classifyRuleCandidate({
      client,
      candidateText,
      projectSummary,
      globalSummary,
      summary,
    })
    if (decision && decision.confidence !== "low") {
      decisions.push(decision)
    }
  }

  return decisions
}

async function classifyRuleCandidate(args: {
  client: any
  candidateText: string
  projectSummary: ProjectSummary
  globalSummary: GlobalSummary
  summary: SessionSummary | undefined
}): Promise<RuleCandidateDecision | null> {
  const { client, candidateText, projectSummary, globalSummary, summary } = args
  const tempSession = await client.session.create({
    body: {
      title: "Session Analyzer Rule Candidate Classifier",
    },
  })
  const tempSessionId = tempSession?.data?.id
  if (!tempSessionId) {
    return deterministicRuleCandidateDecision(candidateText, summary)
  }

  const evidenceRefs = getRecommendationEvidenceRefs(summary, candidateText)
  const promptText = buildRuleCandidatePromptText({
    candidateText,
    projectSummary,
    globalSummary,
    evidenceRefs,
  })

  try {
    const response = await client.session.prompt({
      path: { id: tempSessionId },
      body: {
        noReply: false,
        parts: [{ type: "text", text: promptText }],
        format: {
          type: "json_schema",
          retryCount: 2,
          schema: ruleCandidateDecisionSchema,
        },
      },
    })

    const parsed = parseRuleCandidateDecisionResponse(response)

    if (!parsed.recommendedScope) {
      return null
    }

    return {
      summary: candidateText,
      recommendedScope: parsed.recommendedScope,
      confidence: parsed.confidence,
      reason: parsed.reason,
      evidenceRefs,
      alreadyCovered: false,
      matchedRuleText: null,
    }
  } catch {
    return deterministicRuleCandidateDecision(candidateText, summary)
  } finally {
    await client.session.delete({ path: { id: tempSessionId } }).catch(() => undefined)
  }
}

function deterministicRuleCandidateDecision(candidateText: string, summary: SessionSummary | undefined): RuleCandidateDecision | null {
  const normalized = candidateText.toLowerCase()
  const recommendedScope = /(project instructions|environment constraints|current codebase|repository|tsc|command|analyzer|current project)/i.test(normalized)
    ? "project"
    : /(cross-project|collaboration|evidence|workflow habit|general habit|global)/i.test(normalized)
      ? "global"
      : null

  if (!recommendedScope) {
    return null
  }

  const evidenceRefs = getRecommendationEvidenceRefs(summary, candidateText)

  return {
    summary: candidateText,
    recommendedScope,
    confidence: "medium",
    reason: recommendedScope === "project"
      ? "这条建议明显依赖当前仓库的命令、验证方式或本地约束，更适合写入当前项目规则。"
      : "这条建议更像可跨项目复用的通用协作习惯，更适合写入全局规则。",
    evidenceRefs,
    alreadyCovered: false,
    matchedRuleText: null,
  }
}

function buildRecommendationSummaryLookup(summaries: SessionSummary[]): Map<string, SessionSummary> {
  const evidenceLookup = new Map<string, SessionSummary>()

  for (const summary of summaries) {
    for (const recommendation of collectRecommendations([summary])) {
      evidenceLookup.set(recommendation.summary.trim(), summary)
    }
  }

  return evidenceLookup
}

function getRecommendationEvidenceRefs(summary: SessionSummary | undefined, candidateText: string): string[] {
  return summary
    ? collectRecommendations([summary]).find((item) => item.summary.trim() === candidateText)?.evidenceRefs ?? []
    : []
}

function buildRuleCandidatePromptText(args: {
  candidateText: string
  projectSummary: ProjectSummary
  globalSummary: GlobalSummary
  evidenceRefs: string[]
}): string {
  const { candidateText, projectSummary, globalSummary, evidenceRefs } = args

  return [
    "你正在判断一条工作建议更适合落为项目规则还是全局规则。",
    "只返回符合 schema 的结构化 JSON。",
    "如果建议明显依赖当前仓库、当前项目命令、当前验证方式、当前代码库约束，优先判定为 project。",
    "如果建议是可跨项目复用的协作习惯、证据质量习惯或通用工作方式，优先判定为 global。",
    "如果范围不清楚，使用 low confidence。",
    "reason 请用简体中文，直接说明为什么更适合 project 或 global，尽量替用户做判断，不要含糊。",
    "候选建议：",
    JSON.stringify({
      summary: candidateText,
      projectSummary,
      globalSummary,
      evidenceRefs,
    }, null, 2),
  ].join("\n\n")
}

const ruleCandidateDecisionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    recommendedScope: { type: "string", enum: ["project", "global", "unsure"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    reason: { type: "string" },
  },
  required: ["recommendedScope", "confidence", "reason"],
} as const

function parseRuleCandidateDecisionResponse(response: any): {
  recommendedScope: "project" | "global" | null
  confidence: "high" | "medium" | "low"
  reason: string
} {
  const structured = response?.data?.info?.structured_output ?? response?.data?.info?.structured
  const record = structured && typeof structured === "object" ? structured as Record<string, unknown> : null

  return {
    recommendedScope: record?.recommendedScope === "project" || record?.recommendedScope === "global"
      ? record.recommendedScope
      : null,
    confidence: record?.confidence === "high" || record?.confidence === "medium" || record?.confidence === "low"
      ? record.confidence
      : "low",
    reason: typeof record?.reason === "string" && record.reason.trim() ? record.reason.trim() : "适用范围不够明确。",
  }
}

async function readAgentFiles(directory: string): Promise<{ projectAgentsText: string; globalAgentsText: string }> {
  const projectAgentsPath = path.join(directory, "AGENTS.md")
  const globalAgentsPath = path.join(os.homedir(), ".config", "opencode", "AGENTS.md")

  const [projectAgentsText, globalAgentsText] = await Promise.all([
    readTextIfExists(projectAgentsPath),
    readTextIfExists(globalAgentsPath),
  ])

  return { projectAgentsText, globalAgentsText }
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch {
    return ""
  }
}

function applyCoverageToDecision(
  decision: RuleCandidateDecision,
  agentFiles: { projectAgentsText: string; globalAgentsText: string },
): RuleCandidateDecision {
  const targetText = decision.recommendedScope === "project"
    ? agentFiles.projectAgentsText
    : agentFiles.globalAgentsText
  const matchedRuleText = findCoveredRuleText(decision.summary, targetText)

  return {
    ...decision,
    alreadyCovered: matchedRuleText !== null,
    matchedRuleText,
  }
}

function findCoveredRuleText(candidateText: string, agentsText: string): string | null {
  const normalizedCandidate = normalizeRuleText(candidateText)
  if (!normalizedCandidate || !agentsText.trim()) {
    return null
  }

  const paragraphs = agentsText
    .split(/\r?\n\r?\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean)

  for (const paragraph of paragraphs) {
    const normalizedParagraph = normalizeRuleText(paragraph)
    if (!normalizedParagraph) {
      continue
    }

    if (normalizedParagraph.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedParagraph)) {
      return paragraph
    }

    const overlap = computeTokenOverlap(normalizedCandidate, normalizedParagraph)
    if (overlap >= 0.72) {
      return paragraph
    }
  }

  return null
}

function normalizeRuleText(text: string): string {
  return text
    .toLowerCase()
    .replace(/`+/g, " ")
    .replace(/[^a-z0-9\s\\./_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function computeTokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(left.split(" ").filter(Boolean))
  const rightTokens = new Set(right.split(" ").filter(Boolean))
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0
  }

  let intersection = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1
    }
  }

  return intersection / Math.max(leftTokens.size, rightTokens.size)
}

function mergeTextValues(values: string[], limit: number, fallback: string[]): string[] {
  const map = new Map<string, number>()

  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) {
      continue
    }
    map.set(trimmed, (map.get(trimmed) ?? 0) + 1)
  }

  const merged = [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value]) => value)

  return merged.length > 0 ? merged : fallback
}

function toDistributionRecord(values: string[], fallbackCount: number): Record<string, number> {
  const record: Record<string, number> = {}

  for (const value of values) {
    record[value] = (record[value] ?? 0) + 1
  }

  if (Object.keys(record).length === 0) {
    record.unknown = fallbackCount
  }

  return record
}

function minimumTime(values: Array<string | null>): string | null {
  const filtered = values.filter((value): value is string => Boolean(value))
  if (filtered.length === 0) {
    return null
  }

  return filtered.sort()[0]
}

function maximumTime(values: Array<string | null>): string | null {
  const filtered = values.filter((value): value is string => Boolean(value))
  if (filtered.length === 0) {
    return null
  }

  return filtered.sort().at(-1) ?? null
}
