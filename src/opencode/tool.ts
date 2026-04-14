import { tool } from "@opencode-ai/plugin"
import { parseArguments } from "./args"
import { runSessionAnalyzer } from "./analyze"
import type { AnalyzeProgressPhase, AnalyzeProgressUpdate } from "./types"

export function createSessionAnalyzerTool(client: unknown) {
  return tool({
    description: "Analyze OpenCode sessions and write JSON artifacts",
    args: {
      arguments: tool.schema.string().describe("Raw /session-analyzer command arguments"),
    },
    async execute(args, context) {
      const options = parseArguments(args.arguments)

      const TOAST_INTERVAL_MS = 30_000
      let lastShownToastAt = 0
      let lastShownToast: { message: string; variant?: "info" | "success" | "warning" | "error" } | null = null
      let pendingToast: { message: string; variant?: "info" | "success" | "warning" | "error" } | null = null
      let repeatToastTimer: ReturnType<typeof setTimeout> | null = null
      let toastLoopStopped = false

      const clearRepeatToastTimer = () => {
        if (repeatToastTimer) {
          clearTimeout(repeatToastTimer)
          repeatToastTimer = null
        }
      }

      const showToastNow = async (input: { message: string; variant?: "info" | "success" | "warning" | "error" }) => {
        const tui = (client as any)?.tui
        if (!tui?.showToast) {
          return
        }

        lastShownToastAt = Date.now()
        lastShownToast = input
        await tui
          .showToast({
            body: {
              message: input.message,
              variant: input.variant ?? "info",
            },
          })
          .catch(() => undefined)
      }

      const scheduleToastTick = () => {
        clearRepeatToastTimer()
        if (toastLoopStopped || (!pendingToast && !lastShownToast)) {
          return
        }

        repeatToastTimer = setTimeout(() => {
          void (async () => {
            if (toastLoopStopped) {
              return
            }

            const nextToast = pendingToast ?? lastShownToast
            pendingToast = null
            if (nextToast) {
              await showToastNow(nextToast)
            }

            scheduleToastTick()
          })()
        }, TOAST_INTERVAL_MS)
      }

      const queueProgressToast = (input: { message: string; variant?: "info" | "success" | "warning" | "error" }) => {
        if (toastLoopStopped) {
          return
        }

        const now = Date.now()
        const elapsed = lastShownToastAt === 0 ? TOAST_INTERVAL_MS : now - lastShownToastAt
        if (lastShownToastAt === 0 || elapsed >= TOAST_INTERVAL_MS) {
          pendingToast = null
          void showToastNow(input)
          scheduleToastTick()
          return
        }

        pendingToast = input
        scheduleToastTick()
      }

      const stopToastLoop = () => {
        toastLoopStopped = true
        pendingToast = null
        lastShownToast = null
        clearRepeatToastTimer()
      }

      const publishProgress = (event: AnalyzeProgressUpdate) => {
        const total = event.total ?? 0
        const counts = event.counts ?? {
          analyzed: 0,
          skippedUpToDate: 0,
          skippedAnalyzer: 0,
          failed: 0,
          completedEligible: 0,
          totalEligible: total,
        }
        const phaseLabel = formatProgressPhase(event)
        const title = counts.totalEligible > 0
          ? `Session analyzer ${phaseLabel} (${Math.min(counts.completedEligible, counts.totalEligible)}/${counts.totalEligible})`
          : `Session analyzer ${phaseLabel}`

        context.metadata({
          title,
          metadata: {
            phase: event.phase,
            sessionId: event.sessionId,
            position: event.position,
            total: event.total,
            detail: event.message,
            ...counts,
          },
        })

        // Low-frequency, user-visible progress in the TUI.
        // Avoid completion toasts: the final tool output is already visible.
        if (event.phase === "finished") {
          stopToastLoop()
          return
        }

        // Ignore the tool's initial "initializing" metadata update.
        if (event.phase === "started" && counts.totalEligible === 0) {
          return
        }

        if (event.phase === "started") {
          queueProgressToast({
            message: counts.totalEligible > 0
              ? `开始分析 ${counts.totalEligible} 个待处理 session`
              : "开始分析 session",
            variant: "info",
          })
          return
        }

        const isWaitingForLlm =
          event.phase === "session_started" &&
          typeof event.message === "string" &&
          event.message.startsWith("waiting_for_llm")
        if (isWaitingForLlm) {
          const detail = (event.message ?? "").replace(/^waiting_for_llm:?\s*/i, "").trim()
          queueProgressToast({
            message: detail
              ? `仍在等待模型返回（${detail}）`
              : "仍在等待模型返回",
            variant: "info",
          })
          return
        }

        if (event.phase === "session_completed" || event.phase === "session_failed") {
          queueProgressToast({
            message: `已完成 ${Math.min(counts.completedEligible, counts.totalEligible)}/${counts.totalEligible}，失败 ${counts.failed}`,
            variant: counts.failed > 0 ? "warning" : "info",
          })
        }
      }

      publishProgress({
        phase: "started",
        message: "initializing",
        counts: {
          analyzed: 0,
          skippedUpToDate: 0,
          skippedAnalyzer: 0,
          failed: 0,
          completedEligible: 0,
          totalEligible: 0,
        },
      })

      try {
        const result = await runSessionAnalyzer({
          client,
          directory: context.directory,
          options,
          onProgress: publishProgress,
        })

        return JSON.stringify(result, null, 2)
      } finally {
        stopToastLoop()
      }
    },
  })
}

function formatProgressPhase(event: {
  phase: AnalyzeProgressPhase
  message?: string
}): string {
  switch (event.phase) {
    case "started":
      return "starting"
    case "session_started":
      return "processing"
    case "session_skipped":
      if (event.message === "control_session") {
        return "skipping control session"
      }

      if (event.message === "not_stale") {
        return "skipping non-stale session"
      }

      return "skipping up-to-date session"
    case "session_completed":
      return "completed session"
    case "session_failed":
      return "failed session"
    case "finished":
      return "finished"
  }
}
