/**
 * My Work Workspace bootstrapper.
 *
 * Creates a virtual workspace backed by `~/.coc/repos/my_work/`
 * that serves as the home/landing page for non-code work:
 * action items, follow-ups, and weekly summaries — all stored as notes.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';

export const MY_WORK_WORKSPACE_ID = 'my_work';
export const MY_WORK_WORKSPACE_NAME = 'My Work';

/** Default note files pre-created on first access. */
const DEFAULT_NOTES: { relativePath: string; content: string }[] = [
    {
        relativePath: 'Action Items.md',
        content: '# Action Items\n\nTrack your tasks and action items here. Use checkboxes to mark progress.\n\n- [ ] Example: Add your first action item\n',
    },
    {
        relativePath: 'Follow Ups.md',
        content: '# Follow Ups\n\nTrack items you\'re waiting on from others, grouped by person.\n\n## Example Person\n- [ ] Waiting on reply about project timeline\n',
    },
];

/**
 * Ensure the My Work workspace directory exists, is registered in the store,
 * and contains the conventional notes structure.
 * Idempotent — safe to call on every server restart.
 */
export async function ensureMyWorkWorkspace(dataDir: string, store: ProcessStore): Promise<WorkspaceInfo> {
    const rootPath = path.join(dataDir, 'repos', MY_WORK_WORKSPACE_ID);
    const notesDir = path.join(rootPath, 'notes');
    const weeklyDir = path.join(notesDir, 'Weekly');

    // Create directory structure
    fs.mkdirSync(weeklyDir, { recursive: true });

    // Pre-create default note files (only if they don't exist)
    for (const note of DEFAULT_NOTES) {
        const filePath = path.join(notesDir, note.relativePath);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, note.content, 'utf-8');
        }
    }

    const ws: WorkspaceInfo = {
        id: MY_WORK_WORKSPACE_ID,
        name: MY_WORK_WORKSPACE_NAME,
        rootPath,
        virtual: true,
    };
    await store.registerWorkspace(ws);
    return ws;
}
