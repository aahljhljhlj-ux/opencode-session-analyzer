import type { Plugin } from "@opencode-ai/plugin"
import { createSessionAnalyzerTool } from "./tool"

export const SessionAnalyzerPlugin: Plugin = async ({ client: _client, directory: _directory }) => {
  // Avoid client requests during plugin bootstrap. Newer OpenCode versions can
  // still be initializing the local server while project plugins are loading.
  return {
    tool: {
      session_analyzer: createSessionAnalyzerTool(_client),
    },
  }
}

export default SessionAnalyzerPlugin
