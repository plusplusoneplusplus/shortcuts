/**
 * My Work Workspace Tests
 *
 * Verifies that:
 * - ensureMyWorkWorkspace always creates the workspace root and registers it
 * - Default notes (Action Items.md, Follow Ups.md, Weekly/) are seeded ONLY when
 *   the feature is enabled AND the workspace has never been initialized
 * - Deleting a default note (or the Weekly folder) does not bring it back on a
 *   subsequent enabled call (first-run guard is notes-dir existence, not per-file)
 * - seedMyWorkDefaultNotes seeds a fresh workspace and skips an initialized one
 * - Returned workspace has correct id, name, virtual: true
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    ensureMyWorkWorkspace,
    seedMyWorkDefaultNotes,
    MY_WORK_WORKSPACE_ID,
    MY_WORK_WORKSPACE_NAME,
} from '../../src/server/workspaces/my-work-workspace';
import { FileProcessStore } from '@plusplusoneplusplus/forge';

describe('ensureMyWorkWorkspace', () => {
    let dataDir: string;
    let store: FileProcessStore;
    let rootPath: string;
    let notesDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'my-work-ws-test-'));
        store = new FileProcessStore({ dataDir });
        rootPath = path.join(dataDir, 'repos', MY_WORK_WORKSPACE_ID);
        notesDir = path.join(rootPath, 'notes');
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('creates the repos/my_work directory regardless of the flag', async () => {
        await ensureMyWorkWorkspace(dataDir, store, false);
        expect(fs.existsSync(rootPath)).toBe(true);
        expect(fs.statSync(rootPath).isDirectory()).toBe(true);
    });

    it('does NOT create notes or default files when the flag is OFF', async () => {
        await ensureMyWorkWorkspace(dataDir, store, false);
        expect(fs.existsSync(notesDir)).toBe(false);
        expect(fs.existsSync(path.join(notesDir, 'Action Items.md'))).toBe(false);
        expect(fs.existsSync(path.join(notesDir, 'Follow Ups.md'))).toBe(false);
        expect(fs.existsSync(path.join(notesDir, 'Weekly'))).toBe(false);
    });

    it('defaults to disabled when the flag is omitted', async () => {
        await ensureMyWorkWorkspace(dataDir, store);
        expect(fs.existsSync(notesDir)).toBe(false);
    });

    it('seeds the notes structure and default files when the flag is ON (fresh workspace)', async () => {
        await ensureMyWorkWorkspace(dataDir, store, true);

        expect(fs.statSync(notesDir).isDirectory()).toBe(true);
        expect(fs.statSync(path.join(notesDir, 'Weekly')).isDirectory()).toBe(true);

        const actionItems = fs.readFileSync(path.join(notesDir, 'Action Items.md'), 'utf-8');
        expect(actionItems).toContain('# Action Items');
        expect(actionItems).toContain('- [ ]');

        const followUps = fs.readFileSync(path.join(notesDir, 'Follow Ups.md'), 'utf-8');
        expect(followUps).toContain('# Follow Ups');
        expect(followUps).toContain('## Example Person');
    });

    it('returns workspace with correct id, name, and virtual flag', async () => {
        const ws = await ensureMyWorkWorkspace(dataDir, store, true);
        expect(ws.id).toBe(MY_WORK_WORKSPACE_ID);
        expect(ws.name).toBe(MY_WORK_WORKSPACE_NAME);
        expect(ws.virtual).toBe(true);
        expect(ws.rootPath).toBe(rootPath);
    });

    it('registers the workspace in the store even when the flag is OFF', async () => {
        await ensureMyWorkWorkspace(dataDir, store, false);
        const workspaces = await store.getWorkspaces();
        const myWork = workspaces.find(w => w.id === MY_WORK_WORKSPACE_ID);
        expect(myWork).toBeDefined();
        expect(myWork!.virtual).toBe(true);
        expect(myWork!.name).toBe(MY_WORK_WORKSPACE_NAME);
    });

    it('is idempotent — calling twice does not create duplicate entries', async () => {
        await ensureMyWorkWorkspace(dataDir, store, true);
        await ensureMyWorkWorkspace(dataDir, store, true);
        const workspaces = await store.getWorkspaces();
        const myWorks = workspaces.filter(w => w.id === MY_WORK_WORKSPACE_ID);
        expect(myWorks).toHaveLength(1);
    });

    it('does not overwrite user-modified files on a second enabled call', async () => {
        await ensureMyWorkWorkspace(dataDir, store, true);

        const filePath = path.join(notesDir, 'Action Items.md');
        fs.writeFileSync(filePath, '# My Custom Action Items\n- [x] Done item\n', 'utf-8');

        await ensureMyWorkWorkspace(dataDir, store, true);
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('# My Custom Action Items\n- [x] Done item\n');
    });

    it('does NOT recreate a deleted default note on restart with the flag ON', async () => {
        await ensureMyWorkWorkspace(dataDir, store, true);

        // User deletes one specific note, then restarts (notes/ dir still present).
        const filePath = path.join(notesDir, 'Action Items.md');
        fs.rmSync(filePath);
        expect(fs.existsSync(filePath)).toBe(false);

        await ensureMyWorkWorkspace(dataDir, store, true);
        expect(fs.existsSync(filePath)).toBe(false);
    });

    it('does NOT recreate a deleted Weekly folder on restart with the flag ON', async () => {
        await ensureMyWorkWorkspace(dataDir, store, true);

        const weeklyDir = path.join(notesDir, 'Weekly');
        fs.rmSync(weeklyDir, { recursive: true, force: true });
        expect(fs.existsSync(weeklyDir)).toBe(false);

        await ensureMyWorkWorkspace(dataDir, store, true);
        expect(fs.existsSync(weeklyDir)).toBe(false);
    });

    it('does not back-fill an already-initialized workspace when it boots enabled', async () => {
        // Simulate a pre-existing initialized workspace where the user deleted a note.
        await ensureMyWorkWorkspace(dataDir, store, true);
        const filePath = path.join(notesDir, 'Follow Ups.md');
        fs.rmSync(filePath);

        // Reboot with the flag already ON.
        await ensureMyWorkWorkspace(dataDir, store, true);
        expect(fs.existsSync(filePath)).toBe(false);
    });
});

describe('seedMyWorkDefaultNotes', () => {
    let dataDir: string;
    let rootPath: string;
    let notesDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'my-work-seed-test-'));
        rootPath = path.join(dataDir, 'repos', MY_WORK_WORKSPACE_ID);
        notesDir = path.join(rootPath, 'notes');
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('seeds a fresh workspace and reports it did so', () => {
        expect(seedMyWorkDefaultNotes(rootPath)).toBe(true);
        expect(fs.existsSync(path.join(notesDir, 'Action Items.md'))).toBe(true);
        expect(fs.existsSync(path.join(notesDir, 'Weekly'))).toBe(true);
    });

    it('skips seeding when the notes directory already exists (runtime re-toggle)', () => {
        fs.mkdirSync(notesDir, { recursive: true });

        expect(seedMyWorkDefaultNotes(rootPath)).toBe(false);
        // No default files written into an already-initialized workspace.
        expect(fs.existsSync(path.join(notesDir, 'Action Items.md'))).toBe(false);
    });
});
