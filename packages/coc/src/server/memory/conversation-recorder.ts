/**
 * Conversation Recorder
 *
 * Records user messages as memory notes so they appear in the repo memory feed.
 * Uses the same FileMemoryStore + repo-scoped path as manual notes.
 */

import { readMemoryConfig } from './memory-config-handler';
import { FileMemoryStore } from './memory-store';
import { getRepoDataPath } from '../paths';

/**
 * Persist a user message as a repo-scoped memory note with source 'conversation'.
 * Silently no-ops when recording is disabled or on any storage error.
 */
export function recordUserMessage(
    dataDir: string,
    workspaceId: string,
    content: string,
): void {
    const config = readMemoryConfig(dataDir);
    if (!config.recording.enabled) return;

    const noteDir = getRepoDataPath(dataDir, workspaceId, 'memory');
    const store = new FileMemoryStore(noteDir);
    store.create({ content, source: 'conversation', tags: [] });
}
