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
    const docker = new Dockerode({ socketPath: '/var/run/docker.sock' })

    //scenario
    const image = 'ghcr.io/webgoat/webgoat:latest'
    const containerName = `lab-${message.labId}`
    const networkName = `network-${message.labId}`

    const network = await docker.createNetwork({
        Name: networkName,
        Driver: 'bridge'
    })

    await docker.pull(image)

    const container = await docker.createContainer({
        Image: image,
        name: containerName,
        ExposedPorts: { '8080/tcp': {} },
        HostConfig: {
            NetworkMode: networkName,
            PortBindings: {
                '8080/tcp': [{ HostPort: '0' }]
            }
        }
    })
    
    await container.start()

    logger.info({ labId: message.labId, containerName, msg: 'Container started' })

    const containerInfo = await container.inspect()
    const assignedPort = containerInfo.NetworkSettings.Ports['8080/tcp'][0].HostPort

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

