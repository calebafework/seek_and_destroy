import amqplib from 'amqplib'
import { connectDB } from './db'
import { config } from './config'
import { logger } from './logger'
import { JobMessage } from '@vulnlab/shared'
import { handleDeploy } from './handlers/deploy'


async function start(): Promise<void> {
    try {
        //connect mongo
        await connectDB()
        //connect rabbit
        const connection = await amqplib.connect(config.RABBITMQ_URI)
        const channel = await connection.createChannel()
            
        //assert queue
        await channel.assertQueue('lab.jobs', { durable: true })
        logger.info({ msg: 'worker connected to RabbitMQ'})
        
        //start consuming
        channel.consume('lab.jobs', async (msg) => {
            if (!msg) return

            const content = JSON.parse(msg.content.toString()) as JobMessage
            logger.info({ jobType: content.jobType, labId: content.labId, msg: 'Received job' })

            if (content.jobType === 'lab.deploy') {
                await handleDeploy(content)
            }

            channel.ack(msg)
        })

    } catch (err){
        //log and exit
        logger.error({ err, msg: 'Failed to start worker' })
        process.exit(1)

    }
}

start()