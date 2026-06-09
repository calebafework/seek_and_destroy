// Lab lifecycle states - these are the ONLY valid states
export type LabStatus =
  | 'PENDING'
  | 'DEPLOYING'
  | 'RUNNING'
  | 'RESETTING'
  | 'DESTROYED'
  | 'FAILED'

export type JobType = 
  | 'lab.deploy'
  | 'lab.reset'
  | 'lab.destroy'

export interface JobMessage {
  jobType: JobType
  labId: string
  scenarioId: string
  timestamp: string
}

export type ScenarioCategory =
  | 'api-security'
  | 'kubernetes'
  | 'cloud-infrastructure'
  | 'application'

