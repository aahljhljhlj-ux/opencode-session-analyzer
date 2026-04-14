import type { SessionAnalysisInput, SessionFinding, SessionLlmOutput, SessionLlmResult, SessionRecommendation } from "./types"
import { logBestEffort } from "./logging"

export async function generateSessionLlmResult(args: {
  client: any
  llmInput: SessionAnalysisInput
  generatedAt: string
}): Promise<SessionLlmResult> {
  const { client, llmInput, generatedAt } = args

  const validationError = validateSessionAnalysisInput(llmInput)
  if (validationError) {
    await logLlmFailure(client, {
      sessionId: llmInput.sessionMeta.sessionId,
      reason: "Skipped structured LLM analysis due to invalid input",
      diagnostics: validationError,
    })
    throw new Error(`Structured LLM analysis input invalid: ${validationError}`)
  }

  try {
    const tempSession = await client.session.create({
      body: {
        title: `Session Analyzer ${llmInput.sessionMeta.sessionId}`,
      },
    })
    const tempSessionId = tempSession?.data?.id
    if (!tempSessionId) {
      throw new Error("Failed to create temporary analysis session")
    }

    const promptText = [
      "You are analyzing one OpenCode session.",
      "Return only structured JSON that matches the schema.",
      "Use only evidenceRefs from the provided evidenceSnippets messageId values.",
      "Focus on current active work, repeated friction, and useful next-step recommendations.",
      "If evidence is weak, return fewer findings instead of inventing them.",
      "Session input JSON:",
      JSON.stringify(llmInput, null, 2),
    ].join("\n\n")

    try {
      const response = await client.session.prompt({
        path: { id: tempSessionId },
        body: {
          noReply: false,
          parts: [{ type: "text", text: promptText }],
          format: {
            type: "json_schema",
            retryCount: 2,
            schema: sessionLlmOutputSchema,
          },
        },
      })

      const structured = response?.data?.info?.structured_output ?? response?.data?.info?.structured
      if (!structured) {
        const diagnostics = summarizePromptResponse(response)
        await logLlmFailure(client, {
          sessionId: llmInput.sessionMeta.sessionId,
          reason: "Missing structured response in session.prompt response",
          diagnostics,
        })
        throw new Error(
          `Structured LLM analysis did not return info.structured_output or info.structured (${diagnostics})`,
        )
      }

      const normalized = normalizeLlmOutput(structured, llmInput)

      return {
        mode: "llm",
        generatedAt,
        output: normalized,
      }
    } finally {
      await client.session.delete({ path: { id: tempSessionId } }).catch(() => undefined)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await logLlmFailure(client, {
      sessionId: llmInput.sessionMeta.sessionId,
      reason: "Structured LLM analysis request failed",
      diagnostics: message,
    })
    throw new Error(`Structured LLM analysis failed: ${message}`)
  }
}

function validateSessionAnalysisInput(llmInput: SessionAnalysisInput): string | null {
  if (!llmInput.sessionMeta.sessionId?.trim()) {
    return "sessionMeta.sessionId is required"
  }

  if (llmInput.evidenceSnippets.length === 0) {
    return "evidenceSnippets must contain at least one usable message"
  }

  const hasAnyRange = [
    llmInput.timeRanges.fullRange,
    llmInput.timeRanges.deltaRange,
    llmInput.timeRanges.activeRange,
  ].some((range) => range.startMessageId !== null && range.endMessageId !== null)

  if (!hasAnyRange) {
    return "at least one time range must contain messages"
  }

  return null
}

async function logLlmFailure(
  client: any,
  args: { sessionId: string; reason: string; diagnostics: string },
): Promise<void> {
  const { sessionId, reason, diagnostics } = args

  await logBestEffort(client, "warn", reason, {
    sessionId,
    diagnostics,
  })
}

function summarizePromptResponse(response: unknown): string {
  if (!response || typeof response !== "object") {
    return "response_type=empty"
  }

  const root = response as Record<string, unknown>
  const data = asRecord(root.data)
  const info = asRecord(data.info)
  const message = asRecord(data.message)
  const parts = Array.isArray(message.parts) ? (message.parts as unknown[]) : []

  const diagnostics = [
    `root_keys=${summarizeKeys(root)}`,
    `data_keys=${summarizeKeys(data)}`,
    `info_keys=${summarizeKeys(info)}`,
    `has_structured_output=${String("structured_output" in info && info.structured_output != null)}`,
    `has_structured=${String("structured" in info && info.structured != null)}`,
    `message_parts=${parts.length}`,
  ]

  const textPreview = extractTextPreview(parts)
  if (textPreview) {
    diagnostics.push(`message_text_preview=${JSON.stringify(textPreview)}`)
  }

  return diagnostics.join(", ")
}

function summarizeKeys(record: Record<string, unknown>): string {
  const keys = Object.keys(record).sort()
  return keys.length > 0 ? keys.join("|") : "none"
}

function extractTextPreview(parts: unknown[]): string | null {
  for (const part of parts) {
    const record = asRecord(part)
    if (record.type !== "text") {
      continue
    }

    const text = typeof record.text === "string" ? record.text.trim() : ""
    if (!text) {
      continue
    }

    return text.length <= 160 ? text : `${text.slice(0, 157)}...`
  }

  return null
}

const sessionLlmOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", description: "Stable-ish finding id for this session analysis run" },
          scope: { type: "string", enum: ["session", "project", "global"] },
          summary: { type: "string", description: "Concise observation grounded in evidence" },
          observedAt: { type: ["string", "null"] },
          validFrom: { type: ["string", "null"] },
          validTo: { type: ["string", "null"] },
          evidenceRefs: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["id", "scope", "summary", "observedAt", "validFrom", "validTo", "evidenceRefs"],
      },
    },
    currentRecommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          summary: { type: "string" },
          scope: { type: "string", enum: ["session", "project", "global"] },
          validFrom: { type: ["string", "null"] },
          validTo: { type: ["string", "null"] },
          evidenceRefs: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["summary", "scope", "validFrom", "validTo", "evidenceRefs"],
      },
    },
    workflowSuggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          summary: { type: "string" },
          scope: { type: "string", enum: ["session", "project", "global"] },
          validFrom: { type: ["string", "null"] },
          validTo: { type: ["string", "null"] },
          evidenceRefs: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["summary", "scope", "validFrom", "validTo", "evidenceRefs"],
      },
    },
  },
  required: ["findings", "currentRecommendations", "workflowSuggestions"],
} as const

function normalizeLlmOutput(value: unknown, llmInput: SessionAnalysisInput): SessionLlmOutput {
  if (!value || typeof value !== "object") {
    throw new Error("Structured LLM output was not an object")
  }

  const record = value as Record<string, unknown>
  if (!Array.isArray(record.findings) || !Array.isArray(record.currentRecommendations) || !Array.isArray(record.workflowSuggestions)) {
    throw new Error("Structured LLM output did not match the expected top-level arrays")
  }

  return {
    findings: normalizeFindings(record.findings, llmInput),
    currentRecommendations: normalizeRecommendations(record.currentRecommendations, llmInput),
    workflowSuggestions: normalizeRecommendations(record.workflowSuggestions, llmInput),
  }
}

function normalizeFindings(value: unknown, llmInput: SessionAnalysisInput): SessionFinding[] {
  const items = value as unknown[]

  return items
    .map((item, index) => normalizeFinding(item, llmInput, index))
    .filter((item): item is SessionFinding => item !== null)
}

function normalizeFinding(item: unknown, llmInput: SessionAnalysisInput, index: number): SessionFinding | null {
  if (!item || typeof item !== "object") {
    return null
  }

  const record = item as Record<string, unknown>
  const summary = typeof record.summary === "string" ? record.summary.trim() : ""
  if (!summary) {
    return null
  }

  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id : `finding-${index + 1}`,
    scope: record.scope === "project" || record.scope === "global" ? record.scope : "session",
    summary,
    observedAt: typeof record.observedAt === "string" ? record.observedAt : llmInput.timeRanges.activeRange.endAt,
    validFrom: typeof record.validFrom === "string" ? record.validFrom : llmInput.timeRanges.activeRange.startAt,
    validTo: typeof record.validTo === "string" ? record.validTo : null,
    evidenceRefs: normalizeEvidenceRefs(record.evidenceRefs, llmInput),
  }
}

function normalizeRecommendations(value: unknown, llmInput: SessionAnalysisInput): SessionRecommendation[] {
  const items = value as unknown[]

  return items
    .map((item) => normalizeRecommendation(item, llmInput))
    .filter((item): item is SessionRecommendation => item !== null)
}

function normalizeRecommendation(item: unknown, llmInput: SessionAnalysisInput): SessionRecommendation | null {
  if (!item || typeof item !== "object") {
    return null
  }

  const record = item as Record<string, unknown>
  const summary = typeof record.summary === "string" ? record.summary.trim() : ""
  if (!summary) {
    return null
  }

  return {
    summary,
    scope: record.scope === "project" || record.scope === "global" ? record.scope : "session",
    validFrom: typeof record.validFrom === "string" ? record.validFrom : llmInput.timeRanges.activeRange.startAt,
    validTo: typeof record.validTo === "string" ? record.validTo : null,
    evidenceRefs: normalizeEvidenceRefs(record.evidenceRefs, llmInput),
  }
}

function normalizeEvidenceRefs(value: unknown, llmInput: SessionAnalysisInput): string[] {
  const allowed = new Set(llmInput.evidenceSnippets.map((snippet) => snippet.messageId))
  const refs = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  const valid = refs.filter((item) => allowed.has(item))
  if (valid.length > 0) {
    return valid
  }

  return llmInput.evidenceSnippets.slice(0, 2).map((snippet) => snippet.messageId)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}
