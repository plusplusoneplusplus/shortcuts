/**
 * Tests for OneDrive skill directory support in loadSkillsForWorkspace.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Capture real homedir before any mock takes effect.
// eslint-disable-next-line no-var
var _realHomedir: string;

vi.mock('os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('os')>();
    _realHomedir = actual.homedir();
    return {
        ...actual,
        homedir: vi.fn(() => _realHomedir),
    };
});

import { loadSkillsForWorkspace, skillCache } from '../../src/server/skills/skill-handler';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { WorkspaceInfo } from '@plusplusoneplusplus/forge';

describe('loadSkillsForWorkspace — OneDrive skill directories', () => {
    let tmpDir: string;
    let workspaceDir: string;
    let store: ReturnType<typeof createMockProcessStore>;
    const workspaceId = 'ws-onedrive-test';

    beforeEach(() => {
        skillCache.clear();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-od-'));
        workspaceDir = path.join(tmpDir, 'repo');
        fs.mkdirSync(workspaceDir, { recursive: true });
        store = createMockProcessStore({
            initialWorkspaces: [{
                id: workspaceId,
                name: 'Test Workspace',
                rootPath: workspaceDir,
            } as WorkspaceInfo],
        });
        store.getWorkspaces = vi.fn(async () => [{
            id: workspaceId,
            name: 'Test Workspace',
            rootPath: workspaceDir,
        } as WorkspaceInfo]);
        vi.mocked(os.homedir).mockImplementation(() => _realHomedir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('includes skills from OneDrive/.github/skills', async () => {
        const fakeHome = path.join(tmpDir, 'home');
        const oneDriveSkillsDir = path.join(fakeHome, 'OneDrive', '.github', 'skills');
        fs.mkdirSync(path.join(oneDriveSkillsDir, 'od-skill'), { recursive: true });
        fs.writeFileSync(path.join(oneDriveSkillsDir, 'od-skill', 'SKILL.md'), '---\ndescription: OneDrive skill\n---\n# od-skill');
        vi.mocked(os.homedir).mockReturnValue(fakeHome);

        const ws: WorkspaceInfo = { id: workspaceId, name: 'Test', rootPath: workspaceDir } as WorkspaceInfo;
        const skills = await loadSkillsForWorkspace(ws, undefined, store);

        const odSkill = skills.find(s => s.name === 'od-skill');
        expect(odSkill).toBeDefined();
        expect(odSkill!.source).toBe('extra-folder');
        expect(odSkill!.folderPath).toBe(oneDriveSkillsDir);
        expect(odSkill!.description).toBe('OneDrive skill');
    });

    it('includes skills from OneDrive - Microsoft/.github/skills', async () => {
        const fakeHome = path.join(tmpDir, 'home');
        const oneDriveMsSkillsDir = path.join(fakeHome, 'OneDrive - Microsoft', '.github', 'skills');
        fs.mkdirSync(path.join(oneDriveMsSkillsDir, 'ms-skill'), { recursive: true });
        fs.writeFileSync(path.join(oneDriveMsSkillsDir, 'ms-skill', 'SKILL.md'), '---\ndescription: MS OneDrive skill\n---\n# ms-skill');
        vi.mocked(os.homedir).mockReturnValue(fakeHome);

        const ws: WorkspaceInfo = { id: workspaceId, name: 'Test', rootPath: workspaceDir } as WorkspaceInfo;
        const skills = await loadSkillsForWorkspace(ws, undefined, store);

        const msSkill = skills.find(s => s.name === 'ms-skill');
        expect(msSkill).toBeDefined();
        expect(msSkill!.source).toBe('extra-folder');
        expect(msSkill!.folderPath).toBe(oneDriveMsSkillsDir);
    });

    it('includes skills from both OneDrive variants when both exist', async () => {
        const fakeHome = path.join(tmpDir, 'home');
        const oneDriveDir = path.join(fakeHome, 'OneDrive', '.github', 'skills');
        const oneDriveMsDir = path.join(fakeHome, 'OneDrive - Microsoft', '.github', 'skills');
        fs.mkdirSync(path.join(oneDriveDir, 'skill-a'), { recursive: true });
        fs.writeFileSync(path.join(oneDriveDir, 'skill-a', 'SKILL.md'), '# skill-a');
        fs.mkdirSync(path.join(oneDriveMsDir, 'skill-b'), { recursive: true });
        fs.writeFileSync(path.join(oneDriveMsDir, 'skill-b', 'SKILL.md'), '# skill-b');
        vi.mocked(os.homedir).mockReturnValue(fakeHome);

        const ws: WorkspaceInfo = { id: workspaceId, name: 'Test', rootPath: workspaceDir } as WorkspaceInfo;
        const skills = await loadSkillsForWorkspace(ws, undefined, store);

        const names = skills.map(s => s.name);
        expect(names).toContain('skill-a');
        expect(names).toContain('skill-b');
    });

    it('skips OneDrive directories that do not exist', async () => {
        const fakeHome = path.join(tmpDir, 'home');
        fs.mkdirSync(fakeHome, { recursive: true });
        vi.mocked(os.homedir).mockReturnValue(fakeHome);

        const ws: WorkspaceInfo = { id: workspaceId, name: 'Test', rootPath: workspaceDir } as WorkspaceInfo;
        const skills = await loadSkillsForWorkspace(ws, undefined, store);

        // Should not error and return empty (or only local/global)
        expect(skills).toEqual([]);
    });

    it('local repo skills take precedence over OneDrive skills with same name', async () => {
        const fakeHome = path.join(tmpDir, 'home');
        const oneDriveDir = path.join(fakeHome, 'OneDrive', '.github', 'skills');
        fs.mkdirSync(path.join(oneDriveDir, 'shared-skill'), { recursive: true });
        fs.writeFileSync(path.join(oneDriveDir, 'shared-skill', 'SKILL.md'), '---\ndescription: onedrive version\n---');
        vi.mocked(os.homedir).mockReturnValue(fakeHome);

        // Create local skill with same name
        const localSkillsDir = path.join(workspaceDir, '.github', 'skills');
        fs.mkdirSync(path.join(localSkillsDir, 'shared-skill'), { recursive: true });
        fs.writeFileSync(path.join(localSkillsDir, 'shared-skill', 'SKILL.md'), '---\ndescription: local version\n---');

        const ws: WorkspaceInfo = { id: workspaceId, name: 'Test', rootPath: workspaceDir } as WorkspaceInfo;
        const skills = await loadSkillsForWorkspace(ws, undefined, store);

        const shared = skills.find(s => s.name === 'shared-skill');
        expect(shared).toBeDefined();
        expect(shared!.source).toBe('repo');
        expect(shared!.description).toBe('local version');
    });

    it('global skills take precedence over OneDrive skills with same name', async () => {
        const fakeHome = path.join(tmpDir, 'home');
        const oneDriveDir = path.join(fakeHome, 'OneDrive', '.github', 'skills');
        fs.mkdirSync(path.join(oneDriveDir, 'shared-skill'), { recursive: true });
        fs.writeFileSync(path.join(oneDriveDir, 'shared-skill', 'SKILL.md'), '---\ndescription: onedrive version\n---');
        vi.mocked(os.homedir).mockReturnValue(fakeHome);

        // Create global skill with same name
        const dataDir = path.join(tmpDir, 'data');
        const globalSkillsDir = path.join(dataDir, 'skills');
        fs.mkdirSync(path.join(globalSkillsDir, 'shared-skill'), { recursive: true });
        fs.writeFileSync(path.join(globalSkillsDir, 'shared-skill', 'SKILL.md'), '---\ndescription: global version\n---');

        const ws: WorkspaceInfo = { id: workspaceId, name: 'Test', rootPath: workspaceDir } as WorkspaceInfo;
        const skills = await loadSkillsForWorkspace(ws, dataDir, store);

        const shared = skills.find(s => s.name === 'shared-skill');
        expect(shared).toBeDefined();
        expect(shared!.source).toBe('global');
        expect(shared!.description).toBe('global version');
    });

    it('extra-folder skills take precedence over OneDrive skills with same name', async () => {
        const fakeHome = path.join(tmpDir, 'home');
        const oneDriveDir = path.join(fakeHome, 'OneDrive', '.github', 'skills');
        fs.mkdirSync(path.join(oneDriveDir, 'shared-skill'), { recursive: true });
        fs.writeFileSync(path.join(oneDriveDir, 'shared-skill', 'SKILL.md'), '---\ndescription: onedrive version\n---');
        vi.mocked(os.homedir).mockReturnValue(fakeHome);

        // Create extra-folder skill with same name
        const extraDir = path.join(tmpDir, 'extra');
        fs.mkdirSync(path.join(extraDir, 'shared-skill'), { recursive: true });
        fs.writeFileSync(path.join(extraDir, 'shared-skill', 'SKILL.md'), '---\ndescription: extra version\n---');

        store.getWorkspaces = vi.fn(async () => [{
            id: workspaceId,
            name: 'Test',
            rootPath: workspaceDir,
            extraSkillFolders: [extraDir],
        } as WorkspaceInfo]);

        const ws: WorkspaceInfo = { id: workspaceId, name: 'Test', rootPath: workspaceDir, extraSkillFolders: [extraDir] } as WorkspaceInfo;
        const skills = await loadSkillsForWorkspace(ws, undefined, store);

        const shared = skills.find(s => s.name === 'shared-skill');
        expect(shared).toBeDefined();
        expect(shared!.source).toBe('extra-folder');
        expect(shared!.description).toBe('extra version');
    });
});
