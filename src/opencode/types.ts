export type SessionFreshnessStatus =
  | "never_analyzed"
  | "up_to_date"
  | "stale_due_to_new_messages"
  | "stale_due_to_session_update"
  | "stale_due_to_analyzer_change"
  | "failed"

export interface SessionCandidate {
  id: string
  title?: string
  projectPath: string | null
  sessionPath: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface AnalysisIndexEntry {
  sessionId: string
  sessionPath: string | null
  projectPath: string | null
  status: SessionFreshnessStatus
  lastAnalyzedAt: string | null
  lastSeenUpdatedAt: string | null
  lastSeenMessageCount: number
  lastAnalyzedMessageIndex: number | null
  analyzerVersion: string
  summaryPath: string | null
  error: string | null
}

export interface AnalysisIndex {
  analyzerVersion: string
  lastRunAt: string | null
  sessions: Record<string, AnalysisIndexEntry>
}

export interface NormalizedTextPart {
  type: "text"
  text: string
  synthetic: boolean
}

export interface NormalizedFilePart {
  type: "file"
  path: string | null
  filename: string | null
  url: string | null
}

export interface NormalizedToolPart {
  type: "tool"
  toolName: string | null
  state: string | null
  isError: boolean
  summary: string | null
}

export interface NormalizedMessage {
  messageId: string
  messageIndex: number
  role: string
  timestamp: string | null
  text: string
  hasUsableText: boolean
  textParts: NormalizedTextPart[]
  fileParts: NormalizedFilePart[]
  toolParts: NormalizedToolPart[]
}

export interface RangeBoundary {
  startMessageIndex: number | null
  endMessageIndex: number | null
  startMessageId: string | null
  endMessageId: string | null
  startAt: string | null
  endAt: string | null
}

export interface DeterministicMetrics {
  totalPromptCount: number
  newPromptCount: number
  avgPromptLength: number
  toolFailureCount: number
  topFiles: Array<{ value: string; count: number }>
  topDirectories: Array<{ value: string; count: number }>
  topCommands: Array<{ value: string; count: number }>
}

export interface SignalEntry {
  type: string
  messageId: string
  messageIndex: number
  timestamp: string | null
  text: string
}

export interface SessionSignals {
  correctionSignals: SignalEntry[]
  directionChangeSignals: SignalEntry[]
}

export interface EvidenceSnippet {
  messageId: string
  messageIndex: number
  role: string
  timestamp: string | null
  rangeType: "delta" | "active" | "full"
  text: string
}

export interface SessionMeta {
  sessionId: string
  projectPath: string | null
  createdAt: string | null
  updatedAt: string | null
  analyzedAt: string
  analyzerVersion: string
}

export interface SessionAnalysisInput {
  sessionMeta: SessionMeta
  timeRanges: {
    fullRange: RangeBoundary
    deltaRange: RangeBoundary
    activeRange: RangeBoundary
  }
  deterministicMetrics: DeterministicMetrics
  signals: SessionSignals
  evidenceSnippets: EvidenceSnippet[]
  analysisGoal: string
}

export interface SessionFinding {
  id: string
  scope: "session" | "project" | "global"
  summary: string
  observedAt: string | null
  validFrom: string | null
  validTo: string | null
  evidenceRefs: string[]
}

export interface SessionRecommendation {
  summary: string
  scope: "session" | "project" | "global"
  validFrom: string | null
  validTo: string | null
  evidenceRefs: string[]
}

export interface SessionLlmOutput {
  findings: SessionFinding[]
  currentRecommendations: SessionRecommendation[]
  workflowSuggestions: SessionRecommendation[]
}

export interface SessionLlmResult {
  // Note: older persisted summaries may still contain "no_llm".
  mode: "llm" | "no_llm"
  generatedAt: string
  output: SessionLlmOutput
}

export interface SessionSummary {
  sessionId: string
  projectPath: string | null
  analyzedAt: string
  sessionUpdatedAt: string | null
  freshnessStatus: SessionFreshnessStatus
  fullRange: RangeBoundary
  deltaRange: RangeBoundary
  activeRange: RangeBoundary
  validFrom: string | null
  validTo: string | null
  expires: string | null
  totalPromptCount: number
  newPromptCount: number
  avgPromptLength: number
  totalCorrectionCount: number
  newCorrectionCount: number
  topFiles: Array<{ value: string; count: number }>
  topDirectories: Array<{ value: string; count: number }>
  topCommands: Array<{ value: string; count: number }>
  toolFailureCount: number
  signals: SessionSignals
  llmInput: SessionAnalysisInput
  llm: SessionLlmResult
}

export interface ProjectSummary {
  projectPath: string | null
  generatedAt: string
  evidenceRange: {
    startAt: string | null
    endAt: string | null
  }
  validFrom: string | null
  validTo: string | null
  sessionCount: number
  analyzedSessionCount: number
  taskCategoryDistribution: Record<string, number>
  frequentFiles: Array<{ value: string; count: number }>
  frequentDirectories: Array<{ value: string; count: number }>
  frequentCommands: Array<{ value: string; count: number }>
  correctionPatterns: Array<{ value: string; count: number }>
  activeFindings: string[]
  suggestions: string[]
  ruleSuggestions: RuleSuggestionArtifact[]
}

export interface GlobalSummary {
  generatedAt: string
  evidenceRange: {
    startAt: string | null
    endAt: string | null
  }
  validFrom: string | null
  validTo: string | null
  projectCount: number
  sessionCount: number
  commonTaskPatterns: Array<{ value: string; count: number }>
  commonPromptHabits: Array<{ value: string; count: number }>
  commonWorkflowFriction: Array<{ value: string; count: number }>
  suggestions: string[]
  ruleSuggestions: RuleSuggestionArtifact[]
}

export interface RuleSuggestionArtifact {
  summary: string
  recommendedScope: "project" | "global"
  confidence: "high" | "medium" | "low"
  reason: string
  evidenceRefs: string[]
  suggestionValidFrom: string | null
  suggestionValidTo: string | null
  conflictScope: "project" | "global" | null
  conflictReason: string | null
  conflictingRuleText: string | null
}

export interface AnalyzeCommandOptions {
  batchSize: number | null
  recent: number | null
  project: string | null
  session: string | null
  force: boolean
  onlyStale: boolean
}

export type AnalyzeFailureReason =
  | "llm_unavailable"
  | "invalid_input"
  | "structured_output_missing"
  | "analysis_request_failed"
  | "unknown"

export interface AnalyzeFailure {
  sessionId: string
  reason: AnalyzeFailureReason
  error: string
}

export interface AnalyzeProgressSnapshot {
  analyzerVersion: string
  status: "running" | "completed"
  phase: AnalyzeProgressPhase
  runStartedAt: string
  updatedAt: string
  sessionId: string | null
  position: number | null
  total: number | null
  detail: string | null
  counts: AnalyzeProgressCounts
  outputDirectory: string
  options: AnalyzeCommandOptions
}

export interface AnalyzeProgressEvent extends AnalyzeProgressSnapshot {
  eventIndex: number
}

export type AnalyzeProgressPhase =
  | "started"
  | "session_started"
  | "session_skipped"
  | "session_completed"
  | "session_failed"
  | "finished"

export interface AnalyzeProgressCounts {
  analyzed: number
  skippedUpToDate: number
  skippedAnalyzer: number
  failed: number
  completedEligible: number
  totalEligible: number
}

export interface AnalyzeProgressUpdate {
  phase: AnalyzeProgressPhase
  sessionId?: string
  position?: number
  total?: number
  message?: string
  counts?: AnalyzeProgressCounts
}

export interface AnalyzeRunResult {
  outputDirectory: string
  progressPath: string
  eventsPath: string
   totalEligibleSessions: number
   completedEligibleSessions: number
   remainingEligibleSessions: number
  analyzedSessions: string[]
  skippedUpToDateSessions: string[]
  skippedAnalyzerSessions: string[]
  staleSessions: Array<{ sessionId: string; status: SessionFreshnessStatus }>
  failedSessions: AnalyzeFailure[]
  projectSummaryPath: string
  globalSummaryPath: string
  indexPath: string
  ruleSuggestionPrompt: RuleSuggestionPrompt | null
}

export interface RuleCandidateDecision {
  summary: string
  recommendedScope: "project" | "global"
  confidence: "high" | "medium" | "low"
  reason: string
  evidenceRefs: string[]
  suggestionValidFrom: string | null
  suggestionValidTo: string | null
  alreadyCovered: boolean
  matchedRuleText: string | null
  conflictScope: "project" | "global" | null
  conflictReason: string | null
  conflictingRuleText: string | null
}

export interface RuleSuggestionPrompt {
  targetSuggestions: RuleCandidateDecision[]
  promptText: string
  reasoning: {
    triggered: true
    analyzedSessionCount: number
    suggestionCount: number
  }
}
