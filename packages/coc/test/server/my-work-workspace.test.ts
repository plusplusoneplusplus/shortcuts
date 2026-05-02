/**
 * My Work Workspace Tests
 *
 * Verifies that:
 * - ensureMyWorkWorkspace creates the directory structure
 * - Default notes (Action Items.md, Follow Ups.md, Weekly/) are pre-created
 * - Calling it twice does not overwrite existing files
 * - Returned workspace has correct id, name, virtual: true
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    ensureMyWorkWorkspace,
    MY_WORK_WORKSPACE_ID,
    MY_WORK_WORKSPACE_NAME,
} from '../../src/server/workspaces/my-work-workspace';
import { FileProcessStore } from '@plusplusoneplusplus/forge';

describe('ensureMyWorkWorkspace', () => {
    let dataDir: string;
    let store: FileProcessStore;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'my-work-ws-test-'));
        store = new FileProcessStore({ dataDir });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('creates the repos/my_work directory', async () => {
        await ensureMyWorkWorkspace(dataDir, store);
        const dir = path.join(dataDir, 'repos', MY_WORK_WORKSPACE_ID);
        expect(fs.existsSync(dir)).toBe(true);
        expect(fs.statSync(dir).isDirectory()).toBe(true);
    });

    it('creates the notes subdirectory', async () => {
        await ensureMyWorkWorkspace(dataDir, store);
        const notesDir = path.join(dataDir, 'repos', MY_WORK_WORKSPACE_ID, 'notes');
        expect(fs.existsSync(notesDir)).toBe(true);
        expect(fs.statSync(notesDir).isDirectory()).toBe(true);
    });

    it('creates the Weekly subdirectory', async () => {
        await ensureMyWorkWorkspace(dataDir, store);
        const weeklyDir = path.join(dataDir, 'repos', MY_WORK_WORKSPACE_ID, 'notes', 'Weekly');
        expect(fs.existsSync(weeklyDir)).toBe(true);
        expect(fs.statSync(weeklyDir).isDirectory()).toBe(true);
    });

    it('pre-creates Action Items.md with default content', async () => {
        await ensureMyWorkWorkspace(dataDir, store);
        const filePath = path.join(dataDir, 'repos', MY_WORK_WORKSPACE_ID, 'notes', 'Action Items.md');
        expect(fs.existsSync(filePath)).toBe(true);
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('# Action Items');
        expect(content).toContain('- [ ]');
    });

    it('pre-creates Follow Ups.md with default content', async () => {
        await ensureMyWorkWorkspace(dataDir, store);
        const filePath = path.join(dataDir, 'repos', MY_WORK_WORKSPACE_ID, 'notes', 'Follow Ups.md');
        expect(fs.existsSync(filePath)).toBe(true);
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('# Follow Ups');
        expect(content).toContain('## Example Person');
    });

    it('returns workspace with correct id, name, and virtual flag', async () => {
        const ws = await ensureMyWorkWorkspace(dataDir, store);
        expect(ws.id).toBe(MY_WORK_WORKSPACE_ID);
        expect(ws.name).toBe(MY_WORK_WORKSPACE_NAME);
        expect(ws.virtual).toBe(true);
        expect(ws.rootPath).toBe(path.join(dataDir, 'repos', MY_WORK_WORKSPACE_ID));
    });

    it('is idempotent — calling twice does not create duplicate entries', async () => {
        await ensureMyWorkWorkspace(dataDir, store);
        await ensureMyWorkWorkspace(dataDir, store);
        const workspaces = await store.getWorkspaces();
        const myWorks = workspaces.filter(w => w.id === MY_WORK_WORKSPACE_ID);
        expect(myWorks).toHaveLength(1);
    });

    it('does not overwrite user-modified files on second call', async () => {
        await ensureMyWorkWorkspace(dataDir, store);

        // User edits Action Items.md
        const filePath = path.join(dataDir, 'repos', MY_WORK_WORKSPACE_ID, 'notes', 'Action Items.md');
        fs.writeFileSync(filePath, '# My Custom Action Items\n- [x] Done item\n', 'utf-8');

        // Second call should not overwrite
        await ensureMyWorkWorkspace(dataDir, store);
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toBe('# My Custom Action Items\n- [x] Done item\n');
    });

    it('registers workspace in the store', async () => {
        await ensureMyWorkWorkspace(dataDir, store);
        const workspaces = await store.getWorkspaces();
        const myWork = workspaces.find(w => w.id === MY_WORK_WORKSPACE_ID);
        expect(myWork).toBeDefined();
        expect(myWork!.virtual).toBe(true);
        expect(myWork!.name).toBe(MY_WORK_WORKSPACE_NAME);
    });
});
