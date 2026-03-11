import { createOpencode } from "@opencode-ai/sdk"

const prompt = process.argv.slice(2).join(" ")

if (!prompt) {
  console.error("Usage: bun run index.ts <prompt>")
  process.exit(1)
}

console.log(`Starting OpenCode session...`)
console.log(`Prompt: ${prompt}`)
console.log("---")

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
console.log(`Session created: ${sessionId}`)

// Subscribe to events in the background
const events = await client.event.subscribe()
;(async () => {
  for await (const event of events.stream) {
    if (event.type === "message.part.updated") {
      const part = (event.properties as any)?.part
      if (part?.type === "text" && part?.text) {
        process.stdout.write(part.text)
      }
    }
  }
})()

// Send the prompt
await client.session.prompt({
  path: { id: sessionId },
  body: {
    parts: [{ type: "text", text: prompt }],
  },
})

console.log("\n---")
console.log("Done.")
process.exit(0)
