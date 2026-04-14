import { DEFAULT_PENDING_BATCH_SESSION_COUNT } from "./constants"
import type { AnalyzeCommandOptions } from "./types"

export function parseArguments(raw: string): AnalyzeCommandOptions {
  const tokens = tokenize(raw)
  const optionTokens = new Set(["--recent", "--project", "--session", "--force", "--only-stale"])
  let hasExplicitScope = false

  const result: AnalyzeCommandOptions = {
    batchSize: null,
    recent: null,
    project: null,
    session: null,
    force: false,
    onlyStale: false,
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]

    if (token === "--recent") {
      const next = tokens[index + 1]
      if (next && /^\d+$/.test(next)) {
        result.recent = Number.parseInt(next, 10)
        hasExplicitScope = true
        index += 1
      }
      continue
    }

    if (token === "--project") {
      const next = tokens[index + 1]
      if (next && !optionTokens.has(next)) {
        result.project = next
        index += 1
      } else {
        result.project = "current"
      }
      hasExplicitScope = true
      continue
    }

    if (token === "--session") {
      const next = tokens[index + 1]
      if (next) {
        result.session = next
        hasExplicitScope = true
        index += 1
      }
      continue
    }

    if (token === "--force") {
      result.force = true
      continue
    }

    if (token === "--only-stale") {
      result.onlyStale = true
    }
  }

  if (!hasExplicitScope) {
    result.project = "current"
    result.batchSize = DEFAULT_PENDING_BATCH_SESSION_COUNT
  }

  return result
}

function tokenize(raw: string): string[] {
  const matches = raw.match(/"[^"]*"|'[^']*'|\S+/g)
  if (!matches) {
    return []
  }

  return matches.map((token) => token.replace(/^['"]|['"]$/g, ""))
}
