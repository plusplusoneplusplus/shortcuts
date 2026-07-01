/**
 * Tests for groupSkillsByFolder utility.
 */

import { describe, it, expect } from 'vitest';
import { groupSkillsByFolder } from '../../../../src/server/spa/client/react/features/skills/AgentSkillsPanel';
import type { Skill } from '../../../../src/server/spa/client/react/features/skills/AgentSkillsPanel';

describe('groupSkillsByFolder', () => {
    const emptyRepos = new Map<string, any>();

    it('returns empty array for no skills', () => {
        expect(groupSkillsByFolder([], emptyRepos)).toEqual([]);
    });

    it('groups local repo skills into "repo" group', () => {
        const skills: Skill[] = [
            { name: 'skill-a', source: 'repo', folderPath: '/repo/.github/skills' },
            { name: 'skill-b', source: 'repo', folderPath: '/repo/.github/skills' },
        ];
        const groups = groupSkillsByFolder(skills, emptyRepos);
        expect(groups).toHaveLength(1);
        expect(groups[0].key).toBe('repo');
        expect(groups[0].label).toBe('📁 .github/skills');
        expect(groups[0].source).toBe('repo');
        expect(groups[0].skills).toHaveLength(2);
        expect(groups[0].isRemovable).toBe(false);
    });

    it('groups global skills into "global" group first', () => {
        const skills: Skill[] = [
            { name: 'local', source: 'repo', folderPath: '/repo/.github/skills' },
            { name: 'global-one', source: 'global', folderPath: '/data/skills' },
        ];
        const groups = groupSkillsByFolder(skills, emptyRepos);
        expect(groups).toHaveLength(2);
        expect(groups[0].key).toBe('global');
        expect(groups[0].label).toBe('🌐 Global');
        expect(groups[0].source).toBe('global');
        expect(groups[0].isRemovable).toBe(false);
        expect(groups[1].key).toBe('repo');
    });

    it('groups linked-repo skills by folderPath', () => {
        const skills: Skill[] = [
            { name: 'linked', source: 'linked-repo', folderPath: '/other/.github/skills', sourceRepoId: 'ws-other' },
        ];
        const repoById = new Map([
            ['ws-other', { id: 'ws-other', name: 'OtherRepo', rootPath: '/other' }],
        ]);
        const groups = groupSkillsByFolder(skills, repoById);
        expect(groups).toHaveLength(1);
        expect(groups[0].label).toBe('📂 OtherRepo');
        expect(groups[0].source).toBe('linked-repo');
        expect(groups[0].repoId).toBe('ws-other');
        expect(groups[0].isRemovable).toBe(true);
    });

    it('groups extra-folder skills by folderPath with path as label', () => {
        const skills: Skill[] = [
            { name: 'extra', source: 'extra-folder', folderPath: '/custom/path' },
        ];
        const groups = groupSkillsByFolder(skills, emptyRepos);
        expect(groups).toHaveLength(1);
        expect(groups[0].label).toBe('📂 /custom/path');
        expect(groups[0].source).toBe('extra-folder');
        expect(groups[0].isRemovable).toBe(true);
        expect(groups[0].repoId).toBeUndefined();
    });

    it('places groups in order: global, repo, extras', () => {
        const skills: Skill[] = [
            { name: 'extra', source: 'extra-folder', folderPath: '/custom/path' },
            { name: 'local', source: 'repo', folderPath: '/repo/.github/skills' },
            { name: 'global-one', source: 'global', folderPath: '/data/skills' },
        ];
        const groups = groupSkillsByFolder(skills, emptyRepos);
        expect(groups.map(g => g.source)).toEqual(['global', 'repo', 'extra-folder']);
    });

    it('skills with no source are grouped into repo group', () => {
        const skills: Skill[] = [
            { name: 'orphan' },
        ];
        const groups = groupSkillsByFolder(skills, emptyRepos);
        expect(groups).toHaveLength(1);
        expect(groups[0].key).toBe('repo');
    });

    it('multiple extra folders create separate groups', () => {
        const skills: Skill[] = [
            { name: 'skill-a', source: 'extra-folder', folderPath: '/folder-a' },
            { name: 'skill-b', source: 'extra-folder', folderPath: '/folder-b' },
        ];
        const groups = groupSkillsByFolder(skills, emptyRepos);
        expect(groups).toHaveLength(2);
        const keys = groups.map(g => g.folderPath);
        expect(keys).toContain('/folder-a');
        expect(keys).toContain('/folder-b');
    });

    it('multiple skills in same extra folder share one group', () => {
        const skills: Skill[] = [
            { name: 'skill-a', source: 'extra-folder', folderPath: '/folder-a' },
            { name: 'skill-b', source: 'extra-folder', folderPath: '/folder-a' },
        ];
        const groups = groupSkillsByFolder(skills, emptyRepos);
        expect(groups).toHaveLength(1);
        expect(groups[0].skills).toHaveLength(2);
    });

    // ----- configured global extra folders (AC #2) -----

    it('groups global-extra-folder skills into a non-removable group by folderPath', () => {
        const skills: Skill[] = [
            { name: 'ge-a', source: 'global-extra-folder', folderPath: '/opt/shared-skills' },
            { name: 'ge-b', source: 'global-extra-folder', folderPath: '/opt/shared-skills' },
        ];
        const groups = groupSkillsByFolder(skills, emptyRepos);
        expect(groups).toHaveLength(1);
        expect(groups[0].source).toBe('global-extra-folder');
        expect(groups[0].label).toBe('🌐 /opt/shared-skills');
        expect(groups[0].isRemovable).toBe(false);
        expect(groups[0].skills).toHaveLength(2);
    });

    it('orders global-extra groups after global/repo and before per-repo extra folders', () => {
        const skills: Skill[] = [
            { name: 'extra', source: 'extra-folder', folderPath: '/custom/path' },
            { name: 'ge', source: 'global-extra-folder', folderPath: '/opt/shared' },
            { name: 'local', source: 'repo', folderPath: '/repo/.github/skills' },
            { name: 'global-one', source: 'global', folderPath: '/data/skills' },
        ];
        const groups = groupSkillsByFolder(skills, emptyRepos);
        expect(groups.map(g => g.source)).toEqual(['global', 'repo', 'global-extra-folder', 'extra-folder']);
    });

    it('multiple global-extra folders create separate groups', () => {
        const skills: Skill[] = [
            { name: 'a', source: 'global-extra-folder', folderPath: '/opt/one' },
            { name: 'b', source: 'global-extra-folder', folderPath: '/opt/two' },
        ];
        const groups = groupSkillsByFolder(skills, emptyRepos);
        expect(groups).toHaveLength(2);
        expect(groups.map(g => g.folderPath).sort()).toEqual(['/opt/one', '/opt/two']);
    });
});
