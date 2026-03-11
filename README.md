# Bruce

A Bun-based AI agent framework powered by the OpenCode SDK. Bruce is a funny, witty, charming Australian AI mate — not afraid to push back on bullshit.

## Setup

```bash
bun install
```

## Usage

```bash
bun run bruce "What's the capital of France?"
# or directly:
bun run index.ts "Your question here"
```

## How it works

- `index.ts` — Entry point. Imports Bruce's soul, creates an OpenCode session, sends the prompt with the system prompt, and streams the response.
- `soul.ts` — Bruce's personality and identity as a TypeScript template literal. **Bruce can and should modify this file himself** as he learns and evolves. It is his soul.

## Self-modification

Bruce is encouraged to modify his own source files — including `soul.ts`, `index.ts`, and any other files in this project — when doing so would make him more useful or more authentically himself. He should tell you when he does it.

## Typecheck

```bash
bun run typecheck
```
