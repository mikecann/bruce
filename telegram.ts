import { Bot } from "grammy"
import { createOpencode } from "@opencode-ai/sdk"
import { soul } from "./soul.ts"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"

// --- Config ---

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID
const STATE_DIR = join(import.meta.dir, "state")
const SHUTDOWN_STATE_FILE = join(STATE_DIR, "shutdown-reason.json")

if (!BOT_TOKEN) {
  console.error("Missing TELEGRAM_BOT_TOKEN in .env")
  process.exit(1)
}

if (!ALLOWED_CHAT_ID) {
  console.error("Missing TELEGRAM_CHAT_ID in .env")
  process.exit(1)
}

// --- State helpers ---

type ShutdownState = {
  reason: string
  time: string
}

function readShutdownState(): ShutdownState | null {
  try {
    if (!existsSync(SHUTDOWN_STATE_FILE)) return null
    return JSON.parse(readFileSync(SHUTDOWN_STATE_FILE, "utf-8")) as ShutdownState
  } catch {
    return null
  }
}

function writeShutdownState(reason: string) {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(
    SHUTDOWN_STATE_FILE,
    JSON.stringify({ reason, time: new Date().toISOString() }),
  )
}

function clearShutdownState() {
  try {
    if (existsSync(SHUTDOWN_STATE_FILE)) {
      writeFileSync(SHUTDOWN_STATE_FILE, JSON.stringify({ reason: "cleared" }))
    }
  } catch {}
}

// --- Telegram Bot ---

const bot = new Bot(BOT_TOKEN)

// --- OpenCode ---

const { client } = await createOpencode({ port: 4097 })

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
  startupMessage = `Back online. Went down unexpectedly (${previousShutdown.reason}). Might be worth checking what happened.`
}

await bot.api.sendMessage(ALLOWED_CHAT_ID, startupMessage)
console.log(`Startup message sent: ${startupMessage}`)

// --- Message handling ---

bot.on("message:text", async (ctx) => {
  const chatId = String(ctx.chat.id)

  // Only respond to Mike
  if (chatId !== ALLOWED_CHAT_ID) {
    console.log(`Ignoring message from unknown chat: ${chatId}`)
    return
  }

  const text = ctx.message.text
  console.log(`Received: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`)

  try {
    // Create an OpenCode session
    const session = await client.session.create({
      body: { title: text.slice(0, 60) },
    })

    if (!session.data) {
      await ctx.reply("Failed to start a session. Something's cooked.")
      return
    }

    const sessionId = session.data.id

    // Subscribe to events
    const events = await client.event.subscribe()

    // Collect the full response text
    let fullText = ""
    let lastText = ""

    // Send a typing indicator
    await ctx.replyWithChatAction("typing")

    // Keep typing indicator alive while processing
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

        if (
          event.type === "session.error" ||
          event.type === "server.instance.disposed"
        ) {
          break
        }
      }
    })()

    // Send the prompt with Bruce's soul
    await client.session.prompt({
      path: { id: sessionId },
      body: {
        system: soul,
        parts: [{ type: "text", text }],
      },
    })

    // Wait for completion
    await eventLoop
    clearInterval(typingInterval)

    // Send the response
    if (fullText.trim()) {
      // Telegram has a 4096 char limit per message — chunk if needed
      const chunks = chunkMessage(fullText.trim(), 4000)
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(async () => {
          // Fall back to plain text if Markdown parsing fails
          await ctx.reply(chunk)
        })
      }
    } else {
      await ctx.reply("Hmm, got nothing back. That's not right.")
    }

    console.log(`Replied (${fullText.length} chars)`)
  } catch (err) {
    console.error("Error handling message:", err)
    await ctx.reply("Something went wrong on my end. Give me a sec.").catch(() => {})
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

    // Try to split at a newline near the limit
    let splitAt = remaining.lastIndexOf("\n", maxLen)
    if (splitAt < maxLen * 0.5) {
      // No good newline break — split at a space
      splitAt = remaining.lastIndexOf(" ", maxLen)
    }
    if (splitAt < maxLen * 0.5) {
      // No good break at all — hard split
      splitAt = maxLen
    }

    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).trimStart()
  }

  return chunks
}

// --- Shutdown state writing helper (exported for Bruce's tools) ---

export { writeShutdownState }

// --- Start ---

console.log("Bruce is listening on Telegram...")
bot.start()
