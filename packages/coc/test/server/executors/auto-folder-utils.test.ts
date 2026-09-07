import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, it, expect } from 'vitest';
import { isRalphGrillingContext, isValidTaskFolder, resolveAutoFolderContext, suppressesAutoFolder, suppressesPlanSaveGuidance } from '../../../src/server/executors/auto-folder-utils';

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

describe('suppressesAutoFolder', () => {
    const chat = (context: Record<string, unknown>) => ({ kind: 'chat', mode: 'ask', context });

    it('suppresses a PR chat from its payload context', () => {
        expect(suppressesAutoFolder({ payload: chat({ pullRequestChat: { prId: '7' } }) })).toBe(true);
    });

    it('suppresses a commit chat from its payload context', () => {
        expect(suppressesAutoFolder({ payload: chat({ commitChat: { commitHash: 'abc123' } }) })).toBe(true);
    });

    it('suppresses a note chat from its payload context', () => {
        expect(suppressesAutoFolder({ payload: chat({ noteChat: { notePath: 'n.md' } }) })).toBe(true);
    });

    it('suppresses a PR chat from process metadata', () => {
        expect(suppressesAutoFolder({ metadata: { pullRequestChat: { prId: '7' } } })).toBe(true);
    });

    it('suppresses a commit chat from process metadata', () => {
        expect(suppressesAutoFolder({ metadata: { commitChat: { commitHash: 'abc123' } } })).toBe(true);
    });

    it('suppresses a note chat from metadata.notePath', () => {
        expect(suppressesAutoFolder({ metadata: { notePath: 'Plans/x.md' } })).toBe(true);
    });

    it('does not suppress a plain ask chat', () => {
        expect(suppressesAutoFolder({ payload: chat({ files: ['a.ts'] }), metadata: { mode: 'ask' } })).toBe(false);
    });

    it('does not suppress on empty, missing, or malformed input', () => {
        expect(suppressesAutoFolder({})).toBe(false);
        expect(suppressesAutoFolder({ payload: undefined, metadata: null })).toBe(false);
        expect(suppressesAutoFolder({ payload: 'not-an-object' })).toBe(false);
        expect(suppressesAutoFolder({ metadata: { notePath: '   ' } })).toBe(false);
        expect(suppressesAutoFolder({ metadata: { commitChat: null } })).toBe(false);
    });
});

describe('resolveAutoFolderContext — workspace isolation', () => {
    const tempRoots: string[] = [];

    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
    });

    async function makeDataDir(): Promise<string> {
        const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-auto-folder-ws-'));
        tempRoots.push(dataDir);
        return dataDir;
    }

    it('keeps two workspaces’ folder listings disjoint', async () => {
        const dataDir = await makeDataDir();
        await fs.mkdir(path.join(dataDir, 'repos', 'ws-a', 'notes', 'Plans', 'alpha'), { recursive: true });
        await fs.mkdir(path.join(dataDir, 'repos', 'ws-b', 'notes', 'Plans', 'beta'), { recursive: true });

        const a = await resolveAutoFolderContext({
            dataDir,
            workingDirectory: path.join(dataDir, 'repo-a'),
            workspaceId: 'ws-a',
            mode: 'ask',
            resolveWorkspaceIdForPath: async () => 'unused',
        });
        const b = await resolveAutoFolderContext({
            dataDir,
            workingDirectory: path.join(dataDir, 'repo-b'),
            workspaceId: 'ws-b',
            mode: 'ask',
            resolveWorkspaceIdForPath: async () => 'unused',
        });

        expect(a.existingFolders).toEqual(['alpha']);
        expect(b.existingFolders).toEqual(['beta']);
        expect(a.tasksRoot).not.toBe(b.tasksRoot);
    });

    it('prefers an explicit workspace ID over the working-directory resolver', async () => {
        const dataDir = await makeDataDir();
        await fs.mkdir(path.join(dataDir, 'repos', 'ws-explicit', 'notes', 'Plans', 'chosen'), { recursive: true });
        await fs.mkdir(path.join(dataDir, 'repos', 'ws-resolver', 'notes', 'Plans', 'ignored'), { recursive: true });

        const context = await resolveAutoFolderContext({
            dataDir,
            workingDirectory: path.join(dataDir, 'repo'),
            workspaceId: 'ws-explicit',
            mode: 'ask',
            resolveWorkspaceIdForPath: async () => 'ws-resolver',
        });

        expect(context.tasksRoot).toBe(path.join(dataDir, 'repos', 'ws-explicit', 'notes', 'Plans'));
        expect(context.existingFolders).toEqual(['chosen']);
    });

    it('uses a repo group’s own Plans root, not a member’s', async () => {
        const dataDir = await makeDataDir();
        await fs.mkdir(path.join(dataDir, 'repos', 'group-1', 'notes', 'Plans', 'group-plan'), { recursive: true });
        await fs.mkdir(path.join(dataDir, 'repos', 'member-1', 'notes', 'Plans', 'member-plan'), { recursive: true });

        const context = await resolveAutoFolderContext({
            dataDir,
            workingDirectory: path.join(dataDir, 'member-checkout'),
            workspaceId: 'group-1',
            mode: 'ask',
            resolveWorkspaceIdForPath: async () => 'member-1',
        });

        expect(context.existingFolders).toEqual(['group-plan']);
    });

    it('handles a data directory whose path contains spaces', async () => {
        const base = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-auto-folder-space-'));
        tempRoots.push(base);
        const dataDir = path.join(base, 'My Data Dir');
        await fs.mkdir(path.join(dataDir, 'repos', 'ws-space', 'notes', 'Plans', 'a folder'), { recursive: true });

        const context = await resolveAutoFolderContext({
            dataDir,
            workingDirectory: path.join(base, 'repo'),
            workspaceId: 'ws-space',
            mode: 'ask',
            resolveWorkspaceIdForPath: async () => 'unused',
        });

        expect(context.tasksRoot).toBe(path.join(dataDir, 'repos', 'ws-space', 'notes', 'Plans'));
        expect(context.existingFolders).toEqual(['a folder']);
    });
});

describe('plan save guidance eligibility', () => {
    it('detects grilling from a first-turn payload', () => {
        expect(isRalphGrillingContext({
            payload: { kind: 'chat', context: { ralph: { phase: 'grilling' } } },
        })).toBe(true);
    });

    it('detects a Work Item Goal grilling payload', () => {
        expect(isRalphGrillingContext({
            payload: { kind: 'chat', context: { workItemGoalGrilling: { workItemId: 'wi-1' } } },
        })).toBe(true);
    });

    it('detects grilling from the denormalized follow-up metadata projection', () => {
        expect(isRalphGrillingContext({ metadata: { ralph: { phase: 'grilling' } } })).toBe(true);
    });

    it('does not treat a non-grilling Ralph phase as grilling', () => {
        expect(isRalphGrillingContext({ metadata: { ralph: { phase: 'execution' } } })).toBe(false);
        expect(isRalphGrillingContext({ payload: { context: { ralph: { phase: 'execution' } } } })).toBe(false);
    });

    it('does not fire on empty or malformed input', () => {
        expect(isRalphGrillingContext({})).toBe(false);
        expect(isRalphGrillingContext({ payload: 'nope', metadata: null })).toBe(false);
        expect(isRalphGrillingContext({ metadata: { ralph: null } })).toBe(false);
    });

    it('suppresses guidance for artifact-bound chats and for grilling alike', () => {
        expect(suppressesPlanSaveGuidance({ metadata: { notePath: 'Plans/x.md' } })).toBe(true);
        expect(suppressesPlanSaveGuidance({ metadata: { pullRequestChat: { prId: '7' } } })).toBe(true);
        expect(suppressesPlanSaveGuidance({ metadata: { commitChat: { commitHash: 'abc' } } })).toBe(true);
        expect(suppressesPlanSaveGuidance({ metadata: { ralph: { phase: 'grilling' } } })).toBe(true);
    });

    it('allows guidance for a plain ask chat', () => {
        expect(suppressesPlanSaveGuidance({ payload: { kind: 'chat', mode: 'ask' }, metadata: { mode: 'ask' } }))
            .toBe(false);
        expect(suppressesAutoFolder({ metadata: { ralph: { phase: 'grilling' } } })).toBe(false);
    });
});
