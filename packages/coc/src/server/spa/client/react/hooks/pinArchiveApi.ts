import { getApiBase } from '../utils/config';

/**
 * Pin a process.
 */
export async function pinProcess(id: string): Promise<void> {
  const url = getApiBase() + '/processes/' + encodeURIComponent(id) + '/pin';
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinned: true }),
  });
  if (!res.ok) throw new Error(`Failed to pin process: ${res.status}`);
}

/**
 * Unpin a process.
 */
export async function unpinProcess(id: string): Promise<void> {
  const url = getApiBase() + '/processes/' + encodeURIComponent(id) + '/pin';
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinned: false }),
  });
  if (!res.ok) throw new Error(`Failed to unpin process: ${res.status}`);
}

/**
 * Archive a single process.
 */
export async function archiveProcess(id: string): Promise<void> {
  const url = getApiBase() + '/processes/' + encodeURIComponent(id) + '/archive';
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived: true }),
  });
  if (!res.ok) throw new Error(`Failed to archive process: ${res.status}`);
}

/**
 * Unarchive a single process.
 */
export async function unarchiveProcess(id: string): Promise<void> {
  const url = getApiBase() + '/processes/' + encodeURIComponent(id) + '/archive';
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived: false }),
  });
  if (!res.ok) throw new Error(`Failed to unarchive process: ${res.status}`);
}

/**
 * Batch archive multiple processes.
 */
export async function archiveProcesses(ids: string[]): Promise<void> {
  const url = getApiBase() + '/processes/archive';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`Failed to batch archive: ${res.status}`);
}

/**
 * Batch unarchive multiple processes.
 */
export async function unarchiveProcesses(ids: string[]): Promise<void> {
  const url = getApiBase() + '/processes/unarchive';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`Failed to batch unarchive: ${res.status}`);
}
