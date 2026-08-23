import { describe, expect, it } from 'vitest';
import {
    buildSkillsResolutionItems,
    buildSkillsSources,
    filterWorkspaceSkills,
    getSkillSourcePresentation,
    groupSkillsByFolder,
    isResolvedSkillFolderForConfiguredSource,
    type Skill,
} from '../../../../src/server/spa/client/react/features/skills/skills-ui-model';

const repos = new Map([
    ['linked', { id: 'linked', name: 'Shared tools', rootPath: 'C:\\shared', color: '#abc' }],
]);

const skills: Skill[] = [
    { name: 'local', source: 'repo', folderPath: 'C:\\repo\\.github\\skills', variables: ['LOCAL'] },
    { name: 'global', source: 'global', folderPath: 'C:\\data\\skills' },
    { name: 'shared', source: 'linked-repo', sourceRepoId: 'linked', folderPath: 'C:\\shared\\.github\\skills' },
    { name: 'extra', source: 'extra-folder', folderPath: 'C:\\custom\\skills', description: 'Custom helper' },
];

describe('skills-ui-model', () => {
    it('builds stable source rail items from folder groups', () => {
        const sources = buildSkillsSources(skills, groupSkillsByFolder(skills, repos), repos);

        expect(sources.map(source => [source.kind, source.name, source.count])).toEqual([
            ['all', 'All skills', 4],
            ['global', 'Global', 1],
            ['repo', 'This repository', 1],
            ['linked', 'Shared tools', 1],
            ['extra', 'skills', 1],
        ]);
        expect(sources[3]).toMatchObject({ removable: true, repoId: 'linked', repoColor: '#abc' });
    });

    it('rails a repo-group member folder as a non-removable linked source and filters to it', () => {
        const groupSkills: Skill[] = [
            { name: 'alpha', source: 'repo-group-member', sourceRepoId: 'ws-a', folderPath: 'C:\\a\\.github\\skills', folderLabel: 'Repo A' },
            { name: 'global', source: 'global', folderPath: 'C:\\data\\skills' },
        ];
        const sources = buildSkillsSources(groupSkills, groupSkillsByFolder(groupSkills, repos), repos);
        const member = sources.find(source => source.name === 'Repo A');

        expect(member).toMatchObject({ kind: 'linked', count: 1, removable: false, repoId: 'ws-a' });
        expect(getSkillSourcePresentation(groupSkills[0], repos)).toEqual({
            kind: 'linked',
            sourceLabel: 'Repo A',
            sourcePillLabel: 'Repo A',
            hideDelete: true,
        });
        expect(filterWorkspaceSkills({
            skills: groupSkills,
            sources,
            activeSource: member!.id,
            status: 'all',
            searchQuery: '',
            disabledSkills: [],
        }).map(skill => skill.name)).toEqual(['alpha']);
    });

    it('combines source, status, and text filters without mutating the input', () => {
        const sources = buildSkillsSources(skills, groupSkillsByFolder(skills, repos), repos);
        const original = [...skills];

        expect(filterWorkspaceSkills({
            skills,
            sources,
            activeSource: 'group:repo',
            status: 'on',
            searchQuery: 'local',
            disabledSkills: [],
        }).map(skill => skill.name)).toEqual(['local']);
        expect(filterWorkspaceSkills({
            skills,
            sources,
            activeSource: 'all',
            status: 'off',
            searchQuery: '',
            disabledSkills: ['shared'],
        }).map(skill => skill.name)).toEqual(['shared']);
        expect(skills).toEqual(original);
    });

    it('builds resolution rows with cross-platform linked-folder detection', () => {
        const rows = buildSkillsResolutionItems(
            groupSkillsByFolder(skills, repos),
            ['C:/shared/.github/skills', 'C:\\custom\\skills'],
            ['linked'],
            repos,
        );

        expect(rows.map(row => [row.kind, row.label])).toEqual([
            ['global', 'Global'],
            ['repo', 'This repository'],
            ['linked', 'Shared tools'],
            ['extra', 'skills'],
        ]);
        expect(rows[2]).toMatchObject({ upDisabled: true, downDisabled: false, reorderable: true });
        expect(rows[3]).toMatchObject({ upDisabled: false, downDisabled: true, reorderable: true });
    });

    it('keeps config-managed global extras visible and non-removable', () => {
        const globalExtra: Skill = { name: 'org-skill', source: 'global-extra-folder', folderPath: '/org/skills' };
        const sources = buildSkillsSources([globalExtra], groupSkillsByFolder([globalExtra], new Map()), new Map());

        expect(sources[1]).toMatchObject({ kind: 'extra', name: 'skills', removable: false });
        expect(getSkillSourcePresentation(globalExtra, new Map())).toMatchObject({
            kind: 'extra',
            sourceLabel: '/org/skills',
            hideDelete: true,
        });
        expect(getSkillSourcePresentation(skills[3], repos)).toMatchObject({
            kind: 'extra',
            hideDelete: true,
        });
    });

    it('matches each server-supported extra-folder container shape', () => {
        expect(isResolvedSkillFolderForConfiguredSource('/shared', '/shared')).toBe(true);
        expect(isResolvedSkillFolderForConfiguredSource('/shared/.github/skills', '/shared')).toBe(true);
        expect(isResolvedSkillFolderForConfiguredSource('C:\\shared\\skills', 'C:/shared')).toBe(true);
        expect(isResolvedSkillFolderForConfiguredSource('/shared-other/skills', '/shared')).toBe(false);
    });
});
