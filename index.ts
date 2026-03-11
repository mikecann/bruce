import { createOpencode } from "@opencode-ai/sdk"
import { soul } from "./soul.ts"

const prompt = process.argv.slice(2).join(" ")

if (!prompt) {
  console.error("Usage: bun run index.ts <prompt>")
  console.error("   or: bun run bruce <prompt>")
  process.exit(1)
}

const { client } = await createOpencode()

// Create a new session
const session = await client.session.create({
  body: { title: prompt.slice(0, 60) },
})

if (!session.data) {
  console.error("Failed to create session")
  process.exit(1)
}

const sessionId = session.data.id

// Subscribe to events and stream output
const events = await client.event.subscribe()

let seenSessionIdle = false
let lastText = ""

const eventLoop = (async () => {
  for await (const event of events.stream) {
    if (event.type === "message.part.updated") {
      const part = event.properties?.part
      if (part?.type === "text" && !part?.synthetic) {
        // Use delta if available for clean streaming, otherwise diff with last known text
        const delta = event.properties?.delta
        if (delta) {
          process.stdout.write(delta)
        } else if (part.text && part.text !== lastText) {
          const newPortion = part.text.slice(lastText.length)
          if (newPortion) process.stdout.write(newPortion)
          lastText = part.text
        }
      }
    }

    if (event.type === "session.idle") {
      if (event.properties?.sessionID === sessionId) {
        seenSessionIdle = true
        break
      }
    }

    if (event.type === "session.error" || event.type === "server.instance.disposed") {
      break
    }
  }
})()

// Send the prompt with Bruce's soul as the system prompt
await client.session.prompt({
  path: { id: sessionId },
  body: {
    system: soul,
    parts: [{ type: "text", text: prompt }],
  },
})

// Wait for the session to finish
await eventLoop

if (!seenSessionIdle) {
  // Poll briefly if we didn't catch the idle event
  await new Promise((resolve) => setTimeout(resolve, 500))
}

process.stdout.write("\n")
process.exit(0)
