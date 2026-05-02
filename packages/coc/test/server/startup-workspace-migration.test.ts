import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteProcessStore, FileProcessStore } from '@plusplusoneplusplus/forge';
import type { WorkspaceInfo, WikiInfo } from '@plusplusoneplusplus/forge';
import { migrateWorkspaceRegistryIfNeeded } from '../../src/server/storage/startup-workspace-migration';

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ws-migration-test-'));
}

function makeWorkspace(id: string, name: string): WorkspaceInfo {
    return { id, name, rootPath: `/repos/${name}` };
}

function makeWiki(id: string, name: string): WikiInfo {
    return { id, name, wikiDir: `/wikis/${name}`, aiEnabled: true, registeredAt: new Date().toISOString() };
}

describe('migrateWorkspaceRegistryIfNeeded', () => {
    let dataDir: string;
    let store: SqliteProcessStore;

    beforeEach(() => {
        dataDir = createTempDir();
        store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
    });

    afterEach(() => {
        store.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    // --- Happy paths ---

    it('migrates workspaces from JSON to SQLite when file exists', async () => {
        const workspaces = [makeWorkspace('ws-1', 'project-a'), makeWorkspace('ws-2', 'project-b')];
        fs.writeFileSync(path.join(dataDir, 'workspaces.json'), JSON.stringify(workspaces));

        const result = await migrateWorkspaceRegistryIfNeeded(dataDir, store);

        expect(result.migrated).toBe(true);
        expect(result.workspaceCount).toBe(2);
        const stored = await store.getWorkspaces();
        expect(stored.map(w => w.id).sort()).toEqual(['ws-1', 'ws-2']);
    });

    it('migrates wikis from JSON to SQLite when file exists', async () => {
        fs.writeFileSync(path.join(dataDir, 'workspaces.json'), JSON.stringify([]));
        const wikis = [makeWiki('wiki-1', 'docs'), makeWiki('wiki-2', 'api-docs')];
        fs.writeFileSync(path.join(dataDir, 'wikis.json'), JSON.stringify(wikis));

        const result = await migrateWorkspaceRegistryIfNeeded(dataDir, store);

        expect(result.migrated).toBe(true);
        expect(result.wikiCount).toBe(2);
        const stored = await store.getWikis();
        expect(stored.map(w => w.id).sort()).toEqual(['wiki-1', 'wiki-2']);
    });

    it('migrates both workspaces and wikis together', async () => {
        fs.writeFileSync(path.join(dataDir, 'workspaces.json'), JSON.stringify([makeWorkspace('ws-1', 'proj')]));
        fs.writeFileSync(path.join(dataDir, 'wikis.json'), JSON.stringify([makeWiki('wiki-1', 'docs')]));

        const result = await migrateWorkspaceRegistryIfNeeded(dataDir, store);

        expect(result).toEqual({ migrated: true, workspaceCount: 1, wikiCount: 1 });
    });

    // --- Rename / cleanup ---

    it('renames files to .migrated after successful migration', async () => {
        fs.writeFileSync(path.join(dataDir, 'workspaces.json'), JSON.stringify([makeWorkspace('ws-1', 'proj')]));
        fs.writeFileSync(path.join(dataDir, 'wikis.json'), JSON.stringify([makeWiki('wiki-1', 'docs')]));

        await migrateWorkspaceRegistryIfNeeded(dataDir, store);

        expect(fs.existsSync(path.join(dataDir, 'workspaces.json'))).toBe(false);
        expect(fs.existsSync(path.join(dataDir, 'workspaces.json.migrated'))).toBe(true);
        expect(fs.existsSync(path.join(dataDir, 'wikis.json'))).toBe(false);
        expect(fs.existsSync(path.join(dataDir, 'wikis.json.migrated'))).toBe(true);
    });

    it('renames only workspaces.json when wikis.json does not exist', async () => {
        fs.writeFileSync(path.join(dataDir, 'workspaces.json'), JSON.stringify([]));

        await migrateWorkspaceRegistryIfNeeded(dataDir, store);

        expect(fs.existsSync(path.join(dataDir, 'workspaces.json'))).toBe(false);
        expect(fs.existsSync(path.join(dataDir, 'workspaces.json.migrated'))).toBe(true);
        expect(fs.existsSync(path.join(dataDir, 'wikis.json.migrated'))).toBe(false);
    });

    // --- No-op paths ---

    it('is a no-op when workspaces.json does not exist', async () => {
        const result = await migrateWorkspaceRegistryIfNeeded(dataDir, store);

        expect(result).toEqual({ migrated: false, workspaceCount: 0, wikiCount: 0 });
    });

    it('is a no-op when store is FileProcessStore', async () => {
        const fileStore = new FileProcessStore({ dataDir });
        fs.writeFileSync(path.join(dataDir, 'workspaces.json'), JSON.stringify([makeWorkspace('ws-1', 'proj')]));

        const result = await migrateWorkspaceRegistryIfNeeded(dataDir, fileStore);

        expect(result).toEqual({ migrated: false, workspaceCount: 0, wikiCount: 0 });
        // File should still be there — not renamed
        expect(fs.existsSync(path.join(dataDir, 'workspaces.json'))).toBe(true);
    });

    // --- Idempotency ---

    it('is idempotent — running twice does not duplicate entries', async () => {
        const workspaces = [makeWorkspace('ws-1', 'proj')];
        const wikis = [makeWiki('wiki-1', 'docs')];
        fs.writeFileSync(path.join(dataDir, 'workspaces.json'), JSON.stringify(workspaces));
        fs.writeFileSync(path.join(dataDir, 'wikis.json'), JSON.stringify(wikis));

        // First run
        await migrateWorkspaceRegistryIfNeeded(dataDir, store);

        // Restore files to simulate re-run
        fs.renameSync(path.join(dataDir, 'workspaces.json.migrated'), path.join(dataDir, 'workspaces.json'));
        fs.renameSync(path.join(dataDir, 'wikis.json.migrated'), path.join(dataDir, 'wikis.json'));

        // Second run
        const result = await migrateWorkspaceRegistryIfNeeded(dataDir, store);

        expect(result).toEqual({ migrated: true, workspaceCount: 1, wikiCount: 1 });
        const storedWs = await store.getWorkspaces();
        expect(storedWs).toHaveLength(1);
        const storedWikis = await store.getWikis();
        expect(storedWikis).toHaveLength(1);
    });

    it('merges with pre-existing DB entries without removing them', async () => {
        // Pre-register a workspace directly in the DB
        await store.registerWorkspace(makeWorkspace('pre-existing', 'already-there'));

        // Migration file has a different workspace
        fs.writeFileSync(path.join(dataDir, 'workspaces.json'), JSON.stringify([makeWorkspace('ws-new', 'new-proj')]));

        await migrateWorkspaceRegistryIfNeeded(dataDir, store);

        const stored = await store.getWorkspaces();
        expect(stored.map(w => w.id).sort()).toEqual(['pre-existing', 'ws-new']);
    });

    // --- Edge cases ---

    it('handles malformed workspaces.json gracefully', async () => {
        fs.writeFileSync(path.join(dataDir, 'workspaces.json'), '{ not valid json }}');
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        const result = await migrateWorkspaceRegistryIfNeeded(dataDir, store);

        expect(result.migrated).toBe(true);
        expect(result.workspaceCount).toBe(0);
        const messages = stderrSpy.mock.calls.map(c => String(c[0]));
        expect(messages.some(m => m.includes('malformed'))).toBe(true);
        stderrSpy.mockRestore();
    });

    it('handles malformed wikis.json gracefully', async () => {
        fs.writeFileSync(path.join(dataDir, 'workspaces.json'), JSON.stringify([makeWorkspace('ws-1', 'proj')]));
        fs.writeFileSync(path.join(dataDir, 'wikis.json'), 'not json');
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        const result = await migrateWorkspaceRegistryIfNeeded(dataDir, store);

        expect(result.workspaceCount).toBe(1);
        expect(result.wikiCount).toBe(0);
        const messages = stderrSpy.mock.calls.map(c => String(c[0]));
        expect(messages.some(m => m.includes('malformed'))).toBe(true);
        stderrSpy.mockRestore();
    });

    it('handles empty array in workspaces.json', async () => {
        fs.writeFileSync(path.join(dataDir, 'workspaces.json'), JSON.stringify([]));

        const result = await migrateWorkspaceRegistryIfNeeded(dataDir, store);

        expect(result).toEqual({ migrated: true, workspaceCount: 0, wikiCount: 0 });
        expect(fs.existsSync(path.join(dataDir, 'workspaces.json.migrated'))).toBe(true);
    });

    it('handles workspaces with optional fields', async () => {
        const ws: WorkspaceInfo = {
            id: 'ws-full',
            name: 'full-project',
            rootPath: '/repos/full',
            color: '#ff0000',
            remoteUrl: 'https://github.com/example/repo.git',
            description: 'A test workspace',
            enabledMcpServers: ['server-a'],
            disabledSkills: ['skill-b'],
            extraSkillFolders: ['/extra/skills'],
            virtual: true,
        };
        fs.writeFileSync(path.join(dataDir, 'workspaces.json'), JSON.stringify([ws]));

        await migrateWorkspaceRegistryIfNeeded(dataDir, store);

        const stored = await store.getWorkspaces();
        expect(stored).toHaveLength(1);
        expect(stored[0].id).toBe('ws-full');
        expect(stored[0].color).toBe('#ff0000');
        expect(stored[0].remoteUrl).toBe('https://github.com/example/repo.git');
        expect(stored[0].virtual).toBe(true);
    });

    it('overwrites existing .migrated file on re-migration', async () => {
        // Create an old .migrated file
        fs.writeFileSync(path.join(dataDir, 'workspaces.json.migrated'), 'old-content');
        fs.writeFileSync(path.join(dataDir, 'workspaces.json'), JSON.stringify([makeWorkspace('ws-1', 'proj')]));

        await migrateWorkspaceRegistryIfNeeded(dataDir, store);

        const content = fs.readFileSync(path.join(dataDir, 'workspaces.json.migrated'), 'utf-8');
        expect(content).toContain('ws-1');
    });

    // --- Logging ---

    it('logs migration progress to stderr with [WorkspaceMigration] prefix', async () => {
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        fs.writeFileSync(path.join(dataDir, 'workspaces.json'), JSON.stringify([makeWorkspace('ws-1', 'proj')]));

        await migrateWorkspaceRegistryIfNeeded(dataDir, store);

        const messages = stderrSpy.mock.calls.map(c => String(c[0]));
        expect(messages.every(m => m.includes('[WorkspaceMigration]'))).toBe(true);
        expect(messages.some(m => m.includes('1 workspace'))).toBe(true);
        expect(messages.some(m => m.includes('Migration complete'))).toBe(true);
        stderrSpy.mockRestore();
    });
});
