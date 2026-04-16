import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import { ensureMyLifeWorkspace, MY_LIFE_WORKSPACE_ID, MY_LIFE_WORKSPACE_NAME } from '../../src/server/my-life-workspace';

describe('ensureMyLifeWorkspace', () => {
    let tmpDir: string;
    let store: FileProcessStore;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-my-life-'));
        store = new FileProcessStore(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates the my_life directory structure', async () => {
        await ensureMyLifeWorkspace(tmpDir, store);

        const repoDir = path.join(tmpDir, 'repos', 'my_life');
        const notesDir = path.join(repoDir, 'notes');
        const weeklyDir = path.join(notesDir, 'Weekly');

        expect(fs.existsSync(repoDir)).toBe(true);
        expect(fs.existsSync(notesDir)).toBe(true);
        expect(fs.existsSync(weeklyDir)).toBe(true);
    });

    it('creates default note files', async () => {
        await ensureMyLifeWorkspace(tmpDir, store);

        const notesDir = path.join(tmpDir, 'repos', 'my_life', 'notes');
        const goalsPath = path.join(notesDir, 'Goals.md');
        const journalPath = path.join(notesDir, 'Journal.md');

        expect(fs.existsSync(goalsPath)).toBe(true);
        expect(fs.existsSync(journalPath)).toBe(true);

        const goalsContent = fs.readFileSync(goalsPath, 'utf-8');
        expect(goalsContent).toContain('# Goals');
        expect(goalsContent).toContain('personal goal');

        const journalContent = fs.readFileSync(journalPath, 'utf-8');
        expect(journalContent).toContain('# Journal');
        expect(journalContent).toContain('reflections');
    });

    it('returns the correct workspace info', async () => {
        const ws = await ensureMyLifeWorkspace(tmpDir, store);

        expect(ws.id).toBe(MY_LIFE_WORKSPACE_ID);
        expect(ws.name).toBe(MY_LIFE_WORKSPACE_NAME);
        expect(ws.virtual).toBe(true);
        expect(ws.rootPath).toBe(path.join(tmpDir, 'repos', 'my_life'));
    });

    it('registers the workspace in the store', async () => {
        await ensureMyLifeWorkspace(tmpDir, store);

        const workspaces = await store.getWorkspaces();
        const myLife = workspaces.find(w => w.id === MY_LIFE_WORKSPACE_ID);
        expect(myLife).toBeDefined();
        expect(myLife!.name).toBe(MY_LIFE_WORKSPACE_NAME);
        expect(myLife!.virtual).toBe(true);
    });

    it('is idempotent — calling twice does not duplicate or overwrite', async () => {
        await ensureMyLifeWorkspace(tmpDir, store);

        // Modify a file
        const goalsPath = path.join(tmpDir, 'repos', 'my_life', 'notes', 'Goals.md');
        fs.writeFileSync(goalsPath, '# My Custom Goals\n', 'utf-8');

        await ensureMyLifeWorkspace(tmpDir, store);

        // File should NOT be overwritten
        const content = fs.readFileSync(goalsPath, 'utf-8');
        expect(content).toBe('# My Custom Goals\n');

        // Should still be only one workspace registered
        const workspaces = await store.getWorkspaces();
        const myLifeWorkspaces = workspaces.filter(w => w.id === MY_LIFE_WORKSPACE_ID);
        expect(myLifeWorkspaces.length).toBe(1);
    });

    it('exports the correct constants', () => {
        expect(MY_LIFE_WORKSPACE_ID).toBe('my_life');
        expect(MY_LIFE_WORKSPACE_NAME).toBe('My Life');
    });
});
