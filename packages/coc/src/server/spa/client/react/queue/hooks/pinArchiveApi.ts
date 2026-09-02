import { getCocClientForWorkspace } from '../../repos/cloneRegistry';

export async function pinProcess(id: string, workspaceId?: string): Promise<void> {
  await getCocClientForWorkspace(workspaceId).processes.pin(id, true);
}

export async function unpinProcess(id: string, workspaceId?: string): Promise<void> {
  await getCocClientForWorkspace(workspaceId).processes.pin(id, false);
}

export async function archiveProcess(id: string, workspaceId?: string): Promise<void> {
  await getCocClientForWorkspace(workspaceId).processes.archive(id, true);
}

export async function unarchiveProcess(id: string, workspaceId?: string): Promise<void> {
  await getCocClientForWorkspace(workspaceId).processes.archive(id, false);
}

export async function archiveProcesses(ids: string[], workspaceId?: string): Promise<void> {
  await getCocClientForWorkspace(workspaceId).processes.archiveBatch(ids);
}

export async function unarchiveProcesses(ids: string[], workspaceId?: string): Promise<void> {
  await getCocClientForWorkspace(workspaceId).processes.unarchiveBatch(ids);
}
