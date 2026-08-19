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
    logger.info({ msg: 'RabbitMQ connected'})
}

export function publishJob(message: JobMessage): void {
    channel.sendToQueue(
        QUEUES.LAB_JOBS,
        Buffer.from(JSON.stringify(message)),
        { persistent: true }
    )
    logger.info({ jobType: message.jobType, labId: message.labId, msg: 'Job published' })
}