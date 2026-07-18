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
 * Seed the My Life default notes (and the `Weekly` folder) — but only on first
 * initialization. "First initialization" means the `notes/` directory does not
 * yet exist; once it does, seeding is skipped forever so that deleting an
 * individual note never brings it back.
 *
 * @returns `true` if the defaults were seeded, `false` if the workspace was
 *          already initialized and seeding was skipped.
 */
export function seedMyLifeDefaultNotes(rootPath: string): boolean {
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
 * Ensure the My Life workspace directory exists and is registered in the store.
 * Idempotent — safe to call on every server restart.
 *
 * Default notes are seeded only when `enabled` is true AND the workspace has
 * never been initialized (see {@link seedMyLifeDefaultNotes}). Registration
 * itself never creates the `notes/` directory, so an existing `notes/` dir is a
 * reliable "already initialized" marker for both this startup path and the
 * runtime off→on enablement path.
 */
export async function ensureMyLifeWorkspace(
    dataDir: string,
    store: ProcessStore,
    enabled = false,
): Promise<WorkspaceInfo> {
    const rootPath = path.join(dataDir, 'repos', MY_LIFE_WORKSPACE_ID);

    // Registration path (always runs): ensure the workspace root exists. Do NOT
    // create notes/ here — its absence is the first-run seeding signal.
    fs.mkdirSync(rootPath, { recursive: true });

    // Seeding path (guarded): defaults appear only when the feature is enabled
    // and the workspace has not been initialized yet.
    if (enabled) {
        seedMyLifeDefaultNotes(rootPath);
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
