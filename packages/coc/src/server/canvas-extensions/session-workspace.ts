import { promises as fs } from 'fs';
import * as path from 'path';
import { getRepoDataPath } from '../paths';

export interface SessionOwner {
    workspaceId: string;
    processId: string;
}

function validWorkspaceId(workspaceId: string): boolean {
    return !!workspaceId && workspaceId !== '.' && workspaceId !== '..' && !/[\\/:]/.test(workspaceId);
}

function stateRoot(dataDir: string, workspaceId: string): string {
    if (!validWorkspaceId(workspaceId)) {
        throw new Error('Invalid canvas workspace ID');
    }
    return path.resolve(getRepoDataPath(dataDir, workspaceId, path.join('canvas-ext', 'session-state')));
}

export function sessionWorkspacePath(dataDir: string, owner: SessionOwner): string {
    const bytes = Buffer.from(owner.processId, 'utf8');
    if (!owner.processId || bytes.toString('utf8') !== owner.processId) {
        throw new Error('Invalid canvas conversation ID');
    }
    return path.join(stateRoot(dataDir, owner.workspaceId), `p-${bytes.toString('hex')}`);
}

async function directories(directory: string): Promise<string[]> {
    try {
        return (await fs.readdir(directory, { withFileTypes: true }))
            .filter(entry => entry.isDirectory()).map(entry => entry.name);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return []; }
        throw error;
    }
}

/** Enumerate persisted owners even when their extension runtimes have stopped. */
export async function listSessionWorkspaceOwners(dataDir: string): Promise<SessionOwner[]> {
    const owners: SessionOwner[] = [];
    for (const workspaceId of await directories(path.resolve(dataDir, 'repos'))) {
        if (!validWorkspaceId(workspaceId)) { continue; }
        for (const name of await directories(stateRoot(dataDir, workspaceId))) {
            if (!/^p-(?:[0-9a-f]{2})+$/.test(name)) { continue; }
            const processId = Buffer.from(name.slice(2), 'hex').toString('utf8');
            if (`p-${Buffer.from(processId, 'utf8').toString('hex')}` === name) {
                owners.push({ workspaceId, processId });
            }
        }
    }
    return owners;
}
