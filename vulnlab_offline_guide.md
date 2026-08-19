# Vulnlab Offline Working Guide
## Orchestrator Build — Continue From Here

---

## Where You Left Off

You just finished `config.ts`. Your next task is to build out the remaining
infrastructure files for the orchestrator, then wire them together in
`server.ts`. Work through these in order — each file depends on the one before it.

Your current folder structure inside `services/orchestrator/src/` should look
like this when you are done:

```
src/
  config.ts          ← DONE
  logger.ts          ← next
  infrastructure/
    db.ts
    queue.ts
  domain/
    lab/
      lab.model.ts
      lab.service.ts
      lab.routes.ts
  app.ts
  server.ts
```

Create folders as you go:

```bash
mkdir -p src/infrastructure
mkdir -p src/domain/lab
```

---

## Step 1 — logger.ts

**What it does:** Every service needs structured logging. Instead of
`console.log`, you use Winston which emits clean JSON with timestamps.
This is what will eventually feed into Elasticsearch.

Create `src/logger.ts`:

```typescript
import winston from 'winston'

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
})
```

**Why JSON format?** When logs are plain text they are hard to search and
filter. JSON logs have consistent fields — every log line has a timestamp,
a level, and a message. Tools like Elasticsearch can index them automatically.

**Test your understanding:** What is the difference between a log level of
`info` and `error`? Think about when you would use each one.

---

## Step 2 — infrastructure/db.ts

**What it does:** Manages the MongoDB connection. The rest of your app
imports this and calls `connectDB()` at startup.

Create `src/infrastructure/db.ts`:

```typescript
import mongoose from 'mongoose'
import { config } from '../config'
import { logger } from '../logger'

export async function connectDB(): Promise<void> {
  mongoose.connection.on('disconnected', () => {
    logger.warn({ msg: 'MongoDB disconnected' })
  })

  await mongoose.connect(config.MONGO_URI)
  logger.info({ msg: 'MongoDB connected' })
}
```

**Things to notice:**

- `async function` means this function does something that takes time
  (connecting to a database) and you can `await` it
- `Promise<void>` means the function returns a Promise but no actual value
  when it resolves — it either connects or throws an error
- The `disconnected` event listener will log a warning if MongoDB drops the
  connection unexpectedly during runtime

**Question to think about:** Why do we import `config` instead of reading
`process.env.MONGO_URI` directly here?

---

## Step 3 — infrastructure/queue.ts

**What it does:** Manages the RabbitMQ connection and exposes a
`publishJob()` function. Any part of the orchestrator that needs to send
a job to the worker calls this function.

Create `src/infrastructure/queue.ts`:

```typescript
import amqplib, { Channel, Connection } from 'amqplib'
import { config } from '../config'
import { logger } from '../logger'
import { JobMessage } from '@vulnlab/shared'

export const QUEUES = {
  LAB_JOBS: 'lab.jobs'
} as const

let channel: Channel

export async function connectQueue(): Promise<void> {
  const connection: Connection = await amqplib.connect(config.RABBITMQ_URI)
  channel = await connection.createChannel()

  await channel.assertQueue(QUEUES.LAB_JOBS, { durable: true })
  logger.info({ msg: 'RabbitMQ connected' })
}

export function publishJob(message: JobMessage): void {
  channel.sendToQueue(
    QUEUES.LAB_JOBS,
    Buffer.from(JSON.stringify(message)),
    { persistent: true }
  )
  logger.info({ jobType: message.jobType, labId: message.labId, msg: 'Job published' })
}
```

**Things to notice:**

- `durable: true` on the queue means the queue survives a RabbitMQ restart
- `persistent: true` on the message means the message itself survives a
  RabbitMQ restart — so if the broker goes down mid-flight the message is
  not lost
- `Buffer.from(JSON.stringify(message))` — RabbitMQ sends raw bytes, not
  objects. You serialize the message to JSON then convert it to a Buffer
- `as const` on QUEUES means those values can never be changed — the queue
  name is fixed
- Notice `channel` is declared outside the function — it is module-scoped.
  Once connected, any call to `publishJob()` reuses the same channel

**Question to think about:** Why is `JobMessage` imported from
`@vulnlab/shared` instead of being defined here?

---

## Step 4 — domain/lab/lab.model.ts

**What it does:** Defines the shape of a Lab document in MongoDB using
Mongoose. This is your database schema.

Create `src/domain/lab/lab.model.ts`:

```typescript
import mongoose, { Schema, Document } from 'mongoose'
import { LabStatus } from '@vulnlab/shared'

export interface ILab extends Document {
  scenarioId: string
  status: LabStatus
  accessUrl?: string
  containerId?: string
  networkId?: string
  startedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const LabSchema = new Schema<ILab>(
  {
    scenarioId: { type: String, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'DEPLOYING', 'RUNNING', 'RESETTING', 'DESTROYED', 'FAILED'],
      default: 'PENDING'
    },
    accessUrl: String,
    containerId: String,
    networkId: String,
    startedAt: Date
  },
  { timestamps: true }
)

export const Lab = mongoose.model<ILab>('Lab', LabSchema)
```

**Things to notice:**

- `ILab extends Document` — your interface extends Mongoose's Document type,
  which adds built-in fields like `_id`, `save()`, etc.
- Fields with `?` after the name are optional — `accessUrl` does not exist
  until the worker sets it when the lab is running
- `enum` on the status field means MongoDB will reject any value that is not
  in that list — enforced at the database level, not just TypeScript
- `{ timestamps: true }` tells Mongoose to automatically manage `createdAt`
  and `updatedAt` fields — you never set those manually
- `required: true` on `scenarioId` means MongoDB will reject a lab document
  that has no scenario attached

---

## Step 5 — domain/lab/lab.service.ts

**What it does:** Contains the business logic for labs. This is where the
state machine lives. Route handlers call service functions — they never
touch the database directly.

Create `src/domain/lab/lab.service.ts`:

```typescript
import { v4 as uuidv4 } from 'uuid'
import { Lab, ILab } from './lab.model'
import { publishJob } from '../../infrastructure/queue'
import { JobMessage, LabStatus } from '@vulnlab/shared'
import { logger } from '../../logger'

const VALID_TRANSITIONS: Record<LabStatus, LabStatus[]> = {
  PENDING: ['DEPLOYING', 'FAILED'],
  DEPLOYING: ['RUNNING', 'FAILED'],
  RUNNING: ['RESETTING', 'DESTROYED'],
  RESETTING: ['RUNNING', 'FAILED'],
  DESTROYED: [],
  FAILED: []
}

export function canTransition(from: LabStatus, to: LabStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to)
}

export async function createLab(scenarioId: string): Promise<ILab> {
  const lab = await Lab.create({ scenarioId, status: 'PENDING' })

  const message: JobMessage = {
    jobType: 'lab.deploy',
    labId: lab._id.toString(),
    scenarioId,
    timestamp: new Date().toISOString()
  }

  publishJob(message)
  logger.info({ labId: lab._id, scenarioId, msg: 'Lab created and job published' })

  return lab
}

export async function getLabById(labId: string): Promise<ILab | null> {
  return Lab.findById(labId)
}

export async function transitionLab(
  labId: string,
  to: LabStatus
): Promise<ILab | null> {
  const lab = await Lab.findById(labId)
  if (!lab) return null

  if (!canTransition(lab.status, to)) {
    logger.warn({ labId, from: lab.status, to, msg: 'Invalid state transition rejected' })
    throw new Error(`Cannot transition from ${lab.status} to ${to}`)
  }

  lab.status = to
  if (to === 'RUNNING') lab.startedAt = new Date()
  await lab.save()

  return lab
}
```

**Things to notice:**

- `VALID_TRANSITIONS` is the state machine — it defines exactly which
  transitions are legal. `DESTROYED` and `FAILED` have empty arrays because
  they are terminal states — no recovery
- `canTransition()` is a pure function — it takes two values and returns
  true or false. Easy to test in isolation
- `createLab()` does two things: writes to MongoDB then publishes to
  RabbitMQ. Order matters — write first, then publish. If publishing fails
  you still have the record. If you published first and the DB write failed,
  the worker would receive a job for a lab that does not exist
- The service never returns a raw error to the caller — it logs the problem
  and throws a typed error

---

## Step 6 — domain/lab/lab.routes.ts

**What it does:** Defines the HTTP endpoints for labs. Route handlers are
thin — they parse the request, call a service function, and send a response.
No business logic lives here.

Create `src/domain/lab/lab.routes.ts`:

```typescript
import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { createLab, getLabById } from './lab.service'
import { logger } from '../../logger'

export const labRouter = Router()

const CreateLabSchema = z.object({
  scenarioId: z.string().min(1)
})

labRouter.post('/', async (req: Request, res: Response) => {
  const parsed = CreateLabSchema.safeParse(req.body)

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.format() })
  }

  try {
    const lab = await createLab(parsed.data.scenarioId)
    return res.status(202).json({ labId: lab._id, status: lab.status })
  } catch (err) {
    logger.error({ err, msg: 'Failed to create lab' })
    return res.status(500).json({ error: 'Internal server error' })
  }
})

labRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const lab = await getLabById(req.params.id)
    if (!lab) return res.status(404).json({ error: 'Lab not found' })
    return res.status(200).json(lab)
  } catch (err) {
    logger.error({ err, msg: 'Failed to get lab' })
    return res.status(500).json({ error: 'Internal server error' })
  }
})
```

**Things to notice:**

- `202 Accepted` not `201 Created` — 202 specifically means "request
  accepted, work is happening asynchronously." This is the correct HTTP
  status for async operations
- Validation happens at the route layer before anything else — bad requests
  never reach the service
- Route handlers only have three jobs: parse input, call service, send
  response. If you find yourself writing business logic in a route handler,
  move it to the service

---

## Step 7 — app.ts

**What it does:** Sets up the Express application — middleware and routes.
This is kept separate from `server.ts` so the app can be tested without
actually starting an HTTP server.

Create `src/app.ts`:

```typescript
import express, { Request, Response, NextFunction } from 'express'
import { labRouter } from './domain/lab/lab.routes'
import { logger } from './logger'

export const app = express()

app.use(express.json())

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' })
})

app.use('/labs', labRouter)

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, msg: 'Unhandled error' })
  res.status(500).json({ error: 'Internal server error' })
})
```

**Things to notice:**

- `express.json()` is middleware that parses incoming JSON request bodies —
  without this, `req.body` would be undefined
- `/health` is a simple endpoint that returns `{ status: 'ok' }`. Docker and
  Kubernetes use this to check if the service is alive
- The error handler at the bottom takes four parameters — Express recognizes
  a four-parameter middleware as an error handler specifically
- Routes are mounted at `/labs` — so `labRouter.post('/')` becomes
  `POST /labs` and `labRouter.get('/:id')` becomes `GET /labs/:id`

---

## Step 8 — server.ts

**What it does:** The entry point. Connects to infrastructure then starts
the HTTP server. If anything fails here the process exits immediately.

Create `src/server.ts`:

```typescript
import { connectDB } from './infrastructure/db'
import { connectQueue } from './infrastructure/queue'
import { logger } from './logger'
import { config } from './config'
import { app } from './app'

async function start() {
  try {
    await connectDB()
    await connectQueue()

    app.listen(config.PORT, () => {
      logger.info({ msg: `Orchestrator running on port ${config.PORT}` })
    })
  } catch (err) {
    logger.error({ err, msg: 'Failed to start orchestrator' })
    process.exit(1)
  }
}

start()
```

**Things to notice:**

- Infrastructure connections happen before the HTTP server starts — if
  MongoDB or RabbitMQ are unavailable the service refuses to start cleanly
- `process.exit(1)` — exit code 1 signals failure. Docker and Kubernetes
  will see this and know the container failed to start
- `start()` is an async function called immediately at the bottom — this is
  the standard pattern for async Node.js entry points

---

## When You Are Done

Your `src/` folder should contain:

```
src/
  config.ts
  logger.ts
  app.ts
  server.ts
  infrastructure/
    db.ts
    queue.ts
  domain/
    lab/
      lab.model.ts
      lab.service.ts
      lab.routes.ts
```

Do not try to run anything yet — MongoDB and RabbitMQ are not running
locally. The next step after this is setting up Docker Compose to run all
the infrastructure together, then we will start everything up and test it.

---

## Questions to Think About While You Work

These are not busywork — think through them as you type each file:

1. Why does `server.ts` connect to the DB before starting the HTTP server?
2. What happens if `publishJob()` is called before `connectQueue()` has run?
3. Why does `createLab()` write to MongoDB before publishing to RabbitMQ?
4. What does the `canTransition()` function protect against in practice?
5. Why does `GET /labs/:id` return a 404 instead of a 500 when a lab is
   not found?

Bring your answers when we pick this back up — they will shape the next
conversation.
