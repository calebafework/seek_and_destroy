import { Router, Request, Response } from "express"
import { z } from "zod"
import { createLab, getLabById } from "./lab.service"
import { logger } from "../../logger"

export const labRouter = Router()

const CreateLabSchema = z.object({
    scenarioId:  z.string().min(1)
})

labRouter.post('/', async (req: Request, res: Response) =>{
    const parsed = CreateLabSchema.safeParse(req.body)

    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.format() })
    }

    try {
        const lab = await createLab(parsed.data.scenarioId)
        return res.status(202).json({ labId: lab._id, status: lab.status })
    } catch (err) {
        logger.error({ err, msg: 'Failed to create lab' })
        return res.status(500).json({ error: 'Internal server error'})
    }
})

labRouter.get('/:id', async (req: Request, res: Response) => {
    try {
        const lab = await getLabById(req.params.id)
       
         if (!lab) {
            return res.status(404).json({ error: 'Lab not found' })
        }
        return res.status(200).json(lab)
    } catch (err) {
        logger.error({ err, msg: 'Failed to fetch lab' })
        return res.status(500).json({ error: 'Internal server error'})
    }
    
})