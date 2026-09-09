import express, { Request, Response, NextFunction } from 'express'
import { labRouter } from "./domain/lab/lab.routes"
import { logger } from './logger'

export const app = express()

app.use(express.json())

app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' })
})

app.use('/labs', labRouter)

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err, msg: 'Unhandled error'})
    res.status(500).json({ error: 'Internal server error'})
})