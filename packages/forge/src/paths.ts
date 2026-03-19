import path from 'path';

/** Returns the canonical path for a repo-scoped data file: <dataDir>/repos/<workspaceId>/<filename> */
export function getRepoDataPath(dataDir: string, workspaceId: string, filename: string): string {
    return path.join(dataDir, 'repos', workspaceId, filename);
}
