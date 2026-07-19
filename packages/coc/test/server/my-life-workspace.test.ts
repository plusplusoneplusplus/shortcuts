import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import {
    ensureMyLifeWorkspace,
    seedMyLifeDefaultNotes,
    MY_LIFE_WORKSPACE_ID,
    MY_LIFE_WORKSPACE_NAME,
} from '../../src/server/workspaces/my-life-workspace';

describe('ensureMyLifeWorkspace', () => {
    let tmpDir: string;
    let store: FileProcessStore;
    let rootPath: string;
    let notesDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-my-life-'));
        store = new FileProcessStore(tmpDir);
        rootPath = path.join(tmpDir, 'repos', 'my_life');
        notesDir = path.join(rootPath, 'notes');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates the my_life root regardless of the flag', async () => {
        await ensureMyLifeWorkspace(tmpDir, store, false);
        expect(fs.existsSync(rootPath)).toBe(true);
        expect(fs.statSync(rootPath).isDirectory()).toBe(true);
    });

    it('does NOT create notes or default files when the flag is OFF', async () => {
        await ensureMyLifeWorkspace(tmpDir, store, false);
        expect(fs.existsSync(notesDir)).toBe(false);
        expect(fs.existsSync(path.join(notesDir, 'Goals.md'))).toBe(false);
        expect(fs.existsSync(path.join(notesDir, 'Journal.md'))).toBe(false);
        expect(fs.existsSync(path.join(notesDir, 'Weekly'))).toBe(false);
    });

    it('defaults to disabled when the flag is omitted', async () => {
        await ensureMyLifeWorkspace(tmpDir, store);
        expect(fs.existsSync(notesDir)).toBe(false);
    });

    it('seeds the notes structure and default files when the flag is ON (fresh workspace)', async () => {
        await ensureMyLifeWorkspace(tmpDir, store, true);

        expect(fs.statSync(notesDir).isDirectory()).toBe(true);
        expect(fs.statSync(path.join(notesDir, 'Weekly')).isDirectory()).toBe(true);

        const goalsContent = fs.readFileSync(path.join(notesDir, 'Goals.md'), 'utf-8');
        expect(goalsContent).toContain('# Goals');
        expect(goalsContent).toContain('personal goal');

        const journalContent = fs.readFileSync(path.join(notesDir, 'Journal.md'), 'utf-8');
        expect(journalContent).toContain('# Journal');
        expect(journalContent).toContain('reflections');
    });

    it('returns the correct workspace info', async () => {
        const ws = await ensureMyLifeWorkspace(tmpDir, store, true);

        expect(ws.id).toBe(MY_LIFE_WORKSPACE_ID);
        expect(ws.name).toBe(MY_LIFE_WORKSPACE_NAME);
        expect(ws.virtual).toBe(true);
        expect(ws.rootPath).toBe(rootPath);
    });

    it('registers the workspace in the store even when the flag is OFF', async () => {
        await ensureMyLifeWorkspace(tmpDir, store, false);

        const workspaces = await store.getWorkspaces();
        const myLife = workspaces.find(w => w.id === MY_LIFE_WORKSPACE_ID);
        expect(myLife).toBeDefined();
        expect(myLife!.name).toBe(MY_LIFE_WORKSPACE_NAME);
        expect(myLife!.virtual).toBe(true);
    });

    it('is idempotent — calling twice does not duplicate or overwrite', async () => {
        await ensureMyLifeWorkspace(tmpDir, store, true);

        const goalsPath = path.join(notesDir, 'Goals.md');
        fs.writeFileSync(goalsPath, '# My Custom Goals\n', 'utf-8');

        await ensureMyLifeWorkspace(tmpDir, store, true);

        expect(fs.readFileSync(goalsPath, 'utf-8')).toBe('# My Custom Goals\n');

        const workspaces = await store.getWorkspaces();
        const myLifeWorkspaces = workspaces.filter(w => w.id === MY_LIFE_WORKSPACE_ID);
        expect(myLifeWorkspaces.length).toBe(1);
    });

    it('does NOT recreate a deleted default note on restart with the flag ON', async () => {
        await ensureMyLifeWorkspace(tmpDir, store, true);

        const goalsPath = path.join(notesDir, 'Goals.md');
        fs.rmSync(goalsPath);
        expect(fs.existsSync(goalsPath)).toBe(false);

        await ensureMyLifeWorkspace(tmpDir, store, true);
        expect(fs.existsSync(goalsPath)).toBe(false);
    });

    it('does NOT recreate a deleted Weekly folder on restart with the flag ON', async () => {
        await ensureMyLifeWorkspace(tmpDir, store, true);

        const weeklyDir = path.join(notesDir, 'Weekly');
        fs.rmSync(weeklyDir, { recursive: true, force: true });
        expect(fs.existsSync(weeklyDir)).toBe(false);

        await ensureMyLifeWorkspace(tmpDir, store, true);
        expect(fs.existsSync(weeklyDir)).toBe(false);
    });

    it('exports the correct constants', () => {
        expect(MY_LIFE_WORKSPACE_ID).toBe('my_life');
        expect(MY_LIFE_WORKSPACE_NAME).toBe('My Life');
    });
});

describe('seedMyLifeDefaultNotes', () => {
    let tmpDir: string;
    let rootPath: string;
    let notesDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-my-life-seed-'));
        rootPath = path.join(tmpDir, 'repos', 'my_life');
        notesDir = path.join(rootPath, 'notes');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('seeds a fresh workspace and reports it did so (runtime off→on enable)', () => {
        expect(seedMyLifeDefaultNotes(rootPath)).toBe(true);
        expect(fs.existsSync(path.join(notesDir, 'Goals.md'))).toBe(true);
        expect(fs.existsSync(path.join(notesDir, 'Journal.md'))).toBe(true);
        expect(fs.existsSync(path.join(notesDir, 'Weekly'))).toBe(true);
    });

    it('skips seeding when the notes directory already exists (re-toggle)', () => {
        fs.mkdirSync(notesDir, { recursive: true });

        expect(seedMyLifeDefaultNotes(rootPath)).toBe(false);
        expect(fs.existsSync(path.join(notesDir, 'Goals.md'))).toBe(false);
    });
});
