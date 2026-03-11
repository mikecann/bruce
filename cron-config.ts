import type { CronJob } from "./cron.ts"

export const cronJobs: CronJob[] = [
  {
    name: "heartbeat",
    intervalMs: 30 * 60 * 1000,
    runOnStart: true,
    run: async ({ log }) => {
      log("INFO", "Heartbeat cron job ran")
    },
  },
]
