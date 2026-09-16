import { z } from 'zod'

const schema = z.object({
    MONGO_URI: z.string().min(1),
    RABBITMQ_URI: z.string().min(1),
    NODE_ENV: z.enum(['development','production','test']).default('development')
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.format())
    process.exit(1)
}

export const config = parsed.data