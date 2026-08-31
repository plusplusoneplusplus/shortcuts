/**
 * Tests for source-canvas repo attribution — stable per-repo colors, member
 * labels, group-chat detection, and switcher grouping (incl. the not-yet-
 * resolved bucket).
 */
import { describe, it, expect } from 'vitest';
import {
    REPO_ACCENT_COLORS,
    UNRESOLVED_REPO_COLOR,
    UNRESOLVED_REPO_LABEL,
    getActiveRepoAttribution,
    getExplicitRepoOwner,
    getRepoAccentColor,
    getRepoLabel,
    getSourceFileDisplayPath,
    groupSourceFilesByRepo,
    isRepoGroupWorkspaceId,
} from '../../../src/server/spa/client/react/features/chat/source-canvas/repoAttribution';
import { getConversationSourceFileKey } from '../../../src/server/spa/client/react/features/chat/source-canvas/conversationSourceFiles';
import type { ConversationSourceFile } from '../../../src/server/spa/client/react/features/chat/source-canvas/conversationSourceFiles';

const WORKSPACES = [
    { id: 'ws-vllm', name: 'vllm', rootPath: '/home/u/projects/vllm' },
    { id: 'ws-nixl', rootPath: '/home/u/projects/nixl' },
];

function file(fullPath: string, wsId = 'group-ml'): ConversationSourceFile {
    return { fullPath, wsId, kind: 'code' };
}

describe('getRepoAccentColor', () => {
    it('is stable for a workspace id and drawn from the palette', () => {
        const color = getRepoAccentColor('ws-vllm');
        expect(REPO_ACCENT_COLORS).toContain(color as typeof REPO_ACCENT_COLORS[number]);
        expect(getRepoAccentColor('ws-vllm')).toBe(color);
        // Case/whitespace differences describe the same workspace.
        expect(getRepoAccentColor('  WS-VLLM ')).toBe(color);
    });

    it('spreads distinct workspace ids across more than one palette entry', () => {
        const colors = new Set(
            ['ws-a', 'ws-b', 'ws-c', 'ws-d', 'ws-e', 'ws-f'].map(getRepoAccentColor),
        );
        expect(colors.size).toBeGreaterThan(1);
    });
});

describe('getRepoLabel', () => {
    it('prefers the workspace name', () => {
        expect(getRepoLabel('ws-vllm', WORKSPACES)).toBe('vllm');
    });

    it('falls back to the root basename, then to the id', () => {
        expect(getRepoLabel('ws-nixl', WORKSPACES)).toBe('nixl');
        expect(getRepoLabel('ws-unknown', WORKSPACES)).toBe('ws-unknown');
        expect(getRepoLabel('ws-x', [{ id: 'ws-x' }])).toBe('ws-x');
    });

    it('reads a Windows-style root basename without a trailing separator', () => {
        expect(getRepoLabel('ws-w', [{ id: 'ws-w', rootPath: 'C:\\src\\vllm\\' }])).toBe('vllm');
    });
});

describe('isRepoGroupWorkspaceId', () => {
    it('recognizes group ids only', () => {
        expect(isRepoGroupWorkspaceId('group-ml')).toBe(true);
        expect(isRepoGroupWorkspaceId('ws-vllm')).toBe(false);
        expect(isRepoGroupWorkspaceId(null)).toBe(false);
    });
});

describe('getActiveRepoAttribution', () => {
    it('returns nothing for a plain single-repo chat', () => {
        expect(getActiveRepoAttribution('ws-vllm', 'ws-vllm', WORKSPACES)).toBeNull();
    });

    it('labels the owning member in a repo-group chat', () => {
        expect(getActiveRepoAttribution('group-ml', 'ws-vllm', WORKSPACES)).toEqual({
            wsId: 'ws-vllm',
            label: 'vllm',
            color: getRepoAccentColor('ws-vllm'),
        });
    });

    it('stays quiet until the owning member is known', () => {
        expect(getActiveRepoAttribution('group-ml', 'group-ml', WORKSPACES)).toBeNull();
        expect(getActiveRepoAttribution('group-ml', null, WORKSPACES)).toBeNull();
    });

    it('labels a file rerouted out of the chat workspace', () => {
        expect(getActiveRepoAttribution('ws-vllm', 'ws-nixl', WORKSPACES)?.label).toBe('nixl');
    });
});

describe('groupSourceFilesByRepo', () => {
    const vllmFile = file('vllm/v1/engine/core.py');
    const nixlFile = file('src/plugins/hf3fs/utils.cpp');
    const unopened = file('vllm/core/scheduler.py');
    const resolved = new Map([
        [getConversationSourceFileKey('group-ml', vllmFile.fullPath), 'ws-vllm'],
        [getConversationSourceFileKey('group-ml', nixlFile.fullPath), 'ws-nixl'],
    ]);

    it('buckets by owning repo in first-appearance order, unresolved last', () => {
        const groups = groupSourceFilesByRepo(
            [vllmFile, unopened, nixlFile],
            resolved,
            WORKSPACES,
        );
        expect(groups.map((g) => [g.wsId, g.label])).toEqual([
            ['ws-vllm', 'vllm'],
            ['ws-nixl', 'nixl'],
            [null, UNRESOLVED_REPO_LABEL],
        ]);
        expect(groups[0].files).toEqual([vllmFile]);
        expect(groups[2].files).toEqual([unopened]);
        expect(groups[0].color).toBe(getRepoAccentColor('ws-vllm'));
    });

    it('keeps several files of one repo together in order', () => {
        const second = file('vllm/v1/core/sched/scheduler.py');
        const groups = groupSourceFilesByRepo(
            [vllmFile, second],
            new Map([
                ...resolved,
                [getConversationSourceFileKey('group-ml', second.fullPath), 'ws-vllm'],
            ]),
            WORKSPACES,
        );
        expect(groups).toHaveLength(1);
        expect(groups[0].files).toEqual([vllmFile, second]);
    });

    it('treats a group workspace id as unresolved', () => {
        const groups = groupSourceFilesByRepo(
            [vllmFile],
            new Map([[getConversationSourceFileKey('group-ml', vllmFile.fullPath), 'group-ml']]),
            WORKSPACES,
        );
        expect(groups.map((g) => g.wsId)).toEqual([null]);
    });

    it('attributes an unopened file by matching its path against a member root', () => {
        const unopenedAbsolute = file('/home/u/projects/nixl/src/plugins/hf3fs/utils.cpp');
        const groups = groupSourceFilesByRepo(
            [vllmFile, unopenedAbsolute],
            resolved,
            WORKSPACES,
        );
        expect(groups.map((g) => [g.wsId, g.label])).toEqual([
            ['ws-vllm', 'vllm'],
            ['ws-nixl', 'nixl'],
        ]);
        expect(groups[1].files).toEqual([unopenedAbsolute]);
    });

    it('stops the root match at a directory boundary', () => {
        const sibling = file('/home/u/projects/nixl-extras/src/a.cpp');
        const groups = groupSourceFilesByRepo([sibling], new Map(), WORKSPACES);
        expect(groups.map((g) => [g.wsId, g.label])).toEqual([[null, UNRESOLVED_REPO_LABEL]]);
    });

    it('matches ignoring separator style and case', () => {
        const windowsWorkspaces = [{ id: 'ws-w', name: 'winrepo', rootPath: 'C:\\src\\Vllm' }];
        const groups = groupSourceFilesByRepo(
            [file('c:\\SRC\\vllm\\v1\\engine\\core.py')],
            new Map(),
            windowsWorkspaces,
        );
        expect(groups.map((g) => g.wsId)).toEqual(['ws-w']);
    });

    it('gives the longest matching root the file, for nested repos', () => {
        const nestedWorkspaces = [
            { id: 'ws-outer', name: 'outer', rootPath: '/home/u/projects' },
            { id: 'ws-vllm', name: 'vllm', rootPath: '/home/u/projects/vllm' },
        ];
        const groups = groupSourceFilesByRepo(
            [file('/home/u/projects/vllm/v1/engine/core.py')],
            new Map(),
            nestedWorkspaces,
        );
        expect(groups.map((g) => g.wsId)).toEqual(['ws-vllm']);
    });

    it('prefers the opened-file answer over the path match', () => {
        const absolute = file('/home/u/projects/vllm/v1/engine/core.py');
        const groups = groupSourceFilesByRepo(
            [absolute],
            new Map([[getConversationSourceFileKey('group-ml', absolute.fullPath), 'ws-nixl']]),
            WORKSPACES,
        );
        expect(groups.map((g) => g.wsId)).toEqual(['ws-nixl']);
    });

    it('falls through to the path match when the opened answer is the group itself', () => {
        const absolute = file('/home/u/projects/vllm/v1/engine/core.py');
        const groups = groupSourceFilesByRepo(
            [absolute],
            new Map([[getConversationSourceFileKey('group-ml', absolute.fullPath), 'group-ml']]),
            WORKSPACES,
        );
        expect(groups.map((g) => g.wsId)).toEqual(['ws-vllm']);
    });

    it('keeps a path outside every member root in the Other bucket, last', () => {
        const outside = file('/tmp/scratch/notes.py');
        const groups = groupSourceFilesByRepo(
            [outside, file('/home/u/projects/vllm/a.py')],
            new Map(),
            WORKSPACES,
        );
        expect(groups.map((g) => [g.wsId, g.label])).toEqual([
            ['ws-vllm', 'vllm'],
            [null, UNRESOLVED_REPO_LABEL],
        ]);
        expect(groups[1].color).toBe(UNRESOLVED_REPO_COLOR);
        expect(groups[1].files).toEqual([outside]);
    });

    it('never attributes a file to a group workspace', () => {
        const groups = groupSourceFilesByRepo(
            [file('/home/u/groups/ml/a.py')],
            new Map(),
            [{ id: 'group-ml', name: 'ml', rootPath: '/home/u/groups/ml' }],
        );
        expect(groups.map((g) => g.wsId)).toEqual([null]);
    });

    it('leaves the display path of a newly attributed row unchanged', () => {
        const absolute = file('/home/u/projects/vllm/v1/engine/core.py');
        const before = getSourceFileDisplayPath(absolute, null, WORKSPACES, '/chat/root');
        const groups = groupSourceFilesByRepo([absolute], new Map(), WORKSPACES);
        expect(groups[0].wsId).toBe('ws-vllm');
        // The row regroups, but the panel keeps resolving its text against the
        // server-reported owner (none here), so the text is identical.
        const after = getSourceFileDisplayPath(
            absolute,
            getExplicitRepoOwner(absolute, new Map()),
            WORKSPACES,
            '/chat/root',
        );
        expect(after).toBe(before);
        expect(after).toBe('/home/u/projects/vllm/v1/engine/core.py');
    });

    it('returns no groups for an empty file list', () => {
        expect(groupSourceFilesByRepo([], new Map(), WORKSPACES)).toEqual([]);
    });
});

describe('getSourceFileDisplayPath', () => {
    it('shortens an absolute path against the owning member root', () => {
        const absolute = file('/home/u/projects/vllm/v1/engine/core.py');
        expect(getSourceFileDisplayPath(absolute, 'ws-vllm', WORKSPACES, '/other/root'))
            .toBe('v1/engine/core.py');
    });

    it('falls back to the panel root when the owner is unknown', () => {
        const absolute = file('/other/root/a/b.py');
        expect(getSourceFileDisplayPath(absolute, null, WORKSPACES, '/other/root')).toBe('a/b.py');
    });

    it('prefers an explicit displayPath', () => {
        const withDisplay: ConversationSourceFile = {
            ...file('/home/u/projects/vllm/v1/engine/core.py'),
            displayPath: 'v1/engine/core.py',
        };
        expect(getSourceFileDisplayPath(withDisplay, 'ws-nixl', WORKSPACES, null))
            .toBe('v1/engine/core.py');
    });
});
