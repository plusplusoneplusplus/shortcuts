import { promises as fs } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { resolvePathForHostFilesystem, resolveSkillWithDetails, type ProcessStore } from '@plusplusoneplusplus/forge';
import type { CLIConfig } from '../../config';
import { resolveSkillConfig } from '../executors/skill-config-resolver';
import { isRepoGroupWorkspaceId } from '../workspaces/repo-group-workspace';

export interface TeamsReactionDispatcher {
    workspaceId: string;
    workingDirectory: string;
    dispatcherSkill: string;
    dispatcherSkillPath: string;
}

/** Resolve a fresh binding before reaction job admission; never use the UI skill cache. */
export async function resolveTeamsReactionDispatcher(
    store: ProcessStore,
    dataDir: string,
    config: Pick<CLIConfig, 'features' | 'teamsReactionDelegation' | 'skills'>,
    signal: AbortSignal,
): Promise<TeamsReactionDispatcher> {
    signal.throwIfAborted();
    if (config.features?.teamsReactionDelegation !== true) {
        throw new Error('Teams reaction delegation is disabled.');
    }
    const { workspaceId, dispatcherSkill } = config.teamsReactionDelegation ?? {};
    if (!workspaceId || !dispatcherSkill) throw new Error('Teams reaction dispatcher binding is incomplete.');
    if (!/^[a-zA-Z0-9_-]{1,256}$/.test(workspaceId)
        || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/.test(dispatcherSkill) || dispatcherSkill.includes('..')) {
        throw new Error('Invalid Teams reaction dispatcher binding.');
    }
    const workspace = (await store.getWorkspaces()).find(item => item.id === workspaceId);
    signal.throwIfAborted();
    if (!workspace || (workspace.virtual && !isRepoGroupWorkspaceId(workspaceId)) || !isAbsolute(workspace.rootPath)
        || !(await fs.stat(workspace.rootPath)).isDirectory()) {
        throw new Error('Teams reaction execution workspace is unavailable.');
    }
    const { skillDirectories, disabledSkills } = await resolveSkillConfig(
        store, dataDir, workspaceId, workspace.rootPath, { ...config.skills, strict: true },
    );
    signal.throwIfAborted();
    if (disabledSkills?.includes(dispatcherSkill)) throw new Error('Teams reaction dispatcher skill is disabled.');
    for (const directory of skillDirectories ?? []) {
        const hostDirectory = resolvePathForHostFilesystem(directory);
        const skillPath = join(hostDirectory, dispatcherSkill);
        const exists = await fs.stat(skillPath).then(() => true).catch(error => {
            if (error.code !== 'ENOENT') throw error;
            return false;
        });
        signal.throwIfAborted();
        if (!exists) continue;
        const skill = await resolveSkillWithDetails(dispatcherSkill, workspace.rootPath, hostDirectory);
        signal.throwIfAborted();
        return { workspaceId, workingDirectory: workspace.rootPath, dispatcherSkill,
            dispatcherSkillPath: skill.resolvedPath };
    }
    throw new Error('Teams reaction dispatcher skill is unavailable.');
}
