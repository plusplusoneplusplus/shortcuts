/**
 * AC-01 — a repo-group workspace inherits each live member's
 * `<memberRoot>/.github/skills` folder, in `group.json` member order, ahead of
 * every other skill source.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileProcessStore, getBundledSkillsPath } from '@plusplusoneplusplus/forge';
import { createRepoGroup } from '../../../src/server/workspaces/repo-group-workspace';
import {
    resolveRepoGroupMemberSkillRoots,
    resolveSkillConfig,
} from '../../../src/server/executors/skill-config-resolver';

/** Keep OneDrive auto-detection out of the assertions. */
const NO_AUTODETECT = { autoDetectDefaultFolders: false as const };

describe('resolveSkillConfig — repo-group member skill folders', () => {
    let tmpDir: string;
    let store: FileProcessStore;
    let repoA: string;
    let repoB: string;

    async function registerRepo(id: string, name: string): Promise<string> {
        const rootPath = path.join(tmpDir, 'checkouts', id);
        fs.mkdirSync(rootPath, { recursive: true });
        await store.registerWorkspace({ id, name, rootPath });
        return rootPath;
    }

    function addSkillsDir(rootPath: string): string {
        const dir = path.join(rootPath, '.github', 'skills');
        fs.mkdirSync(dir, { recursive: true });
        return dir;
    }

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-group-skills-'));
        store = new FileProcessStore(tmpDir);
        repoA = await registerRepo('ws-v2-aaa', 'Repo A');
        repoB = await registerRepo('ws-v2-bbb', 'Repo B');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('lists every live member .github/skills first, in membership order', async () => {
        const skillsA = addSkillsDir(repoA);
        const skillsB = addSkillsDir(repoB);
        const globalSkillsDir = path.join(tmpDir, 'skills');
        fs.mkdirSync(globalSkillsDir, { recursive: true });

        const ws = await createRepoGroup(tmpDir, store, { name: 'My Team', members: ['ws-v2-aaa', 'ws-v2-bbb'] });

        const result = await resolveSkillConfig(store, tmpDir, ws.id, ws.rootPath, NO_AUTODETECT);

        const dirs = result.skillDirectories!;
        expect(dirs.slice(0, 3)).toEqual([skillsA, skillsB, globalSkillsDir]);
    });

    it('follows group.json member order, not registry order', async () => {
        const skillsA = addSkillsDir(repoA);
        const skillsB = addSkillsDir(repoB);

        const ws = await createRepoGroup(tmpDir, store, { name: 'Reversed', members: ['ws-v2-bbb', 'ws-v2-aaa'] });

        const dirs = (await resolveSkillConfig(store, tmpDir, ws.id, ws.rootPath, NO_AUTODETECT)).skillDirectories!;
        expect(dirs.slice(0, 2)).toEqual([skillsB, skillsA]);
    });

    it('never emits the member root itself or <memberRoot>/skills', async () => {
        addSkillsDir(repoA);
        // A sibling `skills/` folder exists but must not be picked up.
        fs.mkdirSync(path.join(repoA, 'skills'), { recursive: true });

        const ws = await createRepoGroup(tmpDir, store, { name: 'Solo', members: ['ws-v2-aaa'] });

        const dirs = (await resolveSkillConfig(store, tmpDir, ws.id, ws.rootPath, NO_AUTODETECT)).skillDirectories!;
        expect(dirs).not.toContain(repoA);
        expect(dirs).not.toContain(path.join(repoA, 'skills'));
        expect(dirs[0]).toBe(path.join(repoA, '.github', 'skills'));
    });

    it('skips a member whose .github/skills does not exist', async () => {
        const skillsB = addSkillsDir(repoB);

        const ws = await createRepoGroup(tmpDir, store, { name: 'Partial', members: ['ws-v2-aaa', 'ws-v2-bbb'] });

        const dirs = (await resolveSkillConfig(store, tmpDir, ws.id, ws.rootPath, NO_AUTODETECT)).skillDirectories!;
        expect(dirs[0]).toBe(skillsB);
        expect(dirs).not.toContain(path.join(repoA, '.github', 'skills'));
    });

    it('skips a stale member whose root path is gone', async () => {
        const skillsA = addSkillsDir(repoA);
        addSkillsDir(repoB);

        const ws = await createRepoGroup(tmpDir, store, { name: 'Stale', members: ['ws-v2-aaa', 'ws-v2-bbb'] });
        fs.rmSync(repoB, { recursive: true, force: true });

        const dirs = (await resolveSkillConfig(store, tmpDir, ws.id, ws.rootPath, NO_AUTODETECT)).skillDirectories!;
        expect(dirs[0]).toBe(skillsA);
        expect(dirs.some(d => d.startsWith(repoB))).toBe(false);
    });

    it('skips a stale member whose workspace was deregistered', async () => {
        addSkillsDir(repoA);
        const skillsB = addSkillsDir(repoB);

        const ws = await createRepoGroup(tmpDir, store, { name: 'Removed', members: ['ws-v2-aaa', 'ws-v2-bbb'] });
        await store.removeWorkspace('ws-v2-aaa');

        const dirs = (await resolveSkillConfig(store, tmpDir, ws.id, ws.rootPath, NO_AUTODETECT)).skillDirectories!;
        expect(dirs[0]).toBe(skillsB);
        expect(dirs.some(d => d.startsWith(repoA))).toBe(false);
    });

    it('yields the pre-existing result for a group with zero members', async () => {
        const globalSkillsDir = path.join(tmpDir, 'skills');
        fs.mkdirSync(globalSkillsDir, { recursive: true });

        const ws = await createRepoGroup(tmpDir, store, { name: 'Empty', members: [] });

        const dirs = (await resolveSkillConfig(store, tmpDir, ws.id, ws.rootPath, NO_AUTODETECT)).skillDirectories!;
        expect(dirs[0]).toBe(globalSkillsDir);
        expect(dirs.some(d => d.startsWith(path.join(tmpDir, 'checkouts')))).toBe(false);
    });

    it('leaves a non-group workspace byte-identical to before the change', async () => {
        const repoSkills = addSkillsDir(repoA);
        const globalSkillsDir = path.join(tmpDir, 'skills');
        fs.mkdirSync(globalSkillsDir, { recursive: true });
        // A group exists but is not the workspace under resolution.
        await createRepoGroup(tmpDir, store, { name: 'Other', members: ['ws-v2-bbb'] });
        addSkillsDir(repoB);

        const dirs = (await resolveSkillConfig(store, tmpDir, 'ws-v2-aaa', repoA, NO_AUTODETECT)).skillDirectories!;

        const bundledDir = getBundledSkillsPath();
        const expected = [repoSkills, globalSkillsDir];
        if (fs.existsSync(bundledDir)) expected.push(bundledDir);
        expect(dirs).toEqual(expected);
    });
});

describe('resolveRepoGroupMemberSkillRoots', () => {
    let tmpDir: string;
    let store: FileProcessStore;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-group-skill-roots-'));
        store = new FileProcessStore(tmpDir);
        const rootPath = path.join(tmpDir, 'checkouts', 'ws-v2-aaa');
        fs.mkdirSync(rootPath, { recursive: true });
        await store.registerWorkspace({ id: 'ws-v2-aaa', name: 'Repo A', rootPath });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns nothing for a non-group or absent workspace id', async () => {
        expect(await resolveRepoGroupMemberSkillRoots(store, tmpDir, 'ws-v2-aaa')).toEqual([]);
        expect(await resolveRepoGroupMemberSkillRoots(store, tmpDir, undefined)).toEqual([]);
    });

    it('returns nothing for a group id with no membership file', async () => {
        expect(await resolveRepoGroupMemberSkillRoots(store, tmpDir, 'group-does-not-exist')).toEqual([]);
    });

    it('carries the member name and root path for attribution', async () => {
        const ws = await createRepoGroup(tmpDir, store, { name: 'Team', members: ['ws-v2-aaa'] });

        expect(await resolveRepoGroupMemberSkillRoots(store, tmpDir, ws.id)).toEqual([
            { workspaceId: 'ws-v2-aaa', name: 'Repo A', rootPath: path.join(tmpDir, 'checkouts', 'ws-v2-aaa') },
        ]);
    });
});
