/**
 * My Life Workspace bootstrapper.
 *
 * Creates a virtual workspace backed by `~/.coc/repos/my_life/`
 * that serves as a personal space for non-work items:
 * goals, journal entries, and life admin — all stored as notes.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';

export const MY_LIFE_WORKSPACE_ID = 'my_life';
export const MY_LIFE_WORKSPACE_NAME = 'My Life';

/** Default note files pre-created on first access. */
const DEFAULT_NOTES: { relativePath: string; content: string }[] = [
    {
        relativePath: 'Goals.md',
        content: '# Goals\n\nTrack your personal goals here. Use checkboxes to mark progress.\n\n- [ ] Example: Add your first personal goal\n',
    },
    {
        relativePath: 'Journal.md',
        content: '# Journal\n\nA space for personal reflections, ideas, and daily notes.\n\n## Today\n- What went well?\n- What could be better?\n',
    },
];

/**
 * Ensure the My Life workspace directory exists, is registered in the store,
 * and contains the conventional notes structure.
 * Idempotent — safe to call on every server restart.
 */
export async function ensureMyLifeWorkspace(dataDir: string, store: ProcessStore): Promise<WorkspaceInfo> {
    const rootPath = path.join(dataDir, 'repos', MY_LIFE_WORKSPACE_ID);
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
        id: MY_LIFE_WORKSPACE_ID,
        name: MY_LIFE_WORKSPACE_NAME,
        rootPath,
        virtual: true,
    };
    await store.registerWorkspace(ws);
    return ws;
}
