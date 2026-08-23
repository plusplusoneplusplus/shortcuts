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
    resolveEffectiveSkillPaths,
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

/**
 * AC-02 — the effective-paths diagnostic reports the same member folders, in the
 * same order, attributed to the member repo they came from.
 */
describe('resolveEffectiveSkillPaths — repo-group member skill folders', () => {
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

    function addSkill(rootPath: string, skillName: string): string {
        const dir = path.join(rootPath, '.github', 'skills');
        fs.mkdirSync(path.join(dir, skillName), { recursive: true });
        fs.writeFileSync(path.join(dir, skillName, 'SKILL.md'), `# ${skillName}\nDesc`);
        return dir;
    }

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-group-eff-paths-'));
        store = new FileProcessStore(tmpDir);
        repoA = await registerRepo('ws-v2-aaa', 'Repo A');
        repoB = await registerRepo('ws-v2-bbb', 'Repo B');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('reports one entry per member folder, in member order, ahead of managed-global', async () => {
        const skillsA = addSkill(repoA, 'alpha');
        const skillsB = addSkill(repoB, 'beta');
        const ws = await createRepoGroup(tmpDir, store, { name: 'Team', members: ['ws-v2-aaa', 'ws-v2-bbb'] });

        const members = await resolveRepoGroupMemberSkillRoots(store, tmpDir, ws.id);
        const paths = await resolveEffectiveSkillPaths({
            dataDir: tmpDir,
            workspaceRootPath: ws.rootPath,
            repoGroupMembers: members,
            autoDetectDefaultFolders: false,
        });

        const memberEntries = paths.filter(p => p.source === 'repo-group-member');
        expect(memberEntries).toEqual([
            {
                source: 'repo-group-member',
                scope: 'workspace',
                status: 'available',
                path: skillsA,
                skillCount: 1,
                sourceRepoId: 'ws-v2-aaa',
                sourceRepoName: 'Repo A',
            },
            {
                source: 'repo-group-member',
                scope: 'workspace',
                status: 'available',
                path: skillsB,
                skillCount: 1,
                sourceRepoId: 'ws-v2-bbb',
                sourceRepoName: 'Repo B',
            },
        ]);

        // Ordering matches AC-01: members precede the group's own repo-local slot
        // and every global source.
        expect(paths.findIndex(p => p.source === 'repo-group-member'))
            .toBeLessThan(paths.findIndex(p => p.source === 'repo'));
        expect(paths.findIndex(p => p.source === 'repo-group-member'))
            .toBeLessThan(paths.findIndex(p => p.source === 'managed-global'));
    });

    it('keeps a member whose .github/skills is missing or empty, with the usual status semantics', async () => {
        const skillsB = path.join(repoB, '.github', 'skills');
        fs.mkdirSync(skillsB, { recursive: true });
        const ws = await createRepoGroup(tmpDir, store, { name: 'Team', members: ['ws-v2-aaa', 'ws-v2-bbb'] });

        const paths = await resolveEffectiveSkillPaths({
            dataDir: tmpDir,
            workspaceRootPath: ws.rootPath,
            repoGroupMembers: await resolveRepoGroupMemberSkillRoots(store, tmpDir, ws.id),
            autoDetectDefaultFolders: false,
        });

        const memberEntries = paths.filter(p => p.source === 'repo-group-member');
        expect(memberEntries.map(p => [p.path, p.status])).toEqual([
            [path.join(repoA, '.github', 'skills'), 'missing'],
            [skillsB, 'no-skills'],
        ]);
    });

    it('drops a stale member and never surfaces the member root or <root>/skills', async () => {
        addSkill(repoA, 'alpha');
        fs.mkdirSync(path.join(repoB, 'skills'), { recursive: true });
        const ws = await createRepoGroup(tmpDir, store, { name: 'Team', members: ['ws-v2-aaa', 'ws-v2-bbb'] });
        await store.removeWorkspace('ws-v2-bbb');

        const paths = await resolveEffectiveSkillPaths({
            dataDir: tmpDir,
            workspaceRootPath: ws.rootPath,
            repoGroupMembers: await resolveRepoGroupMemberSkillRoots(store, tmpDir, ws.id),
            autoDetectDefaultFolders: false,
        });

        expect(paths.filter(p => p.source === 'repo-group-member').map(p => p.path))
            .toEqual([path.join(repoA, '.github', 'skills')]);
        expect(paths.some(p => p.path === repoA || p.path === repoB)).toBe(false);
        expect(paths.some(p => p.path === path.join(repoB, 'skills'))).toBe(false);
    });

    it('is byte-identical to the pre-change result for a non-group workspace', async () => {
        addSkill(repoA, 'alpha');

        const withMembers = await resolveEffectiveSkillPaths({
            dataDir: tmpDir,
            workspaceRootPath: repoA,
            repoGroupMembers: await resolveRepoGroupMemberSkillRoots(store, tmpDir, 'ws-v2-aaa'),
            autoDetectDefaultFolders: false,
        });
        const without = await resolveEffectiveSkillPaths({
            dataDir: tmpDir,
            workspaceRootPath: repoA,
            autoDetectDefaultFolders: false,
        });

        expect(withMembers).toEqual(without);
        expect(withMembers.some(p => p.source === 'repo-group-member')).toBe(false);
    });
});
