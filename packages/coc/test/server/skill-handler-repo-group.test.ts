/**
 * AC-03 — `loadSkillsForWorkspace` lists each live repo-group member's
 * `.github/skills`, first-wins in membership order, so the group's Skills panel
 * shows them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { createRepoGroup } from '../../src/server/workspaces/repo-group-workspace';
import { loadSkillsForWorkspace, skillCache } from '../../src/server/skills/skill-handler';

/** Keep OneDrive auto-detection out of the assertions. */
const NO_AUTODETECT = { autoDetectDefaultFolders: false as const };

describe('loadSkillsForWorkspace — repo-group member skills', () => {
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

    function writeSkill(rootPath: string, name: string, description: string): string {
        const dir = path.join(rootPath, '.github', 'skills', name);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\ndescription: ${description}\n---\n# ${name}\n`);
        return path.join(rootPath, '.github', 'skills');
    }

    beforeEach(async () => {
        skillCache.clear();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-group-skill-list-'));
        store = new FileProcessStore(tmpDir);
        repoA = await registerRepo('ws-v2-aaa', 'Repo A');
        repoB = await registerRepo('ws-v2-bbb', 'Repo B');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('lists every live member skill, in membership order, tagged with its member repo', async () => {
        const skillsA = writeSkill(repoA, 'alpha-skill', 'From A');
        const skillsB = writeSkill(repoB, 'beta-skill', 'From B');

        const ws = await createRepoGroup(tmpDir, store, { name: 'My Team', members: ['ws-v2-aaa', 'ws-v2-bbb'] });
        const skills = await loadSkillsForWorkspace(ws as WorkspaceInfo, tmpDir, store, NO_AUTODETECT);

        const memberSkills = skills.filter(s => s.source === 'repo-group-member');
        expect(memberSkills.map(s => s.name)).toEqual(['alpha-skill', 'beta-skill']);
        expect(memberSkills[0]).toMatchObject({
            sourceRepoId: 'ws-v2-aaa',
            folderPath: skillsA,
            folderLabel: 'Repo A',
            description: 'From A',
        });
        expect(memberSkills[1]).toMatchObject({
            sourceRepoId: 'ws-v2-bbb',
            folderPath: skillsB,
            folderLabel: 'Repo B',
        });
    });

    it('resolves a name collision first-wins by membership order', async () => {
        writeSkill(repoA, 'shared-skill', 'From A');
        writeSkill(repoB, 'shared-skill', 'From B');

        const ws = await createRepoGroup(tmpDir, store, { name: 'My Team', members: ['ws-v2-bbb', 'ws-v2-aaa'] });
        const skills = await loadSkillsForWorkspace(ws as WorkspaceInfo, tmpDir, store, NO_AUTODETECT);

        const shared = skills.filter(s => s.name === 'shared-skill');
        expect(shared).toHaveLength(1);
        expect(shared[0].sourceRepoId).toBe('ws-v2-bbb');
        expect(shared[0].description).toBe('From B');
    });

    it('wins collisions against the managed global skills dir', async () => {
        writeSkill(repoA, 'dup-skill', 'From member');
        const globalDir = path.join(tmpDir, 'skills', 'dup-skill');
        fs.mkdirSync(globalDir, { recursive: true });
        fs.writeFileSync(path.join(globalDir, 'SKILL.md'), '---\ndescription: From global\n---\n# dup-skill\n');

        const ws = await createRepoGroup(tmpDir, store, { name: 'My Team', members: ['ws-v2-aaa'] });
        const skills = await loadSkillsForWorkspace(ws as WorkspaceInfo, tmpDir, store, NO_AUTODETECT);

        const dup = skills.filter(s => s.name === 'dup-skill');
        expect(dup).toHaveLength(1);
        expect(dup[0].source).toBe('repo-group-member');
        expect(dup[0].description).toBe('From member');
    });

    it('skips a member without .github/skills and a stale member', async () => {
        writeSkill(repoA, 'alpha-skill', 'From A');
        // repoB has no .github/skills at all.
        const repoC = await registerRepo('ws-v2-ccc', 'Repo C');
        writeSkill(repoC, 'gamma-skill', 'From C');

        const ws = await createRepoGroup(tmpDir, store, {
            name: 'My Team',
            members: ['ws-v2-aaa', 'ws-v2-bbb', 'ws-v2-ccc'],
        });
        // Make C stale: its checkout is gone.
        fs.rmSync(repoC, { recursive: true, force: true });

        const skills = await loadSkillsForWorkspace(ws as WorkspaceInfo, tmpDir, store, NO_AUTODETECT);
        expect(skills.filter(s => s.source === 'repo-group-member').map(s => s.name)).toEqual(['alpha-skill']);
    });

    it('lists no member skills for an ordinary (non-group) workspace', async () => {
        writeSkill(repoA, 'alpha-skill', 'From A');
        const ws = (await store.getWorkspaces()).find(w => w.id === 'ws-v2-bbb')!;

        const skills = await loadSkillsForWorkspace(ws, tmpDir, store, NO_AUTODETECT);
        expect(skills.some(s => s.source === 'repo-group-member')).toBe(false);
        expect(skills.some(s => s.name === 'alpha-skill')).toBe(false);
    });
});
