import type { Plugin } from "@opencode-ai/plugin"
import { createSessionAnalyzerTool } from "./tool"

export const SessionAnalyzerPlugin: Plugin = async ({ client, directory }) => {
  await client.app.log({
    body: {
      service: "session-analyzer",
      level: "info",
      message: "Session analyzer plugin initialized",
      extra: {
        directory,
      },
    },
  })

  return {
    tool: {
      session_analyzer: createSessionAnalyzerTool(client),
    },
  }
}

export default SessionAnalyzerPlugin
