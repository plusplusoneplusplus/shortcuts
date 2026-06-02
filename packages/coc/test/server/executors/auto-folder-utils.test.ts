/**
 * Tests for auto-folder-utils
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, it, expect } from 'vitest';
import { isValidTaskFolder, resolveAutoFolderContext } from '../../../src/server/executors/auto-folder-utils';

describe('isValidTaskFolder', () => {
    it('returns true for a normal folder name', () => {
        expect(isValidTaskFolder('my-feature')).toBe(true);
    });

    it('returns true for an archive folder (callers handle archive exclusion separately)', () => {
        expect(isValidTaskFolder('archive')).toBe(true);
    });

    it('returns true for a nested path segment that is a normal name', () => {
        expect(isValidTaskFolder('chat-filter')).toBe(true);
    });

    it('returns false for .git', () => {
        expect(isValidTaskFolder('.git')).toBe(false);
    });

    it('returns false for any dot-prefixed hidden directory', () => {
        expect(isValidTaskFolder('.hidden')).toBe(false);
        expect(isValidTaskFolder('.github')).toBe(false);
        expect(isValidTaskFolder('.vscode')).toBe(false);
    });

    it('returns false for a lone dot', () => {
        expect(isValidTaskFolder('.')).toBe(false);
    });
});

describe('resolveAutoFolderContext', () => {
    const tempRoots: string[] = [];

    async function makeDataDir(): Promise<string> {
        const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-auto-folder-'));
        tempRoots.push(dataDir);
        return dataDir;
    }

    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
    });

    it('resolves ask mode to notes/Plans (same as plan mode) and creates the directory', async () => {
        const dataDir = await makeDataDir();
        const plansRoot = path.join(dataDir, 'repos', 'ws-test', 'notes', 'Plans');
        await fs.mkdir(path.join(plansRoot, 'feature-a'), { recursive: true });
        await fs.mkdir(path.join(plansRoot, '.hidden'), { recursive: true });
        await fs.writeFile(path.join(plansRoot, 'not-a-folder.md'), 'x');

        const context = await resolveAutoFolderContext({
            dataDir,
            workingDirectory: path.join(dataDir, 'repo'),
            workspaceId: 'ws-test',
            mode: 'ask',
            resolveWorkspaceIdForPath: async () => 'unused',
        });

        const stat = await fs.stat(plansRoot);
        expect(stat.isDirectory()).toBe(true);
        expect(context.tasksRoot).toBe(plansRoot);
        expect(context.existingFolders).toEqual(['feature-a']);
    });

    it('resolves plan mode to notes/Plans and creates the directory', async () => {
        const dataDir = await makeDataDir();
        const plansRoot = path.join(dataDir, 'repos', 'ws-plan', 'notes', 'Plans');

        const context = await resolveAutoFolderContext({
            dataDir,
            workingDirectory: path.join(dataDir, 'repo'),
            workspaceId: 'ws-plan',
            mode: 'plan',
            resolveWorkspaceIdForPath: async () => 'unused',
        });

        const stat = await fs.stat(plansRoot);
        expect(stat.isDirectory()).toBe(true);
        expect(context.tasksRoot).toBe(plansRoot);
        expect(context.existingFolders).toEqual([]);
    });

    it('resolves the workspace ID from the working directory when not provided', async () => {
        const dataDir = await makeDataDir();
        const plansRoot = path.join(dataDir, 'repos', 'ws-resolved', 'notes', 'Plans');

        const context = await resolveAutoFolderContext({
            dataDir,
            workingDirectory: path.join(dataDir, 'repo'),
            mode: 'ask',
            resolveWorkspaceIdForPath: async () => 'ws-resolved',
        });

        const stat = await fs.stat(plansRoot);
        expect(stat.isDirectory()).toBe(true);
        expect(context.tasksRoot).toBe(plansRoot);
    });

    it('routes non-ask modes to the tasks root, not notes/Plans', async () => {
        const dataDir = await makeDataDir();
        const tasksRoot = path.join(dataDir, 'repos', 'ws-other', 'tasks');
        await fs.mkdir(tasksRoot, { recursive: true });

        const context = await resolveAutoFolderContext({
            dataDir,
            workingDirectory: path.join(dataDir, 'repo'),
            workspaceId: 'ws-other',
            // mode omitted — defaults to autopilot-style task output.
            resolveWorkspaceIdForPath: async () => 'unused',
        });

        expect(context.tasksRoot).toBe(tasksRoot);
        // Ensure no notes/Plans directory was created
        const plansRoot = path.join(dataDir, 'repos', 'ws-other', 'notes', 'Plans');
        await expect(fs.stat(plansRoot)).rejects.toThrow();
    });
});
