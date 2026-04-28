import { describe, it, expect } from 'vitest';
import {
    parseWorkItemDeepLink,
    buildWorkItemHash,
    buildWorkItemSessionHash,
    buildWorkItemCommitHash,
} from '../../../../src/server/spa/client/react/layout/Router';

describe('parseWorkItemDeepLink', () => {
    it('returns nulls for non-work-items hash', () => {
        const result = parseWorkItemDeepLink('#repos/ws-1/git');
        expect(result).toEqual({ itemId: null, sessionTaskId: null, commitHash: null, commitFilePath: null });
    });

    it('returns nulls for work-items tab without item id', () => {
        const result = parseWorkItemDeepLink('#repos/ws-1/work-items');
        expect(result).toEqual({ itemId: null, sessionTaskId: null, commitHash: null, commitFilePath: null });
    });

    it('parses item-only link', () => {
        const result = parseWorkItemDeepLink('#repos/ws-1/work-items/item-42');
        expect(result).toEqual({ itemId: 'item-42', sessionTaskId: null, commitHash: null, commitFilePath: null });
    });

    it('parses session link', () => {
        const result = parseWorkItemDeepLink('#repos/ws-1/work-items/item-42/session/task-99');
        expect(result).toEqual({ itemId: 'item-42', sessionTaskId: 'task-99', commitHash: null, commitFilePath: null });
    });

    it('returns null sessionTaskId when session segment present but task id missing', () => {
        const result = parseWorkItemDeepLink('#repos/ws-1/work-items/item-42/session');
        expect(result).toEqual({ itemId: 'item-42', sessionTaskId: null, commitHash: null, commitFilePath: null });
    });

    it('parses commit link without file path', () => {
        const result = parseWorkItemDeepLink('#repos/ws-1/work-items/item-42/commit/abc1234');
        expect(result).toEqual({ itemId: 'item-42', sessionTaskId: null, commitHash: 'abc1234', commitFilePath: null });
    });

    it('parses commit link with a simple file path', () => {
        const result = parseWorkItemDeepLink('#repos/ws-1/work-items/item-42/commit/abc1234/src%2Fmain.ts');
        expect(result).toEqual({ itemId: 'item-42', sessionTaskId: null, commitHash: 'abc1234', commitFilePath: 'src/main.ts' });
    });

    it('parses commit link with a multi-segment file path', () => {
        const result = parseWorkItemDeepLink('#repos/ws-1/work-items/item-42/commit/abc1234/src/lib/util.ts');
        expect(result).toEqual({ itemId: 'item-42', sessionTaskId: null, commitHash: 'abc1234', commitFilePath: 'src/lib/util.ts' });
    });

    it('decodes URI-encoded item id', () => {
        const result = parseWorkItemDeepLink('#repos/ws-1/work-items/item%2042');
        expect(result.itemId).toBe('item 42');
    });

    it('decodes URI-encoded commit hash (unusual but valid)', () => {
        const result = parseWorkItemDeepLink('#repos/ws%201/work-items/item-1/commit/abc123');
        expect(result.itemId).toBe('item-1');
        expect(result.commitHash).toBe('abc123');
    });

    it('handles leading hash symbol gracefully', () => {
        const result = parseWorkItemDeepLink('repos/ws-1/work-items/item-42');
        expect(result.itemId).toBe('item-42');
    });

    it('returns nulls for unrecognised sub-path (not session or commit)', () => {
        const result = parseWorkItemDeepLink('#repos/ws-1/work-items/item-42/unknown/stuff');
        expect(result).toEqual({ itemId: 'item-42', sessionTaskId: null, commitHash: null, commitFilePath: null });
    });

    it('returns nulls for empty string', () => {
        const result = parseWorkItemDeepLink('');
        expect(result).toEqual({ itemId: null, sessionTaskId: null, commitHash: null, commitFilePath: null });
    });
});

describe('buildWorkItemHash', () => {
    it('builds a basic item hash', () => {
        expect(buildWorkItemHash('ws-1', 'item-42')).toBe('#repos/ws-1/work-items/item-42');
    });

    it('encodes workspace id with spaces', () => {
        expect(buildWorkItemHash('my workspace', 'item-1')).toBe('#repos/my%20workspace/work-items/item-1');
    });

    it('encodes item id with spaces', () => {
        expect(buildWorkItemHash('ws-1', 'item 99')).toBe('#repos/ws-1/work-items/item%2099');
    });
});

describe('buildWorkItemSessionHash', () => {
    it('builds a session hash', () => {
        expect(buildWorkItemSessionHash('ws-1', 'item-42', 'task-99')).toBe('#repos/ws-1/work-items/item-42/session/task-99');
    });

    it('encodes task id with special chars', () => {
        expect(buildWorkItemSessionHash('ws-1', 'item-1', 'task/99')).toBe('#repos/ws-1/work-items/item-1/session/task%2F99');
    });
});

describe('buildWorkItemCommitHash', () => {
    it('builds a commit-only hash', () => {
        expect(buildWorkItemCommitHash('ws-1', 'item-42', 'abc1234')).toBe('#repos/ws-1/work-items/item-42/commit/abc1234');
    });

    it('builds a commit hash with file path', () => {
        expect(buildWorkItemCommitHash('ws-1', 'item-42', 'abc1234', 'src/main.ts')).toBe('#repos/ws-1/work-items/item-42/commit/abc1234/src/main.ts');
    });

    it('encodes file path segments individually', () => {
        expect(buildWorkItemCommitHash('ws-1', 'item-1', 'sha', 'src/my file.ts')).toBe('#repos/ws-1/work-items/item-1/commit/sha/src/my%20file.ts');
    });
});

describe('parseWorkItemDeepLink + buildWorkItemHash round-trip', () => {
    const cases = ['item-1', 'item with spaces', 'item/42', '中文-item'];
    for (const itemId of cases) {
        it(`round-trips item id "${itemId}"`, () => {
            const hash = buildWorkItemHash('ws-1', itemId);
            const parsed = parseWorkItemDeepLink(hash);
            expect(parsed.itemId).toBe(itemId);
        });
    }
});

describe('parseWorkItemDeepLink + buildWorkItemSessionHash round-trip', () => {
    it('round-trips session link', () => {
        const hash = buildWorkItemSessionHash('ws-1', 'item-42', 'task-99');
        const parsed = parseWorkItemDeepLink(hash);
        expect(parsed.itemId).toBe('item-42');
        expect(parsed.sessionTaskId).toBe('task-99');
        expect(parsed.commitHash).toBeNull();
    });
});

describe('parseWorkItemDeepLink + buildWorkItemCommitHash round-trip', () => {
    it('round-trips commit link without file', () => {
        const hash = buildWorkItemCommitHash('ws-1', 'item-42', 'abc1234');
        const parsed = parseWorkItemDeepLink(hash);
        expect(parsed.itemId).toBe('item-42');
        expect(parsed.commitHash).toBe('abc1234');
        expect(parsed.commitFilePath).toBeNull();
    });

    it('round-trips commit link with file path', () => {
        const hash = buildWorkItemCommitHash('ws-1', 'item-42', 'abc1234', 'src/my file.ts');
        const parsed = parseWorkItemDeepLink(hash);
        expect(parsed.itemId).toBe('item-42');
        expect(parsed.commitHash).toBe('abc1234');
        expect(parsed.commitFilePath).toBe('src/my file.ts');
    });

    it('round-trips commit link with deeply nested file path', () => {
        const hash = buildWorkItemCommitHash('ws-1', 'item-1', 'sha42', 'a/b/c/d.ts');
        const parsed = parseWorkItemDeepLink(hash);
        expect(parsed.commitFilePath).toBe('a/b/c/d.ts');
    });
});
