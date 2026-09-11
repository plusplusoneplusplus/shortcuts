/**
 * AC-04: the descriptor an Explorer selection opens.
 *
 * The Explorer is an authorized entry point, so what it opens is editable — the
 * opposite of a chat source link. The cases below pin that, plus the two things
 * the "+" menu's file input does not have to handle: a trusted absolute path
 * that must reach PreviewPane byte-identical, and the owning clone of a repo
 * group member keeping its own repo label.
 */
import { describe, expect, it } from 'vitest';
import { explorerFileTabInput } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedExplorerFiles';
import { TRUSTED_PATH_PREFIX } from '../../../../src/server/spa/client/react/features/repo-detail/explorer/ExactOpen';

const CTX = { ownerWorkspaceId: 'ws-1', scopeWorkspaceId: 'ws-1', chatId: 'chat-1' };

describe('explorerFileTabInput', () => {
    it('opens an editable chat-scoped file tab for a tree selection', () => {
        expect(explorerFileTabInput({ path: 'src/a.ts', name: 'a.ts' }, { readOnly: false }, CTX)).toEqual({
            kind: 'file',
            ownerWorkspaceId: 'ws-1',
            chatId: 'chat-1',
            resourceId: 'src/a.ts',
            label: 'a.ts',
        });
    });

    it('files the tab under the workspace when no chat is selected', () => {
        const input = explorerFileTabInput({ path: 'src/a.ts', name: 'a.ts' }, {}, { ...CTX, chatId: null });
        expect(input?.chatId).toBeNull();
    });

    it('normalizes a path and derives the label when the Explorer gives no name', () => {
        const input = explorerFileTabInput({ path: './src//deep\\b.ts' }, {}, CTX);
        expect(input?.resourceId).toBe('src/deep/b.ts');
        expect(input?.label).toBe('b.ts');
    });

    it('carries the search hit line so the tab opens scrolled to the match', () => {
        expect(explorerFileTabInput({ path: 'src/a.ts', name: 'a.ts', line: 42 }, {}, CTX)?.line).toBe(42);
    });

    it('keeps a trusted absolute path exactly as PreviewPane expects it', () => {
        const input = explorerFileTabInput(
            { path: `${TRUSTED_PATH_PREFIX}/etc/hosts`, name: 'hosts' },
            { readOnly: true },
            CTX,
        );
        // Untouched: normalizing would strip the leading slash (and mangle a
        // Windows path), and the prefix is what makes PreviewPane read an
        // absolute file rather than a repo blob.
        expect(input?.resourceId).toBe(`${TRUSTED_PATH_PREFIX}/etc/hosts`);
        expect(input?.label).toBe('hosts');
        expect(input?.readOnly).toBe(true);
    });

    it('labels a file from another clone with its owning repo', () => {
        const input = explorerFileTabInput({ path: 'src/a.ts', name: 'a.ts' }, {}, {
            ...CTX,
            ownerWorkspaceId: 'ws-member',
            ownerLabel: 'member-repo',
        });
        expect(input?.ownerWorkspaceId).toBe('ws-member');
        expect(input?.repoLabel).toBe('member-repo');
    });

    it('keeps the concrete clone route on the file descriptor', () => {
        const input = explorerFileTabInput({ path: 'src/a.ts', name: 'a.ts' }, {}, {
            ...CTX,
            ownerRoutingRef: 'remote:server-b:ws-1',
        });
        expect(input?.ownerRoutingRef).toBe('remote:server-b:ws-1');
    });

    it('omits the repo label when the owner is the panel workspace', () => {
        const input = explorerFileTabInput({ path: 'src/a.ts', name: 'a.ts' }, {}, { ...CTX, ownerLabel: 'ws-1' });
        expect(input).not.toHaveProperty('repoLabel');
    });

    it('refuses a path that normalizes to nothing rather than filing an unopenable tab', () => {
        expect(explorerFileTabInput({ path: '   ' }, {}, CTX)).toBeNull();
        expect(explorerFileTabInput({ path: '/' }, {}, CTX)).toBeNull();
        expect(explorerFileTabInput({ path: TRUSTED_PATH_PREFIX }, {}, CTX)).toBeNull();
    });
});
