// Worker entrypoint: `npm run worker` (or the compose `worker` service).
import 'dotenv/config'
import { writeFile } from 'node:fs/promises'
import { startWorker } from './worker.ts'

startWorker()
  .then(async () => {
    const readyFile = process.env.WORKER_READY_FILE
    if (readyFile) await writeFile(readyFile, new Date().toISOString())
  })
  .catch(e => {
    console.error('worker failed to start:', e)
    process.exit(1)
  })
