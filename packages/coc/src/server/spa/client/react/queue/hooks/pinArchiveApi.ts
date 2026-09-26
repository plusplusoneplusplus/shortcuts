import type { PinOrderEntry, PinOrderResponse } from '@plusplusoneplusplus/coc-client';
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

/** Reorder the Pinned section. Clone-routed so a remote clone's order lands on its own server. */
export async function setPinOrder(workspaceId: string, entries: PinOrderEntry[]): Promise<PinOrderResponse> {
  return getCocClientForWorkspace(workspaceId).processes.setPinOrder(workspaceId, entries);
}
