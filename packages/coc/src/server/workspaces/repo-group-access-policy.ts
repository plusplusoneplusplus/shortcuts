import * as fs from 'fs';
import * as path from 'path';
import type { RepoGroupMember } from './repo-group-workspace';

export class RepoGroupAccessPolicyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RepoGroupAccessPolicyError';
    }
}

function normalizeForCompare(
    value: string,
    platform: NodeJS.Platform,
): string {
    const pathApi = platform === 'win32' ? path.win32 : path.posix;
    const resolved = pathApi.resolve(value);
    const withoutTrailingSeparators = resolved.replace(/[\\/]+$/, '') || pathApi.sep;
    return platform === 'win32' || platform === 'darwin'
        ? withoutTrailingSeparators.toLowerCase()
        : withoutTrailingSeparators;
}

export function repoGroupRootsOverlap(
    left: string,
    right: string,
    platform: NodeJS.Platform = process.platform,
): boolean {
    const pathApi = platform === 'win32' ? path.win32 : path.posix;
    const leftKey = normalizeForCompare(left, platform);
    const rightKey = normalizeForCompare(right, platform);
    return (
        leftKey === rightKey
        || leftKey.startsWith(rightKey + pathApi.sep)
        || rightKey.startsWith(leftKey + pathApi.sep)
    );
}

export interface RepoGroupAccessPolicy {
    liveMembers: Array<RepoGroupMember & { rootPath: string }>;
    writableDirectories: string[];
    readOnlyDirectories: string[];
}

export function buildRepoGroupAccessPolicy(members: readonly RepoGroupMember[]): RepoGroupAccessPolicy {
    const liveMembers = members.flatMap(member => {
        if (member.stale || typeof member.rootPath !== 'string' || member.rootPath.length === 0) {
            return [];
        }
        try {
            return [{ ...member, rootPath: fs.realpathSync.native(member.rootPath) }];
        } catch {
            return [];
        }
    });

    const writableDirectories = liveMembers
        .filter(member => !member.readOnly)
        .map(member => member.rootPath);
    const readOnlyDirectories = liveMembers
        .filter(member => member.readOnly)
        .map(member => member.rootPath);

    for (const writable of writableDirectories) {
        for (const readOnly of readOnlyDirectories) {
            if (repoGroupRootsOverlap(writable, readOnly)) {
                throw new RepoGroupAccessPolicyError(
                    `Repo group read-only and read-write roots overlap: "${readOnly}" and "${writable}"`,
                );
            }
        }
    }

    return { liveMembers, writableDirectories, readOnlyDirectories };
}
