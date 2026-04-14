import { ANALYZER_VERSION } from "./constants"
import type { AnalysisIndex, AnalysisIndexEntry, SessionCandidate, SessionFreshnessStatus } from "./types"

export function getIndexEntry(index: AnalysisIndex, sessionId: string): AnalysisIndexEntry | null {
  return index.sessions[sessionId] ?? null
}

export function evaluateFreshness(args: {
  session: SessionCandidate
  entry: AnalysisIndexEntry | null
  messageCount: number
  force: boolean
}): SessionFreshnessStatus {
  const { session, entry, messageCount, force } = args

  if (force) {
    return entry ? "stale_due_to_session_update" : "never_analyzed"
  }

  if (!entry) {
    return "never_analyzed"
  }

  if (entry.status === "failed") {
    return "failed"
  }

  if (entry.analyzerVersion !== ANALYZER_VERSION) {
    return "stale_due_to_analyzer_change"
  }

  if (messageCount > entry.lastSeenMessageCount) {
    return "stale_due_to_new_messages"
  }

  const sessionUpdatedAt = session.updatedAt ? Date.parse(session.updatedAt) : 0
  const seenUpdatedAt = entry.lastSeenUpdatedAt ? Date.parse(entry.lastSeenUpdatedAt) : 0

  if (sessionUpdatedAt > seenUpdatedAt) {
    return "stale_due_to_session_update"
  }

  return "up_to_date"
}

export function updateIndexEntry(args: {
  index: AnalysisIndex
  session: SessionCandidate
  freshnessStatus: SessionFreshnessStatus
  analyzedAt: string
  messageCount: number
  summaryPath: string
  error: string | null
}): void {
  const { index, session, freshnessStatus, analyzedAt, messageCount, summaryPath, error } = args

  index.sessions[session.id] = {
    sessionId: session.id,
    sessionPath: session.sessionPath,
    projectPath: session.projectPath,
    // Index status reflects the current freshness after this run.
    status: error ? "failed" : "up_to_date",
    lastAnalyzedAt: analyzedAt,
    lastSeenUpdatedAt: session.updatedAt,
    lastSeenMessageCount: messageCount,
    lastAnalyzedMessageIndex: messageCount > 0 ? messageCount - 1 : null,
    analyzerVersion: ANALYZER_VERSION,
    summaryPath,
    error,
  }
}
