import mongoose from 'mongoose'
import { config } from '../config'
import { logger } from '../logger'

export async function connectDB(): Promise<void> {
    mongoose.connection.on('disconnected', () => {
        logger.warn({ msg: 'MongoDB disconnected'})
    })
    await mongoose.connect(config.MONGO_URI)
    logger.info({ msg: 'MongoDB connected'})
}
