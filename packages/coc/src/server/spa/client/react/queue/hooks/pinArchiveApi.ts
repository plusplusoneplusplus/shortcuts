import { getCocClientForWorkspace } from '../../repos/cloneRegistry';

/**
 * Pin a process.
 */
export async function pinProcess(id: string, workspaceId?: string): Promise<void> {
  await getCocClientForWorkspace(workspaceId).processes.pin(id, true);
}

/**
 * Unpin a process.
 */
export async function unpinProcess(id: string, workspaceId?: string): Promise<void> {
  await getCocClientForWorkspace(workspaceId).processes.pin(id, false);
}

/**
 * Archive a single process.
 */
export async function archiveProcess(id: string, workspaceId?: string): Promise<void> {
  await getCocClientForWorkspace(workspaceId).processes.archive(id, true);
}

/**
 * Unarchive a single process.
 */
export async function unarchiveProcess(id: string, workspaceId?: string): Promise<void> {
  await getCocClientForWorkspace(workspaceId).processes.archive(id, false);
}

/**
 * Batch archive multiple processes.
 */
export async function archiveProcesses(ids: string[], workspaceId?: string): Promise<void> {
  await getCocClientForWorkspace(workspaceId).processes.archiveBatch(ids);
}

/**
 * Batch unarchive multiple processes.
 */
export async function unarchiveProcesses(ids: string[], workspaceId?: string): Promise<void> {
  await getCocClientForWorkspace(workspaceId).processes.unarchiveBatch(ids);
}
