import { promises as fs } from "node:fs"
import path from "node:path"
import {
  ANALYSIS_DIRECTORY_NAME,
  GLOBAL_SUMMARY_FILE_NAME,
  INDEX_FILE_NAME,
  PROJECT_SUMMARY_FILE_NAME,
  RUN_EVENTS_FILE_NAME,
  RUN_PROGRESS_FILE_NAME,
  SESSIONS_DIRECTORY_NAME,
} from "./constants"
import type { AnalysisIndex, AnalyzeProgressEvent, AnalyzeProgressSnapshot, GlobalSummary, ProjectSummary, SessionSummary } from "./types"

export interface StorageLayout {
  rootDir: string
  sessionsDir: string
  indexPath: string
  projectSummaryPath: string
  globalSummaryPath: string
  progressPath: string
  eventsPath: string
}

export async function ensureStorageLayout(baseDirectory: string): Promise<StorageLayout> {
  const opencodeDir = path.join(baseDirectory, ".opencode")
  const rootDir = path.join(opencodeDir, ANALYSIS_DIRECTORY_NAME)
  const sessionsDir = path.join(rootDir, SESSIONS_DIRECTORY_NAME)

  await fs.mkdir(sessionsDir, { recursive: true })

  return {
    rootDir,
    sessionsDir,
    indexPath: path.join(rootDir, INDEX_FILE_NAME),
    projectSummaryPath: path.join(rootDir, PROJECT_SUMMARY_FILE_NAME),
    globalSummaryPath: path.join(rootDir, GLOBAL_SUMMARY_FILE_NAME),
    progressPath: path.join(rootDir, RUN_PROGRESS_FILE_NAME),
    eventsPath: path.join(rootDir, RUN_EVENTS_FILE_NAME),
  }
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, "utf8")
    return JSON.parse(content) as T
  } catch {
    return fallback
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

export function emptyIndex(analyzerVersion: string): AnalysisIndex {
  return {
    analyzerVersion,
    lastRunAt: null,
    sessions: {},
  }
}

export function getSessionSummaryPath(sessionsDir: string, sessionId: string): string {
  return path.join(sessionsDir, `${sessionId}.json`)
}

export async function writeSessionSummary(filePath: string, summary: SessionSummary): Promise<void> {
  await writeJsonFile(filePath, summary)
}

export async function writeProjectSummary(filePath: string, summary: ProjectSummary): Promise<void> {
  await writeJsonFile(filePath, summary)
}

export async function writeGlobalSummary(filePath: string, summary: GlobalSummary): Promise<void> {
  await writeJsonFile(filePath, summary)
}

export async function writeRunProgress(filePath: string, snapshot: AnalyzeProgressSnapshot): Promise<void> {
  await writeJsonFile(filePath, snapshot)
}

export async function resetRunEvents(filePath: string): Promise<void> {
  await fs.writeFile(filePath, "", "utf8")
}

export async function appendRunEvent(filePath: string, event: AnalyzeProgressEvent): Promise<void> {
  await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8")
}
