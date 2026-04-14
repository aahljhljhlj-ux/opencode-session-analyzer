import type { AnalyzeCommandOptions, SessionCandidate } from "./types"
import { asRecord, asString, toIsoString } from "./utils"

export async function discoverSessions(client: any, options: AnalyzeCommandOptions): Promise<SessionCandidate[]> {
  const response = await client.session.list()
  const sessions: unknown[] = Array.isArray(response?.data) ? (response.data as unknown[]) : []

  const candidates = sessions
    .map(normalizeSessionCandidate)
    .filter((candidate: SessionCandidate | null): candidate is SessionCandidate => candidate !== null)
    .sort(compareByUpdatedAtAsc)

  return applyScope(candidates, options, client)
}

async function applyScope(
  candidates: SessionCandidate[],
  options: AnalyzeCommandOptions,
  client: any,
): Promise<SessionCandidate[]> {
  let scoped = candidates

  if (options.session) {
    scoped = scoped.filter(
      (candidate) => candidate.id === options.session || candidate.sessionPath === options.session,
    )
  }

  if (options.project) {
    const projectValue =
      options.project === "current"
        ? normalizeProjectPath((await client.project.current())?.data)
        : options.project

    scoped = scoped.filter((candidate: SessionCandidate) => candidate.projectPath === projectValue)
  }

  return scoped
}

function normalizeProjectPath(project: unknown): string | null {
  const record = asRecord(project)
  return asString(record.path) ?? asString(record.directory) ?? asString(record.root)
}

function normalizeSessionCandidate(session: unknown): SessionCandidate | null {
  const record = asRecord(session)
  const id = asString(record.id) ?? asString(record.sessionID)
  if (!id) {
    return null
  }

  const project = asRecord(record.project)
  const info = asRecord(record.info)

  return {
    id,
    title: asString(record.title) ?? asString(info.title) ?? undefined,
    projectPath:
      normalizeProjectPath(project) ?? asString(record.projectPath) ?? asString(info.projectPath) ?? null,
    sessionPath: asString(record.path) ?? asString(info.path) ?? null,
    createdAt: toIsoString(record.createdAt) ?? toIsoString(info.createdAt) ?? toIsoString(info.created),
    updatedAt: toIsoString(record.updatedAt) ?? toIsoString(info.updatedAt) ?? toIsoString(info.updated),
  }
}

function compareByUpdatedAtAsc(left: SessionCandidate, right: SessionCandidate): number {
  const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : 0
  const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : 0
  return leftTime - rightTime
}
