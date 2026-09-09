import { app } from './app'
import { connectQueue } from './infrastructure/queue'
import { connectDB } from './infrastructure/db'
import { config } from './config'
import { logger } from './logger'

async function start(): Promise<void> {
    try {
        // connect to mongo
        await connectDB()
        //connect queue
        await connectQueue()
        // start http server
        app.listen(config.PORT, () => {
            logger.info({ msg: `Orchestrator running on port ${config.PORT}` })
        })

    } catch (error: unknown ){
        //if error, log exit
        logger.error({ err: error, msg: 'Failed to start orchestrator' })
        process.exit(1)
    }
}

start()
