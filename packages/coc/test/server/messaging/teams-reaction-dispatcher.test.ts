import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CLIConfig } from '../../../src/config';
import { resolveTeamsReactionDispatcher } from '../../../src/server/messaging/teams-reaction-dispatcher';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createRepoGroup } from '../../../src/server/workspaces/repo-group-workspace';

describe('resolveTeamsReactionDispatcher', () => {
    let root: string;
    let repo: string;
    let dataDir: string;
    let store: ReturnType<typeof createMockProcessStore>;
    let config: CLIConfig;
    let controller: AbortController;

    function skill(directory: string, body = 'Follow the configured task policy.'): string {
        const file = path.join(directory, 'dispatcher', 'SKILL.md');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, body);
        return file;
    }

    function resolve() {
        return resolveTeamsReactionDispatcher(store, dataDir, config, controller.signal);
    }

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'reaction-dispatcher-'));
        repo = path.join(root, 'repo');
        dataDir = path.join(root, 'data');
        fs.mkdirSync(repo);
        fs.mkdirSync(dataDir);
        store = createMockProcessStore({ initialWorkspaces: [
            { id: 'workspace-a', rootPath: repo, name: 'Workspace A' },
            { id: 'workspace-b', rootPath: path.join(root, 'other'), name: 'Workspace B' },
        ] });
        config = {
            features: { teamsReactionDelegation: true },
            teamsReactionDelegation: { workspaceId: 'workspace-a', dispatcherSkill: 'dispatcher' },
            skills: { autoDetectDefaultFolders: false },
        };
        controller = new AbortController();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('returns the selected physical workspace and exact repo dispatcher file', async () => {
        const file = skill(path.join(repo, '.github', 'skills'));
        expect(await resolve()).toEqual({
            workspaceId: 'workspace-a', workingDirectory: repo, dispatcherSkill: 'dispatcher', dispatcherSkillPath: file,
        });
    });

    async function selectGroup(members = ['workspace-a', 'workspace-b']) {
        const group = await createRepoGroup(dataDir, store, { name: 'Team', members });
        config.teamsReactionDelegation!.workspaceId = group.id;
        return group;
    }

    it('executes in the group root with member skill precedence ahead of global skills', async () => {
        const group = await selectGroup();
        const first = skill(path.join(repo, '.github', 'skills'));
        const second = skill(path.join(root, 'other', '.github', 'skills'));
        const global = skill(path.join(dataDir, 'skills'));
        for (const file of [first, second, global]) {
            expect(await resolve()).toEqual({
                workspaceId: group.id, workingDirectory: group.rootPath,
                dispatcherSkill: 'dispatcher', dispatcherSkillPath: file,
            });
            fs.rmSync(path.dirname(file), { recursive: true });
        }
        await expect(resolve()).rejects.toThrow('unavailable');
    });

    it('supports an empty repo group with a managed global dispatcher', async () => {
        const group = await selectGroup([]);
        const file = skill(path.join(dataDir, 'skills'));
        expect(await resolve()).toMatchObject({
            workspaceId: group.id, workingDirectory: group.rootPath, dispatcherSkillPath: file,
        });
    });

    it('honors group-specific disabled skills for inherited dispatchers', async () => {
        const group = await selectGroup();
        skill(path.join(repo, '.github', 'skills'));
        const workspaces = await store.getWorkspaces();
        vi.mocked(store.getWorkspaces).mockResolvedValue(workspaces.map(workspace =>
            workspace.id === group.id ? { ...workspace, disabledSkills: ['dispatcher'] } : workspace));
        await expect(resolve()).rejects.toThrow('skill is disabled');
    });

    it.each(['missing', 'malformed', 'invalid-member'])('rejects %s group membership without global fallback', async kind => {
        const group = await selectGroup();
        skill(path.join(dataDir, 'skills'));
        const file = path.join(group.rootPath, 'group.json');
        if (kind === 'missing') fs.unlinkSync(file);
        else fs.writeFileSync(file, kind === 'malformed' ? '{invalid' : '{"name":"Team","members":[42]}');
        await expect(resolve()).rejects.toThrow('membership is unavailable');
    });

    it('rejects an invalid inherited skill source without global fallback', async () => {
        await selectGroup();
        fs.mkdirSync(path.join(repo, '.github'));
        fs.writeFileSync(path.join(repo, '.github', 'skills'), 'not a directory');
        skill(path.join(dataDir, 'skills'));
        await expect(resolve()).rejects.toThrow('not a directory');
    });

    it('rejects an empty inherited dispatcher without global fallback', async () => {
        await selectGroup();
        skill(path.join(repo, '.github', 'skills'), '');
        skill(path.join(dataDir, 'skills'));
        await expect(resolve()).rejects.toThrow('empty');
    });

    it('preserves ordinary repo, managed global, global extra and workspace extra precedence', async () => {
        const globalExtra = path.join(root, 'global-extra');
        const workspaceExtra = path.join(repo, 'extra');
        config.skills = { autoDetectDefaultFolders: false, globalExtraFolders: [globalExtra] };
        const workspaces = await store.getWorkspaces();
        workspaces[0].extraSkillFolders = ['extra'];
        vi.mocked(store.getWorkspaces).mockResolvedValue(workspaces);
        const files = [
            skill(path.join(repo, '.github', 'skills')),
            skill(path.join(dataDir, 'skills')),
            skill(path.join(globalExtra, '.github', 'skills')),
            skill(workspaceExtra),
        ];
        for (const file of files) {
            expect((await resolve()).dispatcherSkillPath).toBe(file);
            fs.rmSync(path.dirname(file), { recursive: true });
        }
        await expect(resolve()).rejects.toThrow('unavailable');
    });

    it('does not use a different workspace dispatcher', async () => {
        skill(path.join(root, 'other', '.github', 'skills'));
        await expect(resolve()).rejects.toThrow('unavailable');
    });

    it.each([false, undefined])('rejects disabled or omitted enablement (%s) without reads', async enabled => {
        config.features = { teamsReactionDelegation: enabled };
        await expect(resolve()).rejects.toThrow('disabled');
        expect(store.getWorkspaces).not.toHaveBeenCalled();
    });

    it.each([
        {}, { workspaceId: 'workspace-a' }, { dispatcherSkill: 'dispatcher' },
    ])('rejects incomplete bindings %j', async binding => {
        config.teamsReactionDelegation = binding;
        await expect(resolve()).rejects.toThrow('incomplete');
        expect(store.getWorkspaces).not.toHaveBeenCalled();
    });

    it.each(['../dispatcher', 'a/b', 'a\\b', 'a..b', ' dispatcher', 'a'.repeat(257)])(
        'rejects unsafe dispatcher names (%s) before reads', async dispatcherSkill => {
            config.teamsReactionDelegation!.dispatcherSkill = dispatcherSkill;
            await expect(resolve()).rejects.toThrow('Invalid');
            expect(store.getWorkspaces).not.toHaveBeenCalled();
        },
    );

    it('rejects remote workspace selectors before reads', async () => {
        config.teamsReactionDelegation!.workspaceId = 'remote:server:workspace-a';
        await expect(resolve()).rejects.toThrow('Invalid');
        expect(store.getWorkspaces).not.toHaveBeenCalled();
    });

    it('rejects removed workspaces', async () => {
        vi.mocked(store.getWorkspaces).mockResolvedValue([]);
        await expect(resolve()).rejects.toThrow('workspace is unavailable');
    });

    it.each([{ virtual: true }, { rootPath: 'relative' }])('rejects invalid workspace registrations %j', async patch => {
        const workspaces = await store.getWorkspaces();
        vi.mocked(store.getWorkspaces).mockResolvedValue([{ ...workspaces[0], ...patch }]);
        await expect(resolve()).rejects.toThrow('workspace is unavailable');
    });

    it('rejects a missing execution directory', async () => {
        fs.rmdirSync(repo);
        await expect(resolve()).rejects.toThrow();
    });

    it('rejects a file as execution directory', async () => {
        fs.rmdirSync(repo);
        fs.writeFileSync(repo, 'not a directory');
        await expect(resolve()).rejects.toThrow('workspace is unavailable');
    });

    it('rejects workspace disabled skills', async () => {
        skill(path.join(repo, '.github', 'skills'));
        const workspaces = await store.getWorkspaces();
        vi.mocked(store.getWorkspaces).mockResolvedValue([{ ...workspaces[0], disabledSkills: ['dispatcher'] }]);
        await expect(resolve()).rejects.toThrow('skill is disabled');
    });

    it('rechecks global disabled skills on every call without UI cache', async () => {
        skill(path.join(repo, '.github', 'skills'));
        await resolve();
        fs.writeFileSync(path.join(dataDir, 'preferences.json'), JSON.stringify({ globalDisabledSkills: ['dispatcher'] }));
        await expect(resolve()).rejects.toThrow('skill is disabled');
    });

    it.each(['{invalid', 'null', '[]', '{"globalDisabledSkills":"dispatcher"}', '{"globalDisabledSkills":[42]}'])(
        'rejects unreadable or malformed global policy (%s)', async content => {
            skill(path.join(repo, '.github', 'skills'));
            fs.writeFileSync(path.join(dataDir, 'preferences.json'), content);
            await expect(resolve()).rejects.toThrow();
        },
    );

    it('propagates a failed workspace policy read', async () => {
        skill(path.join(repo, '.github', 'skills'));
        const workspaces = await store.getWorkspaces();
        vi.mocked(store.getWorkspaces).mockResolvedValueOnce(workspaces).mockRejectedValueOnce(new Error('policy read failed'));
        await expect(resolve()).rejects.toThrow('policy read failed');
    });

    it('rejects inaccessible global preferences rather than ignoring policy', async () => {
        skill(path.join(repo, '.github', 'skills'));
        vi.spyOn(fs.promises, 'access').mockRejectedValueOnce(Object.assign(new Error('policy access denied'), { code: 'EACCES' }));
        await expect(resolve()).rejects.toThrow('policy access denied');
    });

    it('rejects a failed policy file read', async () => {
        skill(path.join(repo, '.github', 'skills'));
        fs.writeFileSync(path.join(dataDir, 'preferences.json'), '{}');
        vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(new Error('policy read denied'));
        await expect(resolve()).rejects.toThrow('policy read denied');
    });

    it.each(['removed', 'retargeted'])('rejects a workspace %s during resolution', async change => {
        skill(path.join(repo, '.github', 'skills'));
        const workspaces = await store.getWorkspaces();
        vi.mocked(store.getWorkspaces).mockResolvedValueOnce(workspaces).mockResolvedValueOnce(
            change === 'removed' ? [] : [{ ...workspaces[0], rootPath: root }],
        );
        await expect(resolve()).rejects.toThrow('workspace is unavailable or changed');
    });

    it.each(['', '---\nname: dispatcher\n---\n', '   \n'])(
        'rejects an empty highest-priority dispatcher without lower-priority fallback (%j)', async body => {
            skill(path.join(repo, '.github', 'skills'), body);
            skill(path.join(dataDir, 'skills'));
            await expect(resolve()).rejects.toThrow('empty');
        },
    );

    it('rejects a missing highest-priority SKILL.md without fallback', async () => {
        const file = skill(path.join(repo, '.github', 'skills'));
        fs.unlinkSync(file);
        skill(path.join(dataDir, 'skills'));
        await expect(resolve()).rejects.toThrow('missing SKILL.md');
    });

    it('rejects unreadable dispatcher content without lower-priority fallback', async () => {
        skill(path.join(repo, '.github', 'skills'));
        skill(path.join(dataDir, 'skills'));
        vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(new Error('skill read denied'));
        await expect(resolve()).rejects.toThrow('skill read denied');
    });

    it('rechecks skill deletion on every call', async () => {
        const file = skill(path.join(repo, '.github', 'skills'));
        await resolve();
        fs.rmSync(path.dirname(file), { recursive: true });
        await expect(resolve()).rejects.toThrow('unavailable');
    });

    it('rejects an invalid configured skill source rather than skipping it', async () => {
        fs.mkdirSync(path.join(repo, '.github'));
        fs.writeFileSync(path.join(repo, '.github', 'skills'), 'not a directory');
        skill(path.join(dataDir, 'skills'));
        await expect(resolve()).rejects.toThrow('not a directory');
    });

    it('honors an already aborted call without reads', async () => {
        controller.abort(new Error('cancelled'));
        await expect(resolve()).rejects.toThrow('cancelled');
        expect(store.getWorkspaces).not.toHaveBeenCalled();
    });

    it('rejects late workspace results after cancellation', async () => {
        const workspaces = await store.getWorkspaces();
        vi.mocked(store.getWorkspaces).mockImplementation(async () => {
            controller.abort(new Error('cancelled'));
            return workspaces;
        });
        await expect(resolve()).rejects.toThrow('cancelled');
    });
});
