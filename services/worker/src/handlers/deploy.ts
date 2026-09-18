import Dockerode from "dockerode"
import { Lab } from "../lab.model"
import { logger } from "../logger"
import { JobMessage } from "@vulnlab/shared"

export async function handleDeploy(message: JobMessage): Promise<void> {
    // update mongo to deploying
    const lab = await Lab.findByIdAndUpdate(
        message.labId,
        { status: 'DEPLOYING' },
        { new: true }
    )
    
    if (!lab) {
        logger.error({ labId: message.labId, msg: 'Lab not found' })
        return
    }

    try {
    // create docker client
    const docker = new Dockerode({ host: 'host.docker.internal', port: 2375 })

    //scenario
    const image = 'vulnerables/web-dvwa:latest'
    const containerName = `lab-${message.labId}`
    const networkName = `network-${message.labId}`

    logger.info({ labId: message.labId, msg: 'Creating network' })
    const network = await docker.createNetwork({
        Name: networkName,
        Driver: 'bridge'
    })

    logger.info({ labId: message.labId, msg: 'Pulling image' })
    await new Promise<void>((resolve, reject) => {
        docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
            if (err) return reject(err)
            docker.modem.followProgress(stream, (err: Error | null) => {
                if (err) return reject(err)
                resolve()
            })
        })
    })

    logger.info({ labId: message.labId, msg: 'Creating container' })
    const container = await docker.createContainer({
        Image: image,
        name: containerName,
        ExposedPorts: { '80/tcp': {} },
        HostConfig: {
            NetworkMode: networkName,
            PortBindings: {
                '80/tcp': [{ HostPort: '0' }]
            }
        }
    })
    
    logger.info({ labId: message.labId, msg: 'Starting container' })
    await container.start()

    const containerInfo = await container.inspect()
    const assignedPort = containerInfo.NetworkSettings.Ports['80/tcp'][0].HostPort

    const accessUrl = `http://localhost:${assignedPort}`

    //update lab to RUNNING
    await Lab.findByIdAndUpdate(message.labId, {
        status: 'RUNNING',
        containerId: container.id,
        networkId: network.id,
        accessUrl,
        startedAt: new Date()

    })

    logger.info({ labId: message.labId, accessUrl, msg: 'Lab is RUNNING' })

    } catch (err) {
        logger.error({ labId: message.labId, err, msg: 'Deployment failed' })
        await Lab.findByIdAndUpdate(message.labId, {status: 'FAILED' })
    }
}

