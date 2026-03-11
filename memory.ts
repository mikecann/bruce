import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"

export type MemoryEntry = {
  id: string
  summary: string
  detail: string
  category: "preference" | "workflow" | "environment"
  source: "conversation" | "manual"
  confidence: "high" | "medium"
  updatedAt: string
}

export type MemoryStore = {
  updatedAt: string
  entries: MemoryEntry[]
}

const BASE_DIR = import.meta.dir
const STATE_DIR = join(BASE_DIR, "state")
const MEMORY_FILE = join(STATE_DIR, "memory.json")
const MAX_MEMORY_ENTRIES = 12

const DEFAULT_STORE: MemoryStore = {
  updatedAt: new Date(0).toISOString(),
  entries: [],
}

export function getMemoryFilePath() {
  return MEMORY_FILE
}

export function loadMemory(): MemoryStore {
  try {
    if (!existsSync(MEMORY_FILE)) return DEFAULT_STORE

    const parsed = JSON.parse(readFileSync(MEMORY_FILE, "utf-8")) as MemoryStore
    if (!Array.isArray(parsed.entries)) return DEFAULT_STORE

    return {
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : DEFAULT_STORE.updatedAt,
      entries: parsed.entries.slice(0, MAX_MEMORY_ENTRIES),
    }
  } catch {
    return DEFAULT_STORE
  }
}

export function saveMemory(entries: MemoryEntry[]) {
  const store: MemoryStore = {
    updatedAt: new Date().toISOString(),
    entries: entries.slice(0, MAX_MEMORY_ENTRIES),
  }

  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(MEMORY_FILE, JSON.stringify(store, null, 2) + "\n")
}

export function formatMemoryForPrompt(entries: MemoryEntry[]): string {
  if (entries.length === 0) return ""

  const lines = entries.map((entry) => `- ${entry.summary}: ${entry.detail}`)
  return [
    "## Remembered Notes",
    "Use these when they are relevant. They are durable preferences or workflow patterns, not one-off trivia.",
    ...lines,
  ].join("\n")
}
