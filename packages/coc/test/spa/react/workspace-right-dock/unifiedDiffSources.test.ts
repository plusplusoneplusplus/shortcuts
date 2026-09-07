/**
 * AC-02/AC-04: the transient source registry behind unified-panel `diff` tabs.
 *
 * A diff tab persists, but the group it renders does not — it is rebuilt from a
 * chat's captured tool calls. These cases pin the join: that the source id is a
 * content key (so the footer and a file row open one tab), that an unchanged
 * re-registration keeps the stored context identity (so the panel's file
 * selection is not reset under the user), that a genuinely different open
 * replaces it, and that the registry stays bounded.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
    MAX_DIFF_SOURCES,
    clearUnifiedDiffSources,
    getUnifiedDiffSource,
    registerUnifiedDiffSource,
    whisperDiffSourceId,
    whisperDiffTabInput,
    whisperDiffTabLabel,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedDiffSources';
import type { WhisperDiffOpenContext } from '../../../../src/server/spa/client/react/features/chat/conversation/tool-calls/WhisperCollapsedGroup';
import type { FileEdit } from '../../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';

function fileEdit(path: string, overrides: Partial<FileEdit> = {}): FileEdit {
    return {
        path,
        insertions: 2,
        deletions: 1,
        netInsertions: 2,
        netDeletions: 1,
        isCreate: false,
        isDeleted: false,
        ...overrides,
    };
}

function ctxOf(overrides: Partial<WhisperDiffOpenContext> = {}): WhisperDiffOpenContext {
    return {
        files: [fileEdit('src/a.ts')],
        toolCalls: [{ toolName: 'edit', args: { path: 'src/a.ts', oldString: 'a', newString: 'b' } }],
        commits: [],
        ...overrides,
    };
}

beforeEach(() => {
    clearUnifiedDiffSources();
});

describe('whisperDiffSourceId', () => {
    it('is stable for the same group across separate context objects', () => {
        expect(whisperDiffSourceId(ctxOf())).toBe(whisperDiffSourceId(ctxOf()));
    });

    it('ignores the focused file, so a file row and the footer share one tab', () => {
        expect(whisperDiffSourceId(ctxOf({ focusPath: 'src/a.ts' }))).toBe(whisperDiffSourceId(ctxOf()));
    });

    it('separates groups that differ in files, totals, tool calls, or workspace', () => {
        const base = whisperDiffSourceId(ctxOf());
        expect(whisperDiffSourceId(ctxOf({ files: [fileEdit('src/b.ts')] }))).not.toBe(base);
        expect(whisperDiffSourceId(ctxOf({ files: [fileEdit('src/a.ts', { netInsertions: 9 })] }))).not.toBe(base);
        expect(whisperDiffSourceId(ctxOf({
            toolCalls: [{ toolName: 'edit', args: { path: 'src/a.ts', oldString: 'a', newString: 'c' } }],
        }))).not.toBe(base);
        expect(whisperDiffSourceId(ctxOf({ workspaceId: 'ws-other' }))).not.toBe(base);
    });

    it('survives a tool call whose args cannot be serialized', () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(() => whisperDiffSourceId(ctxOf({ toolCalls: [{ toolName: 'edit', args: cyclic }] }))).not.toThrow();
    });
});

describe('registerUnifiedDiffSource', () => {
    it('keeps the stored record when the same group is registered again', () => {
        const id = registerUnifiedDiffSource(ctxOf(), { workspaceRootPath: '/repo' });
        const first = getUnifiedDiffSource(id);
        const again = registerUnifiedDiffSource(ctxOf(), { workspaceRootPath: '/repo' });

        expect(again).toBe(id);
        // Same record identity, so the panel's `useWhisperDiffState` memo holds
        // and the user's file selection is not reset by a re-render upstream.
        expect(getUnifiedDiffSource(id)).toBe(first);
    });

    it('replaces the record when the same group opens on a different file', () => {
        const id = registerUnifiedDiffSource(ctxOf());
        const first = getUnifiedDiffSource(id);
        registerUnifiedDiffSource(ctxOf({ focusPath: 'src/a.ts' }));

        expect(getUnifiedDiffSource(id)).not.toBe(first);
        expect(getUnifiedDiffSource(id)?.ctx.focusPath).toBe('src/a.ts');
    });

    it('carries the workspace root the header shows project-relative paths with', () => {
        const id = registerUnifiedDiffSource(ctxOf(), { workspaceRootPath: '/repo' });
        expect(getUnifiedDiffSource(id)?.workspaceRootPath).toBe('/repo');
    });

    it('evicts the oldest groups past the cap and keeps the newest', () => {
        const ids: string[] = [];
        for (let i = 0; i < MAX_DIFF_SOURCES + 3; i++) {
            ids.push(registerUnifiedDiffSource(ctxOf({ files: [fileEdit(`src/f${i}.ts`)] })));
        }
        expect(getUnifiedDiffSource(ids[0])).toBeNull();
        expect(getUnifiedDiffSource(ids[ids.length - 1])).not.toBeNull();
    });

    it('reports an unknown source as expired rather than throwing', () => {
        expect(getUnifiedDiffSource('whisper-1-nope')).toBeNull();
    });
});

describe('whisperDiffTabInput', () => {
    it('files a chat-owned diff tab at the owning clone and registers its group', () => {
        const input = whisperDiffTabInput({
            ctx: ctxOf({ files: [fileEdit('src/a.ts'), fileEdit('src/b.ts')] }),
            ownerWorkspaceId: 'ws-member',
            chatId: 'chat-1',
            repoLabel: 'member',
            workspaceRootPath: '/repo',
        });

        expect(input.kind).toBe('diff');
        expect(input.ownerWorkspaceId).toBe('ws-member');
        expect(input.chatId).toBe('chat-1');
        expect(input.repoLabel).toBe('member');
        expect(input.label).toBe('2 files changed');
        // A diff surface has no write path, so it must not claim the read-only
        // lock the strip reserves for suppressed-write file tabs.
        expect(input.readOnly).toBeUndefined();
        expect(getUnifiedDiffSource(input.resourceId)?.workspaceRootPath).toBe('/repo');
    });

    it('labels a single-file group in the singular', () => {
        expect(whisperDiffTabLabel(ctxOf())).toBe('1 file changed');
        expect(whisperDiffTabLabel(ctxOf({ files: [] }))).toBe('Changes');
    });
});
