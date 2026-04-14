export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

export function toIsoString(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }

  return null
}

export function clipText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength - 3)}...`
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

export function dirnameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/")
  const index = normalized.lastIndexOf("/")
  return index <= 0 ? normalized : normalized.slice(0, index)
}

export function incrementCounter(map: Map<string, number>, value: string | null): void {
  if (!value) {
    return
  }

  map.set(value, (map.get(value) ?? 0) + 1)
}

export function topEntries(map: Map<string, number>, limit = 10): Array<{ value: string; count: number }> {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }))
}

export function uniqueByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>()
  const result: T[] = []

  for (const item of items) {
    const key = keyFn(item)
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    result.push(item)
  }

  return result
}
