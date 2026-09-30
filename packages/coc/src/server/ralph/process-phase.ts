/**
 * Mirror a Ralph session phase onto one iteration process's
 * `metadata.ralph.phase`.
 *
 * Chat-list history items forward `proc.metadata.ralph` verbatim, so this is
 * how the SPA learns a session is parked in `awaiting-input` (attention
 * marker on the Ralph session row) without reading every `session.json`.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { RalphSessionPhase } from './types';

/**
 * Returns true when the process was found and updated. Processes without Ralph
 * metadata are left alone.
 */
export async function setRalphProcessPhase(
    store: ProcessStore | undefined,
    processId: string | undefined,
    phase: RalphSessionPhase,
): Promise<boolean> {
    if (!store || !processId) return false;
    const proc = await store.getProcess(processId);
    const metadata = proc?.metadata as Record<string, unknown> | undefined;
    const ralph = metadata?.ralph as Record<string, unknown> | undefined;
    if (!proc || !metadata || !ralph || typeof ralph !== 'object') return false;
    if (ralph.phase === phase) return true;
    await store.updateProcess(processId, {
        metadata: { ...metadata, ralph: { ...ralph, phase } } as any,
    });
    return true;
}
