/**
 * Notes Edit REST API Handler
 *
 * HTTP API routes for retrieving note edit snapshots and undoing AI edits.
 * Snapshots are stored in process.metadata.noteEdits by NoteChatExecutor
 * and FollowUpExecutor.
 */

import * as fs from 'fs';
import * as path from 'path';
import { sendJSON } from './api-handler';
import { getRepoDataPath } from './paths';
import type { Route } from './types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { NoteEditSnapshot } from './executors/note-chat-executor';

// ============================================================================
// Route registration
// ============================================================================

export function registerNotesEditsRoutes(routes: Route[], store: ProcessStore, dataDir: string): void {
    // GET /api/processes/:id/note-edits — list note edit snapshots
    routes.push({
        method: 'GET',
        pattern: /^\/api\/processes\/([^/]+)\/note-edits$/,
        handler: async (_req, res, match) => {
            const processId = decodeURIComponent(match![1]);
            try {
                const process = await store.getProcess(processId);
                if (!process) {
                    sendJSON(res, 404, { error: 'Process not found' });
                    return;
                }
                const noteEdits: NoteEditSnapshot[] =
                    (process.metadata?.noteEdits as NoteEditSnapshot[] | undefined) ?? [];
                sendJSON(res, 200, noteEdits);
            } catch {
                sendJSON(res, 500, { error: 'Failed to fetch note edits' });
            }
        },
    });

    // POST /api/processes/:id/note-edits/:editId/undo — revert a note edit
    routes.push({
        method: 'POST',
        pattern: /^\/api\/processes\/([^/]+)\/note-edits\/([^/]+)\/undo$/,
        handler: async (req, res, match) => {
            const processId = decodeURIComponent(match![1]);
            const editId = decodeURIComponent(match![2]);

            try {
                const process = await store.getProcess(processId);
                if (!process) {
                    sendJSON(res, 404, { error: 'Process not found' });
                    return;
                }

                const noteEdits: NoteEditSnapshot[] =
                    (process.metadata?.noteEdits as NoteEditSnapshot[] | undefined) ?? [];
                const snapshot = noteEdits.find(e => e.editId === editId);
                if (!snapshot) {
                    sendJSON(res, 404, { error: 'Edit snapshot not found' });
                    return;
                }

                if (snapshot.tooLarge) {
                    sendJSON(res, 400, { error: 'Content too large to undo' });
                    return;
                }

                if (!snapshot.preEditContent && !snapshot.tooLarge) {
                    sendJSON(res, 400, { error: 'No pre-edit content available' });
                    return;
                }

                const wsId = (process.metadata?.workspaceId as string) ?? '';
                if (!wsId) {
                    sendJSON(res, 400, { error: 'No workspace ID on process' });
                    return;
                }

                // Resolve the note file path with security check
                const notesRoot = getRepoDataPath(dataDir, wsId, 'notes');
                const resolved = path.resolve(notesRoot, snapshot.notePath);
                const normalizedResolved = path.normalize(resolved);
                const normalizedRoot = path.normalize(notesRoot);
                if (!normalizedResolved.startsWith(normalizedRoot)) {
                    sendJSON(res, 400, { error: 'Invalid note path' });
                    return;
                }

                // Check for query params
                const urlObj = new URL(req.url ?? '', `http://${req.headers.host}`);
                const force = urlObj.searchParams.get('force') === 'true';

                // Check if note was modified since the AI edit
                if (!force) {
                    try {
                        const current = await fs.promises.readFile(resolved, 'utf-8');
                        if (current !== snapshot.postEditContent) {
                            sendJSON(res, 409, {
                                error: 'Note modified since this edit',
                                reason: 'modified',
                            });
                            return;
                        }
                    } catch {
                        // File may have been deleted — proceed with undo (creates file)
                    }
                }

                // Write the pre-edit content back
                await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
                await fs.promises.writeFile(resolved, snapshot.preEditContent, 'utf-8');

                // The notes file watcher will detect the change and emit
                // a notes-changed WebSocket event automatically.

                sendJSON(res, 200, { success: true });
            } catch {
                sendJSON(res, 500, { error: 'Failed to undo note edit' });
            }
        },
    });
}
