export async function logBestEffort(
  client: any,
  level: "info" | "warn",
  message: string,
  extra: Record<string, unknown>,
): Promise<void> {
  try {
    await client?.app?.log?.({
      body: {
        service: "session-analyzer",
        level,
        message,
        extra,
      },
    })
  } catch {
    // Logging is best-effort and should never block analysis.
  }
}
