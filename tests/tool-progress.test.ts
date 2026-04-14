import { describe, expect, it, vi } from "vitest"
import { readFile, rm } from "node:fs/promises"
import { createSessionAnalyzerTool } from "../src/opencode/tool"

function makeClient() {
  const t0 = new Date().toISOString()

  return {
    app: {
      log: vi.fn(async () => undefined),
    },
    tui: {
      showToast: vi.fn(async () => undefined),
    },
    project: {
      current: vi.fn(async () => ({ data: { path: "D:/proj" } })),
    },
    session: {
      list: vi.fn(async () => ({ data: [{ id: "s-1", updatedAt: t0, projectPath: "D:/proj" }] })),
      messages: vi.fn(async () => ({
        data: [
          {
            info: { id: "m1", role: "user", time: { created: t0 } },
            parts: [{ type: "text", text: "analyze this" }],
          },
        ],
      })),
      create: vi.fn(async () => ({ data: { id: "tmp" } })),
      prompt: vi.fn(async () => ({
        data: {
          info: {
            structured: {
              findings: [],
              currentRecommendations: [],
              workflowSuggestions: [],
            },
          },
        },
      })),
      delete: vi.fn(async () => undefined),
    },
  }
}

describe("session analyzer tool progress", () => {
  it("publishes metadata updates while running", async () => {
    const client = makeClient()
    const metadata = vi.fn()
    const tool = createSessionAnalyzerTool(client as never)

    const output = await tool.execute(
      { arguments: "--recent 1" },
      {
        sessionID: "ses-tool",
        messageID: "msg-tool",
        agent: "test",
        directory: "D:/17 product/session-analyzer/.tmp-tool-progress",
        worktree: "/",
        abort: new AbortController().signal,
        metadata,
        ask: vi.fn(async () => undefined),
      },
    )

    expect(JSON.parse(output).analyzedSessions).toEqual(["s-1"])
    expect(metadata).toHaveBeenCalled()
    expect(client.tui.showToast).toHaveBeenCalledTimes(1)
    expect(client.tui.showToast).toHaveBeenCalledWith({
      body: {
        message: "开始分析 1 个待处理 session",
        variant: "info",
      },
    })

    const titles = metadata.mock.calls.map((call) => call[0]?.title).filter(Boolean)
    expect(titles.some((title: string) => title.includes("starting"))).toBe(true)
    expect(titles.some((title: string) => title.includes("processing"))).toBe(true)
    expect(titles.some((title: string) => title.includes("completed session"))).toBe(true)
    expect(titles.some((title: string) => title.includes("finished"))).toBe(true)

    const result = JSON.parse(output)
    const progress = JSON.parse(await readFile(result.progressPath, "utf8"))
    const events = (await readFile(result.eventsPath, "utf8"))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    expect(progress.phase).toBe("finished")
    expect(progress.status).toBe("completed")
    expect(progress.counts.analyzed).toBe(1)
    expect(progress.counts.completedEligible).toBe(1)
    expect(progress.counts.totalEligible).toBe(1)
    expect(result.completedEligibleSessions).toBe(1)
    expect(result.totalEligibleSessions).toBe(1)
    expect(result.remainingEligibleSessions).toBe(0)
    expect(events[0]?.phase).toBe("started")
    expect(events.at(-1)?.phase).toBe("finished")
    expect(events.some((event: any) => event.phase === "session_started")).toBe(true)

    await rm("D:/17 product/session-analyzer/.tmp-tool-progress", { recursive: true, force: true })
  })
})
