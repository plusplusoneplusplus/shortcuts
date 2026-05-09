import { getSpaCocClient } from '../../api/cocClient';

/**
 * Pin a process.
 */
export async function pinProcess(id: string): Promise<void> {
  await getSpaCocClient().processes.pin(id, true);
}

/**
 * Unpin a process.
 */
export async function unpinProcess(id: string): Promise<void> {
  await getSpaCocClient().processes.pin(id, false);
}

/**
 * Archive a single process.
 */
export async function archiveProcess(id: string): Promise<void> {
  await getSpaCocClient().processes.archive(id, true);
}

/**
 * Unarchive a single process.
 */
export async function unarchiveProcess(id: string): Promise<void> {
  await getSpaCocClient().processes.archive(id, false);
}

/**
 * Batch archive multiple processes.
 */
export async function archiveProcesses(ids: string[]): Promise<void> {
  await getSpaCocClient().processes.archiveBatch(ids);
}

/**
 * Batch unarchive multiple processes.
 */
export async function unarchiveProcesses(ids: string[]): Promise<void> {
  await getSpaCocClient().processes.unarchiveBatch(ids);
}
