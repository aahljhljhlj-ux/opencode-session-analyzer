import { describe, expect, it, vi } from "vitest"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { runSessionAnalyzer } from "../src/opencode/analyze"
import { ANALYZER_VERSION, DEFAULT_PROJECT_BATCH_SESSION_COUNT } from "../src/opencode/constants"
import { parseArguments } from "../src/opencode/args"

function iso(time: number) {
  return new Date(time).toISOString()
}

function makeClient(args: {
  sessions: Array<{ id: string; updatedAt: string; title?: string; projectPath?: string | null }>
  messagesBySession: Record<string, unknown[]>
  structuredOutput?: unknown
}) {
  const structuredOutput =
    args.structuredOutput ?? ({ findings: [], currentRecommendations: [], workflowSuggestions: [] } as const)

  const client = {
    app: {
      log: vi.fn(async () => undefined),
    },
    project: {
      current: vi.fn(async () => ({ data: { path: "D:/proj" } })),
    },
    session: {
      list: vi.fn(async () => ({ data: args.sessions })),
      messages: vi.fn(async ({ path }: any) => ({ data: args.messagesBySession[path.id] ?? [] })),
      create: vi.fn(async () => ({ data: { id: "tmp" } })),
      prompt: vi.fn(async () => ({ data: { info: { structured_output: structuredOutput } } })),
      delete: vi.fn(async () => undefined),
    },
  }

  return client
}

describe("runSessionAnalyzer core flow", () => {
  it("parses bare --project as current project with the larger batch limit", () => {
    expect(parseArguments("--project")).toEqual({
      recent: DEFAULT_PROJECT_BATCH_SESSION_COUNT,
      project: "current",
      session: null,
      force: false,
      onlyStale: false,
    })
  })

  it("marks analyzed session up_to_date and skips re-sending on second run", async () => {
    const sessionId = "s-1"
    const t0 = Date.now() - 1000
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "session-analyzer-"))
    const client = makeClient({
      sessions: [{ id: sessionId, updatedAt: iso(t0), projectPath: "D:/proj" }],
      messagesBySession: {
        [sessionId]: [
          {
            info: { id: "m1", role: "user", time: { created: iso(t0) } },
            parts: [{ type: "text", text: "analyze this" }],
          },
        ],
      },
    })
    try {
      const first = await runSessionAnalyzer({
        client,
        directory: baseDir,
        options: { recent: null, project: null, session: sessionId, force: false, onlyStale: false },
      })

      expect(first.analyzedSessions).toEqual([sessionId])
      const promptCallCountAfterFirstRun = client.session.prompt.mock.calls.length
      expect(promptCallCountAfterFirstRun).toBeGreaterThanOrEqual(1)

      const second = await runSessionAnalyzer({
        client,
        directory: baseDir,
        options: { recent: null, project: null, session: sessionId, force: false, onlyStale: false },
      })

      expect(second.skippedUpToDateSessions).toEqual([sessionId])
      expect(client.session.prompt.mock.calls.length).toBe(promptCallCountAfterFirstRun)

      const indexRaw = await readFile(second.indexPath, "utf8")
      const index = JSON.parse(indexRaw)
      const progressRaw = await readFile(second.progressPath, "utf8")
      const progress = JSON.parse(progressRaw)
      const eventsRaw = await readFile(second.eventsPath, "utf8")
      const events = eventsRaw.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
      expect(index.analyzerVersion).toBe(ANALYZER_VERSION)
      expect(index.sessions[sessionId].status).toBe("up_to_date")
      expect(index.sessions[sessionId].lastSeenMessageCount).toBe(1)
      expect(progress.status).toBe("completed")
      expect(progress.phase).toBe("finished")
      expect(progress.outputDirectory).toBe(second.outputDirectory)
      expect(events.at(-1)?.phase).toBe("finished")
    } finally {
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  it("retries sessions that previously failed", async () => {
    const sessionId = "s-fail"
    const t0 = Date.now() - 2000
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "session-analyzer-"))

    const client = makeClient({
      sessions: [{ id: sessionId, updatedAt: iso(t0), projectPath: "D:/proj" }],
      messagesBySession: {
        [sessionId]: [
          {
            info: { id: "m1", role: "user", time: { created: iso(t0) } },
            parts: [{ type: "text", text: "analyze this" }],
          },
        ],
      },
    })

    // First run: force a structured_output failure.
    client.session.prompt.mockImplementationOnce(async () => ({ data: { info: {} } }))

    try {
      const first = await runSessionAnalyzer({
        client,
        directory: baseDir,
        options: { recent: null, project: null, session: sessionId, force: false, onlyStale: false },
      })

      expect(first.failedSessions).toEqual([
        {
          sessionId,
          reason: "structured_output_missing",
          error: expect.stringMatching(/structured llm analysis/i),
        },
      ])
      expect(client.session.prompt).toHaveBeenCalledTimes(1)

      // Second run should retry even though index has status=failed.
      const second = await runSessionAnalyzer({
        client,
        directory: baseDir,
        options: { recent: null, project: null, session: sessionId, force: false, onlyStale: false },
      })

      expect(second.analyzedSessions).toEqual([sessionId])
      expect(second.staleSessions).toEqual([])
      expect(client.session.prompt).toHaveBeenCalledTimes(2)

      const indexRaw = await readFile(second.indexPath, "utf8")
      const index = JSON.parse(indexRaw)
      expect(index.sessions[sessionId].status).toBe("up_to_date")
      expect(index.sessions[sessionId].error).toBe(null)
    } finally {
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  it("onlyStale re-sends only sessions that became stale", async () => {
    const staleSessionId = "s-stale"
    const freshSessionId = "s-fresh"
    const t0 = Date.now() - 4000
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "session-analyzer-"))

    const client = makeClient({
      sessions: [
        { id: staleSessionId, updatedAt: iso(t0), projectPath: "D:/proj" },
        { id: freshSessionId, updatedAt: iso(t0), projectPath: "D:/proj" },
      ],
      messagesBySession: {
        [staleSessionId]: [
          {
            info: { id: "m1", role: "user", time: { created: iso(t0) } },
            parts: [{ type: "text", text: "first stale message" }],
          },
        ],
        [freshSessionId]: [
          {
            info: { id: "m2", role: "user", time: { created: iso(t0) } },
            parts: [{ type: "text", text: "first fresh message" }],
          },
        ],
      },
    })

    try {
      const first = await runSessionAnalyzer({
        client,
        directory: baseDir,
        options: { recent: null, project: null, session: null, force: false, onlyStale: false },
      })

      expect(first.analyzedSessions.sort()).toEqual([freshSessionId, staleSessionId])
      expect(client.session.prompt).toHaveBeenCalledTimes(2)

      const t1 = t0 + 1000
      client.session.list.mockResolvedValueOnce({
        data: [
          { id: staleSessionId, updatedAt: iso(t1), projectPath: "D:/proj" },
          { id: freshSessionId, updatedAt: iso(t0), projectPath: "D:/proj" },
        ],
      })
      client.session.messages.mockImplementation(async ({ path }: any) => {
        if (path.id === staleSessionId) {
          return {
            data: [
              {
                info: { id: "m1", role: "user", time: { created: iso(t0) } },
                parts: [{ type: "text", text: "first stale message" }],
              },
              {
                info: { id: "m3", role: "user", time: { created: iso(t1) } },
                parts: [{ type: "text", text: "second stale message" }],
              },
            ],
          }
        }

        return {
          data: [
            {
              info: { id: "m2", role: "user", time: { created: iso(t0) } },
              parts: [{ type: "text", text: "first fresh message" }],
            },
          ],
        }
      })

      const second = await runSessionAnalyzer({
        client,
        directory: baseDir,
        options: { recent: null, project: null, session: null, force: false, onlyStale: true },
      })

      expect(second.analyzedSessions).toEqual([staleSessionId])
      expect(second.skippedUpToDateSessions).toEqual([freshSessionId])
      expect(second.staleSessions).toEqual([{ sessionId: staleSessionId, status: "stale_due_to_new_messages" }])
      expect(client.session.prompt).toHaveBeenCalledTimes(3)
    } finally {
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  it("onlyStale skips never-analyzed sessions and retries only true stale sessions", async () => {
    const staleSessionId = "s-stale-only"
    const newSessionId = "s-new-only"
    const t0 = Date.now() - 8000
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "session-analyzer-"))

    const client = makeClient({
      sessions: [{ id: staleSessionId, updatedAt: iso(t0), projectPath: "D:/proj" }],
      messagesBySession: {
        [staleSessionId]: [
          {
            info: { id: "m1", role: "user", time: { created: iso(t0) } },
            parts: [{ type: "text", text: "first stale message" }],
          },
        ],
      },
    })

    try {
      await runSessionAnalyzer({
        client,
        directory: baseDir,
        options: { recent: null, project: null, session: null, force: false, onlyStale: false },
      })

      const t1 = t0 + 1000
      client.session.list.mockResolvedValueOnce({
        data: [
          { id: staleSessionId, updatedAt: iso(t1), projectPath: "D:/proj" },
          { id: newSessionId, updatedAt: iso(t1), projectPath: "D:/proj" },
        ],
      })
      client.session.messages.mockImplementation(async ({ path }: any) => {
        if (path.id === staleSessionId) {
          return {
            data: [
              {
                info: { id: "m1", role: "user", time: { created: iso(t0) } },
                parts: [{ type: "text", text: "first stale message" }],
              },
              {
                info: { id: "m2", role: "user", time: { created: iso(t1) } },
                parts: [{ type: "text", text: "second stale message" }],
              },
            ],
          }
        }

        return {
          data: [
            {
              info: { id: "m3", role: "user", time: { created: iso(t1) } },
              parts: [{ type: "text", text: "brand new session" }],
            },
          ],
        }
      })

      const second = await runSessionAnalyzer({
        client,
        directory: baseDir,
        options: { recent: null, project: null, session: null, force: false, onlyStale: true },
      })

      expect(second.analyzedSessions).toEqual([staleSessionId])
      expect(second.staleSessions).toEqual([{ sessionId: staleSessionId, status: "stale_due_to_new_messages" }])
      expect(second.failedSessions).toEqual([])
      expect(client.session.prompt).toHaveBeenCalledTimes(2)
    } finally {
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  it("skips analyzer control sessions triggered by slash command text", async () => {
    const sessionId = "s-control-slash"
    const t0 = Date.now() - 5000
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "session-analyzer-"))

    const client = makeClient({
      sessions: [{ id: sessionId, updatedAt: iso(t0), projectPath: "D:/proj" }],
      messagesBySession: {
        [sessionId]: [
          {
            info: { id: "m1", role: "user", time: { created: iso(t0) } },
            parts: [{ type: "text", text: "/session-analyzer --recent 5" }],
          },
        ],
      },
    })

    try {
      const result = await runSessionAnalyzer({
        client,
        directory: baseDir,
        options: { recent: null, project: null, session: sessionId, force: false, onlyStale: false },
      })

      expect(result.skippedAnalyzerSessions).toEqual([sessionId])
      expect(result.analyzedSessions).toEqual([])
      expect(client.session.prompt).not.toHaveBeenCalled()
    } finally {
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  it("skips analyzer control sessions triggered by tool invocation traces", async () => {
    const sessionId = "s-control-tool"
    const t0 = Date.now() - 6000
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "session-analyzer-"))

    const client = makeClient({
      sessions: [{ id: sessionId, updatedAt: iso(t0), projectPath: "D:/proj" }],
      messagesBySession: {
        [sessionId]: [
          {
            info: { id: "m1", role: "assistant", time: { created: iso(t0) } },
            parts: [{ type: "tool", tool: { name: "session_analyzer" }, state: "completed" }],
          },
        ],
      },
    })

    try {
      const result = await runSessionAnalyzer({
        client,
        directory: baseDir,
        options: { recent: null, project: null, session: sessionId, force: false, onlyStale: false },
      })

      expect(result.skippedAnalyzerSessions).toEqual([sessionId])
      expect(result.analyzedSessions).toEqual([])
      expect(client.session.prompt).not.toHaveBeenCalled()
    } finally {
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  it("does not skip normal sessions that merely mention session analyzer in discussion", async () => {
    const sessionId = "s-normal-mention"
    const t0 = Date.now() - 7000
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "session-analyzer-"))

    const client = makeClient({
      sessions: [{ id: sessionId, updatedAt: iso(t0), projectPath: "D:/proj" }],
      messagesBySession: {
        [sessionId]: [
          {
            info: { id: "m1", role: "user", time: { created: iso(t0) } },
            parts: [{ type: "text", text: "Please review whether the session analyzer might recurse on itself." }],
          },
        ],
      },
    })

    try {
      const result = await runSessionAnalyzer({
        client,
        directory: baseDir,
        options: { recent: null, project: null, session: sessionId, force: false, onlyStale: false },
      })

      expect(result.skippedAnalyzerSessions).toEqual([])
      expect(result.analyzedSessions).toEqual([sessionId])
      expect(client.session.prompt).toHaveBeenCalledTimes(1)
    } finally {
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  it("default run analyzes the oldest 5 eligible current-project sessions", async () => {
    const baseTime = Date.now() - 20_000
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "session-analyzer-"))
    const currentProjectIds = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"]
    const otherProjectId = "other-project"
    const controlId = "control-session"
    const allSessions = [
      ...currentProjectIds.map((id, index) => ({ id, updatedAt: iso(baseTime + index * 1000), projectPath: "D:/proj" })),
      { id: otherProjectId, updatedAt: iso(baseTime + 8000), projectPath: "D:/other" },
      { id: controlId, updatedAt: iso(baseTime + 9000), projectPath: "D:/proj" },
    ]

    const messagesBySession = Object.fromEntries(
      currentProjectIds.map((id, index) => [
        id,
        [
          {
            info: { id: `m-${id}`, role: "user", time: { created: iso(baseTime + index * 1000) } },
            parts: [{ type: "text", text: `analyze ${id}` }],
          },
        ],
      ]),
    )
    messagesBySession[otherProjectId] = [
      {
        info: { id: "m-other", role: "user", time: { created: iso(baseTime + 8000) } },
        parts: [{ type: "text", text: "analyze other project" }],
      },
    ]
    messagesBySession[controlId] = [
      {
        info: { id: "m-control", role: "user", time: { created: iso(baseTime + 9000) } },
        parts: [{ type: "text", text: "/session-analyzer" }],
      },
    ]

    const client = makeClient({
      sessions: allSessions,
      messagesBySession,
    })

    try {
      const result = await runSessionAnalyzer({
        client,
        directory: baseDir,
        options: parseArguments(""),
      })

      expect(result.analyzedSessions).toEqual(["p1", "p2", "p3", "p4", "p5"])
      expect(result.totalEligibleSessions).toBe(7)
      expect(result.completedEligibleSessions).toBe(5)
      expect(result.remainingEligibleSessions).toBe(2)
      expect(result.skippedAnalyzerSessions).toEqual([controlId])
      expect(result.skippedUpToDateSessions).toEqual([])
      expect(client.session.prompt).toHaveBeenCalledTimes(5)
    } finally {
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  it("bare --project analyzes only the next current-project batch from oldest first", async () => {
    const baseTime = Date.now() - 30_000
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "session-analyzer-"))
    const currentProjectIds = Array.from({ length: DEFAULT_PROJECT_BATCH_SESSION_COUNT + 3 }, (_, index) => `p-${index + 1}`)
    const client = makeClient({
      sessions: [
        ...currentProjectIds.map((id, index) => ({ id, updatedAt: iso(baseTime + index * 1000), projectPath: "D:/proj" })),
        { id: "other", updatedAt: iso(baseTime + 100_000), projectPath: "D:/other" },
        { id: "control", updatedAt: iso(baseTime + 101_000), projectPath: "D:/proj" },
      ],
      messagesBySession: {
        ...Object.fromEntries(
          currentProjectIds.map((id, index) => [
            id,
            [
              {
                info: { id: `m-${id}`, role: "user", time: { created: iso(baseTime + index * 1000) } },
                parts: [{ type: "text", text: `current project ${id}` }],
              },
            ],
          ]),
        ),
        other: [
          {
            info: { id: "m4", role: "user", time: { created: iso(baseTime + 3000) } },
            parts: [{ type: "text", text: "other project" }],
          },
        ],
        control: [
          {
            info: { id: "m5", role: "user", time: { created: iso(baseTime + 4000) } },
            parts: [{ type: "text", text: "/session-analyzer --project" }],
          },
        ],
      },
    })

    try {
      const result = await runSessionAnalyzer({
        client,
        directory: baseDir,
        options: parseArguments("--project"),
      })

      expect(result.analyzedSessions).toEqual(currentProjectIds.slice(0, DEFAULT_PROJECT_BATCH_SESSION_COUNT))
      expect(result.totalEligibleSessions).toBe(currentProjectIds.length)
      expect(result.completedEligibleSessions).toBe(DEFAULT_PROJECT_BATCH_SESSION_COUNT)
      expect(result.remainingEligibleSessions).toBe(3)
      expect(result.skippedAnalyzerSessions).toEqual(["control"])
      expect(client.session.prompt).toHaveBeenCalledTimes(DEFAULT_PROJECT_BATCH_SESSION_COUNT)
    } finally {
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  it("default run excludes already analyzed sessions from the pending total and next batch", async () => {
    const baseTime = Date.now() - 40_000
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "session-analyzer-"))
    const client = makeClient({
      sessions: [
        { id: "s1", updatedAt: iso(baseTime), projectPath: "D:/proj" },
        { id: "s2", updatedAt: iso(baseTime + 1000), projectPath: "D:/proj" },
        { id: "s3", updatedAt: iso(baseTime + 2000), projectPath: "D:/proj" },
      ],
      messagesBySession: {
        s1: [
          {
            info: { id: "m1", role: "user", time: { created: iso(baseTime) } },
            parts: [{ type: "text", text: "session 1" }],
          },
        ],
        s2: [
          {
            info: { id: "m2", role: "user", time: { created: iso(baseTime + 1000) } },
            parts: [{ type: "text", text: "session 2" }],
          },
        ],
        s3: [
          {
            info: { id: "m3", role: "user", time: { created: iso(baseTime + 2000) } },
            parts: [{ type: "text", text: "session 3" }],
          },
        ],
      },
    })

    try {
      const first = await runSessionAnalyzer({
        client,
        directory: baseDir,
        options: parseArguments(""),
      })

      expect(first.analyzedSessions).toEqual(["s1", "s2", "s3"])
      expect(first.totalEligibleSessions).toBe(3)
      expect(first.completedEligibleSessions).toBe(3)
      expect(first.remainingEligibleSessions).toBe(0)

      const second = await runSessionAnalyzer({
        client,
        directory: baseDir,
        options: parseArguments(""),
      })

      expect(second.analyzedSessions).toEqual([])
      expect(second.skippedUpToDateSessions).toEqual(["s1", "s2", "s3"])
      expect(second.totalEligibleSessions).toBe(3)
      expect(second.completedEligibleSessions).toBe(3)
      expect(second.remainingEligibleSessions).toBe(0)
      expect(client.session.prompt).toHaveBeenCalledTimes(3)
    } finally {
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  it("builds Chinese rule suggestions with explicit recommended scope", async () => {
    const sessionId = "s-rule-zh"
    const t0 = Date.now() - 1200
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "session-analyzer-"))
    const longPrompt = "请详细分析这个工作流并给出改进建议。".repeat(40)
    const client = makeClient({
      sessions: [{ id: sessionId, updatedAt: iso(t0), projectPath: "D:/proj" }],
      messagesBySession: {
        [sessionId]: [
          {
            info: { id: "m1", role: "user", time: { created: iso(t0) } },
            parts: [{ type: "text", text: longPrompt }],
          },
        ],
      },
    })
    client.session.prompt.mockResolvedValueOnce({
      data: {
        info: {
          structured_output: {
            findings: [],
            currentRecommendations: [],
            workflowSuggestions: [],
          },
        },
      },
    })
    client.session.prompt.mockResolvedValueOnce({
      data: {
        info: {
          structured_output: {
            recommendedScope: "project",
            confidence: "high",
            reason: "这条建议直接约束当前项目中提示词写法与分析输入质量，更适合落到当前项目规则。",
          },
        },
      },
    })

    try {
      const result = await runSessionAnalyzer({
        client,
        directory: baseDir,
        options: { recent: null, project: null, session: sessionId, force: false, onlyStale: false },
      })

      expect(result.ruleSuggestionPrompt).not.toBeNull()
      expect(result.ruleSuggestionPrompt?.targetSuggestions).toHaveLength(1)
      expect(result.ruleSuggestionPrompt?.targetSuggestions[0]?.summary).toContain("更早明确目标文件和预期结果")
      expect(result.ruleSuggestionPrompt?.targetSuggestions[0]?.recommendedScope).toBe("project")
      expect(result.ruleSuggestionPrompt?.targetSuggestions[0]?.reason).toMatch(/[\u4e00-\u9fff]/)
      expect(result.ruleSuggestionPrompt?.promptText).toContain("建议写入：当前项目 AGENTS.md")
      expect(result.ruleSuggestionPrompt?.promptText).toContain("原因：")
    } finally {
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  it("surfaces possible conflicts with existing AGENTS rules", async () => {
    const sessionId = "s-conflict"
    const t0 = Date.now() - 1000
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "session-analyzer-"))
    const client = makeClient({
      sessions: [{ id: sessionId, updatedAt: iso(t0), projectPath: "D:/proj" }],
      messagesBySession: {
        [sessionId]: [
          {
            info: { id: "m1", role: "user", time: { created: iso(t0) } },
            parts: [{ type: "text", text: "请详细分析这个工作流并给出改进建议。".repeat(40) }],
          },
        ],
      },
    })
    client.session.prompt.mockResolvedValueOnce({
      data: {
        info: {
          structured_output: {
            findings: [],
            currentRecommendations: [],
            workflowSuggestions: [
              {
                summary: "当提示词偏长时，更早明确目标文件和预期结果，减少来回确认。",
                scope: "project",
                validFrom: iso(t0),
                validTo: null,
                evidenceRefs: ["m1"],
              },
            ],
          },
        },
      },
    })
    client.session.prompt.mockResolvedValueOnce({
      data: {
        info: {
          structured_output: {
            recommendedScope: "project",
            confidence: "high",
            reason: "这条建议直接约束当前项目中提示词写法与分析输入质量，更适合落到当前项目规则。",
          },
        },
      },
    })
    client.session.prompt.mockResolvedValueOnce({
      data: {
        info: {
          structured_output: {
            status: "conflict",
            confidence: "high",
            ruleIndex: 0,
            reason: "现有规则要求在开始前先确认目标文件，这与新建议要求更早明确目标文件和结果可能引起执行冲突。",
          },
        },
      },
    })

    await writeFile(path.join(baseDir, "AGENTS.md"), "- 未确认目标文件前不要开始实现。\n")

    try {
      const result = await runSessionAnalyzer({
        client,
        directory: baseDir,
        options: { recent: null, project: null, session: sessionId, force: false, onlyStale: false },
      })

      expect(result.ruleSuggestionPrompt).not.toBeNull()
      expect(result.ruleSuggestionPrompt?.targetSuggestions).toHaveLength(1)
      expect(result.ruleSuggestionPrompt?.targetSuggestions[0]?.conflictScope).toBe("project")
      expect(result.ruleSuggestionPrompt?.targetSuggestions[0]?.conflictReason).toContain("执行冲突")
      expect(result.ruleSuggestionPrompt?.targetSuggestions[0]?.conflictingRuleText).toContain("未确认目标文件前不要开始实现")
      expect(result.ruleSuggestionPrompt?.promptText).toContain("与现有规则可能冲突：当前项目 AGENTS.md")
      expect(result.ruleSuggestionPrompt?.promptText).toContain("冲突说明：")
      expect(result.ruleSuggestionPrompt?.promptText).toContain("建议依据时间：")

      const projectSummaryRaw = await readFile(result.projectSummaryPath, "utf8")
      const projectSummary = JSON.parse(projectSummaryRaw)
      expect(projectSummary.ruleSuggestions).toHaveLength(1)
      expect(projectSummary.ruleSuggestions[0].conflictScope).toBe("project")
      expect(projectSummary.ruleSuggestions[0].conflictReason).toContain("执行冲突")
      expect(projectSummary.ruleSuggestions[0].conflictingRuleText).toContain("未确认目标文件前不要开始实现")
    } finally {
      await rm(baseDir, { recursive: true, force: true })
    }
  })
})
