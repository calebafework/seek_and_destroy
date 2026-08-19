import mongoose, { Schema, Document } from "mongoose"
import { LabStatus } from '@vulnlab/shared'

export interface ILab extends Document {
    scenarioId: string
    status: LabStatus
    accessUrl?: string
    containerId?: string
    networkId?: string
    startedAt?: Date
    createdAt?: Date
    updatedAt?: Date
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