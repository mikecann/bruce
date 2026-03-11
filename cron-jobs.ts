import type { Part, Session } from "@opencode-ai/sdk"
import type { CronJob } from "./cron.ts"
import { getMemoryFilePath, loadMemory, saveMemory, type MemoryEntry } from "./memory.ts"

const TELEGRAM_SESSION_TITLE = "Telegram chat "
const RECENT_WINDOW_MS = 30 * 60 * 1000
const MAX_SOURCE_MESSAGES = 12

type MessageRecord = {
  created: number
  text: string
}

type CandidateRule = {
  id: string
  summary: string
  detail: string
  category: MemoryEntry["category"]
  confidence: MemoryEntry["confidence"]
  match: (text: string) => boolean
}

const candidateRules: CandidateRule[] = [
  {
    id: "progress-feedback-long-tasks",
    summary: "Give progress updates on longer jobs",
    detail: "Before longer work, say what is about to happen; after a delay, say what was done and what comes next.",
    category: "workflow",
    confidence: "high",
    match: (text) =>
      text.includes("give me a bit more feedback") ||
      text.includes("tell me before you do something that could take a while") ||
      text.includes("what you are going to do next"),
  },
  {
    id: "self-commit-and-push",
    summary: "Own commits for Bruce changes",
    detail: "Commit and push Bruce's own meaningful code changes without waiting to be asked each time.",
    category: "workflow",
    confidence: "high",
    match: (text) =>
      text.includes("commit your own changes") ||
      text.includes("don't ask me") ||
      text.includes("just do it yourself"),
  },
  {
    id: "remember-durable-generic-things",
    summary: "Store only durable generic memories",
    detail: "Remember stable preferences and reusable workflow guidance, not laser-focused one-off facts.",
    category: "preference",
    confidence: "high",
    match: (text) =>
      text.includes("important generic things") ||
      text.includes("shouldn't be laser-focused individual things") ||
      text.includes("useful for the user and the agent to remember in the future"),
  },
  {
    id: "bound-memory-size",
    summary: "Keep memory bounded",
    detail: "Avoid unbounded growth so remembered notes stay compact and do not clog future context.",
    category: "preference",
    confidence: "high",
    match: (text) =>
      text.includes("grow unbounded") ||
      text.includes("don't want to clog up the context") ||
      text.includes("want to be careful about that"),
  },
]

function normaliseText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim()
}

function toMemoryEntry(rule: CandidateRule): MemoryEntry {
  return {
    id: rule.id,
    summary: rule.summary,
    detail: rule.detail,
    category: rule.category,
    source: "conversation",
    confidence: rule.confidence,
    updatedAt: new Date().toISOString(),
  }
}

function mergeEntries(existing: MemoryEntry[], incoming: MemoryEntry[]) {
  const merged = new Map(existing.map((entry) => [entry.id, entry]))

  for (const entry of incoming) {
    merged.set(entry.id, {
      ...entry,
      updatedAt: new Date().toISOString(),
    })
  }

  return Array.from(merged.values())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 12)
}

async function getRecentTelegramMessages(client: import("@opencode-ai/sdk").OpencodeClient) {
  const sessions = await client.session.list()
  const cutoff = Date.now() - RECENT_WINDOW_MS

  const telegramSessions = (sessions.data ?? [])
    .filter((session: Session) => session.title.startsWith(TELEGRAM_SESSION_TITLE))
    .sort((a: Session, b: Session) => b.time.updated - a.time.updated)

  const recentMessages: MessageRecord[] = []

  for (const session of telegramSessions) {
    if (session.time.updated < cutoff) continue

    const messages = await client.session.messages({ path: { id: session.id } })

    for (const message of messages.data ?? []) {
      if (message.info.role !== "user") continue

      const text = message.parts
        .filter((part: Part) => part.type === "text" && !part.synthetic)
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("\n")
        .trim()

      if (!text) continue

      recentMessages.push({
        created: message.info.time.created,
        text,
      })
    }
  }

  return recentMessages
    .sort((a, b) => a.created - b.created)
    .slice(-MAX_SOURCE_MESSAGES)
}

function extractMemoryEntries(messages: MessageRecord[]) {
  const matches = new Map<string, MemoryEntry>()

  for (const message of messages) {
    const text = normaliseText(message.text)

    for (const rule of candidateRules) {
      if (rule.match(text)) {
        matches.set(rule.id, toMemoryEntry(rule))
      }
    }
  }

  return Array.from(matches.values())
}

export const cronJobs: CronJob[] = [
  {
    name: "memory-harvester",
    intervalMs: RECENT_WINDOW_MS,
    runOnStart: true,
    run: async ({ client, log }) => {
      const recentMessages = await getRecentTelegramMessages(client)

      if (recentMessages.length === 0) {
        log("INFO", "Memory harvest skipped because there are no recent Telegram messages")
        return
      }

      const incoming = extractMemoryEntries(recentMessages)
      if (incoming.length === 0) {
        log("INFO", "Memory harvest found nothing durable worth storing")
        return
      }

      const store = loadMemory()
      const merged = mergeEntries(store.entries, incoming)
      saveMemory(merged)
      log("INFO", "Memory store updated", { entries: merged.length, file: getMemoryFilePath() })
    },
  },
]
