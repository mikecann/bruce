import { Bot } from "grammy"
import { createOpencode } from "@opencode-ai/sdk"
import { soul } from "./soul.ts"
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "fs"
import { join } from "path"

// --- Config ---

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID
const BASE_DIR = import.meta.dir
const STATE_DIR = join(BASE_DIR, "state")
const LOGS_DIR = join(BASE_DIR, "logs")
const SHUTDOWN_STATE_FILE = join(STATE_DIR, "shutdown-reason.json")
const SESSION_MAP_FILE = join(STATE_DIR, "telegram-sessions.json")
const LOG_FILE = join(LOGS_DIR, "bruce.log")

if (!BOT_TOKEN) {
  log("ERROR", "Missing TELEGRAM_BOT_TOKEN in .env")
  process.exit(1)
}

if (!ALLOWED_CHAT_ID) {
  log("ERROR", "Missing TELEGRAM_CHAT_ID in .env")
  process.exit(1)
}

// --- Logger ---
// Writes timestamped entries to logs/bruce.log AND to stdout.
// Safe to call before the bot is initialised — Telegram alerts are best-effort.

function log(level: "INFO" | "ERROR" | "WARN", message: string, extra?: unknown) {
  const timestamp = new Date().toISOString()
  const extraStr = extra !== undefined
    ? " " + (extra instanceof Error
        ? `${extra.message}\n${extra.stack}`
        : JSON.stringify(extra))
    : ""
  const line = `[${timestamp}] [${level}] ${message}${extraStr}`

  // Always write to stdout (captured by launchd → logs/telegram.stdout.log)
  console.log(line)

  // Also append to the rolling log file
  try {
    mkdirSync(LOGS_DIR, { recursive: true })
    appendFileSync(LOG_FILE, line + "\n")
  } catch {
    // If log writing itself fails there's not much we can do
  }
}

// --- Telegram alert helper ---
// Best-effort: logs errors internally but never throws.

let _bot: Bot | null = null

async function alertMike(message: string) {
  if (!_bot || !ALLOWED_CHAT_ID) return
  try {
    // Truncate to 4000 chars so a huge stack trace doesn't blow up the API call
    const truncated = message.length > 4000
      ? message.slice(0, 3950) + "\n...[truncated]"
      : message
    await _bot.api.sendMessage(ALLOWED_CHAT_ID, truncated)
  } catch (err) {
    log("ERROR", "Failed to send Telegram alert (Telegram itself may be down)", err instanceof Error ? err : undefined)
  }
}

// --- Global error handlers ---
// Catch anything that escapes normal try/catch, log it, alert Mike.

process.on("uncaughtException", async (err) => {
  log("ERROR", "Uncaught exception — process will exit", err)
  await alertMike(`⚠️ Bruce crashed (uncaught exception):\n${err.message}\n\nCheck logs/bruce.log for the full trace.`)
  process.exit(1)
})

process.on("unhandledRejection", async (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason))
  log("ERROR", "Unhandled promise rejection", err)
  await alertMike(`⚠️ Bruce hit an unhandled error:\n${err.message}\n\nCheck logs/bruce.log for the full trace.`)
})

// --- State helpers ---

type ShutdownState = {
  reason: string
  time: string
}

type SessionMap = Record<string, string>

function readShutdownState(): ShutdownState | null {
  try {
    if (!existsSync(SHUTDOWN_STATE_FILE)) return null
    return JSON.parse(readFileSync(SHUTDOWN_STATE_FILE, "utf-8")) as ShutdownState
  } catch {
    return null
  }
}

export function writeShutdownState(reason: string) {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(
      SHUTDOWN_STATE_FILE,
      JSON.stringify({ reason, time: new Date().toISOString() }),
    )
  } catch (err) {
    log("ERROR", "Failed to write shutdown state", err instanceof Error ? err : undefined)
  }
}

function clearShutdownState() {
  try {
    if (existsSync(SHUTDOWN_STATE_FILE)) {
      writeFileSync(SHUTDOWN_STATE_FILE, JSON.stringify({ reason: "cleared" }))
    }
  } catch {}
}

function readSessionMap(): SessionMap {
  try {
    if (!existsSync(SESSION_MAP_FILE)) return {}
    return JSON.parse(readFileSync(SESSION_MAP_FILE, "utf-8")) as SessionMap
  } catch {
    return {}
  }
}

function writeSessionMap(sessionMap: SessionMap) {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(SESSION_MAP_FILE, JSON.stringify(sessionMap, null, 2))
  } catch (err) {
    log("ERROR", "Failed to write Telegram session map", err instanceof Error ? err : undefined)
  }
}

const telegramSessions = readSessionMap()

async function createTelegramSession(chatId: string): Promise<string | undefined> {
  const session = await client.session.create({
    body: { title: `Telegram chat ${chatId}` },
  })

  if (!session.data) {
    return undefined
  }

  telegramSessions[chatId] = session.data.id
  writeSessionMap(telegramSessions)
  log("INFO", `Created new persistent session ${session.data.id} for chat ${chatId}`)

  return session.data.id
}

// --- Telegram Bot ---

log("INFO", "Starting Bruce...")

const bot = new Bot(BOT_TOKEN)
_bot = bot

// --- OpenCode ---

log("INFO", "Starting OpenCode server on port 4097...")
const { client } = await createOpencode({ port: 4097 })
log("INFO", "OpenCode server ready")

// --- Startup notification ---

const previousShutdown = readShutdownState()
clearShutdownState()

let startupMessage: string
if (!previousShutdown || previousShutdown.reason === "cleared") {
  startupMessage = "Back online. What do you need?"
} else if (previousShutdown.reason === "requested-reboot") {
  startupMessage = "I'm back after the reboot. All good."
} else if (previousShutdown.reason === "requested-shutdown") {
  startupMessage = "Back online. You started me back up — what's up?"
} else {
  startupMessage = `⚠️ Back online after unexpected shutdown (${previousShutdown.reason}). Might be worth checking what happened — logs are at /Users/bruce/bruce/logs/bruce.log`
}

await bot.api.sendMessage(ALLOWED_CHAT_ID, startupMessage)
log("INFO", `Startup message sent: ${startupMessage}`)

// --- Message handling ---

bot.on("message:text", async (ctx) => {
  const chatId = String(ctx.chat.id)

  if (chatId !== ALLOWED_CHAT_ID) {
    log("WARN", `Ignoring message from unknown chat: ${chatId}`)
    return
  }

  const text = ctx.message.text
  log("INFO", `Received: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`)

  try {
    if (text === "/new") {
      const sessionId = await createTelegramSession(chatId)

      if (!sessionId) {
        const msg = "Failed to start a fresh session. Something's cooked."
        log("ERROR", msg)
        await ctx.reply(msg)
        return
      }

      await ctx.reply("Righto, started a new thread. Clean slate from here.")
      return
    }

    let sessionId = telegramSessions[chatId]

    if (!sessionId) {
      sessionId = await createTelegramSession(chatId)

      if (!sessionId) {
        const msg = "Failed to start a session. Something's cooked."
        log("ERROR", msg)
        await ctx.reply(msg)
        return
      }
    } else {
      log("INFO", `Reusing persistent session ${sessionId} for chat ${chatId}`)
    }

    const events = await client.event.subscribe()

    let fullText = ""
    let lastText = ""

    await ctx.replyWithChatAction("typing")

    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction("typing").catch(() => {})
    }, 4000)

    const eventLoop = (async () => {
      for await (const event of events.stream) {
        if (event.type === "message.part.updated") {
          const part = event.properties?.part
          if (part?.type === "text" && !part?.synthetic) {
            const delta = event.properties?.delta
            if (delta) {
              fullText += delta
            } else if (part.text && part.text !== lastText) {
              fullText = part.text
            }
            if (part.text) lastText = part.text
          }
        }

        if (event.type === "session.idle") {
          if (event.properties?.sessionID === sessionId) {
            break
          }
        }

        if (event.type === "session.error") {
          log("ERROR", `Session error for ${sessionId}`, event.properties?.error)
          break
        }

        if (event.type === "server.instance.disposed") {
          log("WARN", "OpenCode server instance disposed")
          break
        }
      }
    })()

    await client.session.prompt({
      path: { id: sessionId },
      body: {
        system: soul,
        parts: [{ type: "text", text }],
      },
    })

    await eventLoop
    clearInterval(typingInterval)

    if (fullText.trim()) {
      const chunks = chunkMessage(fullText.trim(), 4000)
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(async () => {
          await ctx.reply(chunk)
        })
      }
      log("INFO", `Replied (${fullText.length} chars)`)
    } else {
      const msg = "Hmm, got nothing back. That's not right."
      log("WARN", "Session completed but response was empty")
      await ctx.reply(msg)
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    log("ERROR", "Error handling message", error)
    await ctx.reply("Something went wrong on my end. Check logs/bruce.log for details.").catch(() => {})
    await alertMike(`⚠️ Error handling your message:\n${error.message}\n\nCheck logs/bruce.log`)
  }
})

// --- Helpers ---

function chunkMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining)
      break
    }

    let splitAt = remaining.lastIndexOf("\n", maxLen)
    if (splitAt < maxLen * 0.5) splitAt = remaining.lastIndexOf(" ", maxLen)
    if (splitAt < maxLen * 0.5) splitAt = maxLen

    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).trimStart()
  }

  return chunks
}

// --- Start ---

log("INFO", "Bruce is listening on Telegram...")
bot.start()
