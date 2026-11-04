import { getRepoDataPath } from '../paths';

/** Managed storage only; configured and task-derived roots use notes-root-resolver. */
export function getNotesRoot(dataDir: string, workspaceId: string): string {
    return getRepoDataPath(dataDir, workspaceId, 'notes');
}
