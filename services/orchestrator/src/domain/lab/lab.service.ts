import { v4 as uuidv4} from 'uuid'
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
    logger.info({ labId: lab._id, scenarioId, msg: 'Lab created and job published'})

    return lab
}

export async function getLabById(LabId: string): Promise<ILab | null> {
    return Lab.findById(LabId)
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