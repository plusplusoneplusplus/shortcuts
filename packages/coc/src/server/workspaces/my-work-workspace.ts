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
 * Seed the My Work default notes (and the `Weekly` folder) — but only on first
 * initialization. "First initialization" means the `notes/` directory does not
 * yet exist; once it does, seeding is skipped forever so that deleting an
 * individual note never brings it back.
 *
 * @returns `true` if the defaults were seeded, `false` if the workspace was
 *          already initialized and seeding was skipped.
 */
export function seedMyWorkDefaultNotes(rootPath: string): boolean {
    const notesDir = path.join(rootPath, 'notes');

    // First-run guard: an existing notes/ dir means this workspace has already
    // been initialized (or the user has been using it). Never re-seed.
    if (fs.existsSync(notesDir)) {
        return false;
    }

    const weeklyDir = path.join(notesDir, 'Weekly');
    fs.mkdirSync(weeklyDir, { recursive: true });

    for (const note of DEFAULT_NOTES) {
        const filePath = path.join(notesDir, note.relativePath);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, note.content, 'utf-8');
        }
    }

    return true;
}

/**
 * Ensure the My Work workspace directory exists and is registered in the store.
 * Idempotent — safe to call on every server restart.
 *
 * Default notes are seeded only when `enabled` is true AND the workspace has
 * never been initialized (see {@link seedMyWorkDefaultNotes}). Registration
 * itself never creates the `notes/` directory, so an existing `notes/` dir is a
 * reliable "already initialized" marker for both this startup path and the
 * runtime off→on enablement path.
 */
export async function ensureMyWorkWorkspace(
    dataDir: string,
    store: ProcessStore,
    enabled = false,
): Promise<WorkspaceInfo> {
    const rootPath = path.join(dataDir, 'repos', MY_WORK_WORKSPACE_ID);

    // Registration path (always runs): ensure the workspace root exists. Do NOT
    // create notes/ here — its absence is the first-run seeding signal.
    fs.mkdirSync(rootPath, { recursive: true });

    // Seeding path (guarded): defaults appear only when the feature is enabled
    // and the workspace has not been initialized yet.
    if (enabled) {
        seedMyWorkDefaultNotes(rootPath);
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
