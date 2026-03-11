import type { OpencodeClient } from "@opencode-ai/sdk"

export type CronJobContext = {
  client: OpencodeClient
  log: (level: "INFO" | "ERROR" | "WARN", message: string, extra?: unknown) => void
}

export type CronJob = {
  name: string
  intervalMs: number
  runOnStart?: boolean
  run: (context: CronJobContext) => Promise<void>
}

export function startCronJobs(jobs: CronJob[], context: CronJobContext) {
  for (const job of jobs) {
    let running = false

    const execute = async () => {
      if (running) {
        context.log("WARN", `Skipping cron job ${job.name} because it is still running`)
        return
      }

      running = true
      const startedAt = Date.now()
      context.log("INFO", `Running cron job ${job.name}`)

      try {
        await job.run(context)
        context.log("INFO", `Finished cron job ${job.name}`, { durationMs: Date.now() - startedAt })
      } catch (error) {
        context.log("ERROR", `Cron job ${job.name} failed`, error instanceof Error ? error : new Error(String(error)))
      } finally {
        running = false
      }
    }

    if (job.runOnStart) {
      queueMicrotask(() => {
        execute().catch(() => {})
      })
    }

    setInterval(() => {
      execute().catch(() => {})
    }, job.intervalMs)
  }
}
