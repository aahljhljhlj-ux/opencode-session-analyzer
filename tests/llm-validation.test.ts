import { describe, expect, it, vi } from "vitest"
import { generateSessionLlmResult } from "../src/opencode/llm"

function makeClient() {
  return {
    app: { log: vi.fn(async () => undefined) },
    session: {
      create: vi.fn(async () => ({ data: { id: "temp-session" } })),
      prompt: vi.fn(async () => ({ data: { info: { structured_output: { findings: [], currentRecommendations: [], workflowSuggestions: [] } } } })),
      delete: vi.fn(async () => undefined),
    },
  }
}

describe("generateSessionLlmResult input validation", () => {
  it("does not call client.session.prompt when evidenceSnippets is empty", async () => {
    const client = makeClient()

    await expect(
      generateSessionLlmResult({
        client,
        generatedAt: new Date().toISOString(),
        llmInput: {
          sessionMeta: {
            sessionId: "s-1",
            projectPath: null,
            createdAt: null,
            updatedAt: null,
            analyzedAt: new Date().toISOString(),
            analyzerVersion: "test",
          },
          timeRanges: {
            fullRange: {
              startMessageIndex: null,
              endMessageIndex: null,
              startMessageId: null,
              endMessageId: null,
              startAt: null,
              endAt: null,
            },
            deltaRange: {
              startMessageIndex: null,
              endMessageIndex: null,
              startMessageId: null,
              endMessageId: null,
              startAt: null,
              endAt: null,
            },
            activeRange: {
              startMessageIndex: null,
              endMessageIndex: null,
              startMessageId: null,
              endMessageId: null,
              startAt: null,
              endAt: null,
            },
          },
          deterministicMetrics: {
            totalPromptCount: 0,
            newPromptCount: 0,
            avgPromptLength: 0,
            toolFailureCount: 0,
            topFiles: [],
            topDirectories: [],
            topCommands: [],
          },
          signals: {
            correctionSignals: [],
            directionChangeSignals: [],
          },
          evidenceSnippets: [],
          analysisGoal: "test",
        },
      }),
    ).rejects.toThrow(/input invalid/i)

    expect(client.session.create).not.toHaveBeenCalled()
    expect(client.session.prompt).not.toHaveBeenCalled()
  })

  it("accepts structured responses returned as info.structured", async () => {
    const client = makeClient()
    client.session.prompt.mockResolvedValueOnce({
      data: {
        info: {
          structured: {
            findings: [],
            currentRecommendations: [],
            workflowSuggestions: [],
          },
        },
      },
    })

    const result = await generateSessionLlmResult({
      client,
      generatedAt: new Date().toISOString(),
      llmInput: {
        sessionMeta: {
          sessionId: "s-2",
          projectPath: null,
          createdAt: null,
          updatedAt: null,
          analyzedAt: new Date().toISOString(),
          analyzerVersion: "test",
        },
        timeRanges: {
          fullRange: {
            startMessageIndex: 0,
            endMessageIndex: 0,
            startMessageId: "m1",
            endMessageId: "m1",
            startAt: new Date().toISOString(),
            endAt: new Date().toISOString(),
          },
          deltaRange: {
            startMessageIndex: 0,
            endMessageIndex: 0,
            startMessageId: "m1",
            endMessageId: "m1",
            startAt: new Date().toISOString(),
            endAt: new Date().toISOString(),
          },
          activeRange: {
            startMessageIndex: 0,
            endMessageIndex: 0,
            startMessageId: "m1",
            endMessageId: "m1",
            startAt: new Date().toISOString(),
            endAt: new Date().toISOString(),
          },
        },
        deterministicMetrics: {
          totalPromptCount: 1,
          newPromptCount: 1,
          avgPromptLength: 10,
          toolFailureCount: 0,
          topFiles: [],
          topDirectories: [],
          topCommands: [],
        },
        signals: {
          correctionSignals: [],
          directionChangeSignals: [],
        },
        evidenceSnippets: [
          {
            messageId: "m1",
            messageIndex: 0,
            role: "user",
            timestamp: new Date().toISOString(),
            rangeType: "active",
            text: "analyze this",
          },
        ],
        analysisGoal: "test",
      },
    })

    expect(result.mode).toBe("llm")
    expect(client.session.create).toHaveBeenCalledTimes(1)
    expect(client.session.prompt).toHaveBeenCalledTimes(1)
    expect(client.session.delete).toHaveBeenCalledTimes(1)
  })
})
