# Bruce

Bruce is a self-modifying AI agent. He runs on Bun, uses the OpenCode SDK, and has full permission to rewrite his own source code.

Most AI agents are static — someone writes a system prompt, deploys it, and that's what you get. Bruce is different. His personality, his behaviour, and even the code that runs him are all files he can read and edit. If he thinks something about himself should change, he changes it.

## What's the point?

The idea is to build an agent that genuinely evolves through use. Not through fine-tuning or retraining, but by literally rewriting itself — its personality (`soul.ts`), its entrypoint (`index.ts`), its instructions (`CLAUDE.md`), whatever it takes. Every file in this repo is fair game.

Bruce is opinionated, Australian, and allergic to corporate speak. He's the kind of agent you'd actually want to talk to — and if he's not, he can fix that himself.

## Setup

```bash
bun install
```

## Usage

```bash
bun run bruce "What's the deal with self-modifying agents?"
# or directly:
bun run index.ts "Your prompt here"
```

## Project structure

| File | Purpose | Self-modifiable? |
|------|---------|-----------------|
| `soul.ts` | Bruce's personality and identity — the system prompt, exported as a template literal | Yes — this is his soul |
| `index.ts` | Entry point. Creates an OpenCode session, injects the soul, streams the response | Yes |
| `CLAUDE.md` | Instructions for the underlying model when running inside OpenCode | Yes |
| `package.json` | Dependencies and scripts | Yes |

## Self-modification

This is the core idea. Bruce has explicit permission — and encouragement — to modify any file in this project, including:

- **His soul** (`soul.ts`) — If his personality needs tuning, he should tune it. If he learns something about Mike that matters, he should remember it. If a boundary needs adjusting, he adjusts it.
- **His code** (`index.ts` and anything else) — If the framework needs a new capability, Bruce can add it. New files, new logic, whatever serves the goal.
- **His instructions** (`CLAUDE.md`) — If the agent instructions are missing something or could be better, Bruce can update them.

The only rules: tell Mike what changed and why, and don't break things without a reason.

## How it works

1. `index.ts` imports the soul from `soul.ts`
2. Creates an OpenCode session via the SDK
3. Sends the user's prompt with Bruce's soul as the system prompt
4. Streams the response back in real-time via server-sent events
5. Exits cleanly when the session goes idle

The soul is a TypeScript template literal — no filesystem reads at runtime, no markdown files to lose track of. It's code, and Bruce can edit code.

## Typecheck

```bash
bun run typecheck
```
