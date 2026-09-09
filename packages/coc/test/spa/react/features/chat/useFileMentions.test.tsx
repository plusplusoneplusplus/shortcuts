/**
 * @vitest-environment jsdom
 *
 * The file-mention popup state machine (AC-04, plus the hook half of AC-05).
 *
 * Covers accept-into-pill — the typed token becomes a backticked path with a
 * trailing space and the caret after it, the `@` sigil dropped — and the key
 * contract the composers rely on: the hook consumes Tab/Enter/Arrows/Escape only
 * while the menu is open, and returns false otherwise so the rest of the chain
 * (ghost text, submit) behaves exactly as before.
 */
import { act, render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExplorerSearchResult } from '@plusplusoneplusplus/coc-client';

const { mockSearchFiles } = vi.hoisted(() => ({ mockSearchFiles: vi.fn() }));

vi.mock(
    '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi',
    () => ({ explorerApi: { searchFiles: mockSearchFiles } }),
);

import { FILE_MENTION_DEBOUNCE_MS, type FileMentionRepo }
    from '../../../../../src/server/spa/client/react/features/chat/hooks/useFileMentionSearch';
import {
    useFileMentions,
    type UseFileMentionsResult,
} from '../../../../../src/server/spa/client/react/features/chat/hooks/useFileMentions';
import type { RichTextInputHandle } from '../../../../../src/server/spa/client/react/shared/RichTextInput';

const REPOS: FileMentionRepo[] = [{ workspaceId: 'ws-a', name: 'alpha' }];

function hit(path: string, score: number): ExplorerSearchResult {
    return { path, score, indices: [0] };
}

/** Renders the hook and exposes its latest value through a mutable sink. */
function Harness({ repos, enabled, sink }: {
    repos: FileMentionRepo[];
    enabled: boolean;
    sink: { current: UseFileMentionsResult | null };
}) {
    sink.current = useFileMentions(repos, enabled);
    return null;
}

function mount(repos: FileMentionRepo[] = REPOS, enabled = true) {
    const sink: { current: UseFileMentionsResult | null } = { current: null };
    render(<Harness repos={repos} enabled={enabled} sink={sink} />);
    return {
        get hook(): UseFileMentionsResult {
            if (!sink.current) throw new Error('hook not mounted');
            return sink.current;
        },
    };
}

/** Advance past the debounce and let the search promises settle. */
async function settle() {
    await act(async () => {
        vi.advanceTimersByTime(FILE_MENTION_DEBOUNCE_MS);
        await Promise.resolve();
        await Promise.resolve();
    });
}

/** Type `text` with the caret at its end and let the popup open. */
async function type(h: { hook: UseFileMentionsResult }, text: string) {
    act(() => { h.hook.handleInputChange(text, text.length); });
    await settle();
}

/** A fake key event exposing only what the hook touches. */
function key(name: string) {
    return { key: name, preventDefault: vi.fn() } as unknown as
        React.KeyboardEvent<HTMLElement> & { preventDefault: ReturnType<typeof vi.fn> };
}

/** A stand-in for the composer's `RichTextInput` imperative handle. */
function makeEditorRef() {
    const setValue = vi.fn();
    const ref = {
        current: { getValue: () => '', setValue, focus: vi.fn() } as RichTextInputHandle,
    } as React.RefObject<RichTextInputHandle>;
    return { ref, setValue };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockSearchFiles.mockResolvedValue({
        results: [hit('src/foo.ts', 90), hit('src/foobar.ts', 80)],
        truncated: false,
    });
});

describe('useFileMentions', () => {
    it('opens on an @-prefixed token and closes when the sigil is gone', async () => {
        const h = mount();
        expect(h.hook.menuVisible).toBe(false);

        await type(h, '@src/fo');
        expect(h.hook.menuVisible).toBe(true);
        expect(h.hook.results.map(r => r.path)).toEqual(['src/foo.ts', 'src/foobar.ts']);
        expect(h.hook.results[0].repoName).toBe('alpha');

        await type(h, 'hello');
        expect(h.hook.menuVisible).toBe(false);
        expect(h.hook.results).toEqual([]);
    });

    it('never opens on a bare path-shaped token', async () => {
        const h = mount();

        // Regression: a bare token with a slash or an extension used to open the
        // picker, so typing prose like `a/bd` popped up unrelated fuzzy matches.
        for (const text of ['src/fo', 'a/bd', 'foo.ts']) {
            await type(h, text);
            expect(h.hook.menuVisible).toBe(false);
        }
        expect(mockSearchFiles).not.toHaveBeenCalled();
    });

    it('replaces the typed token with a backticked path plus a trailing space (AC-04)', async () => {
        const h = mount();
        const { ref, setValue } = makeEditorRef();
        const setText = vi.fn();

        await type(h, 'see @src/fo');
        act(() => { h.hook.handleKeyDown(key('ArrowDown')); });
        expect(h.hook.highlightIndex).toBe(1);

        act(() => {
            h.hook.selectResult(h.hook.results[1], 'see @src/fo', setText, ref);
        });

        const expected = 'see `src/foobar.ts` ';
        expect(setText).toHaveBeenCalledWith(expected);
        // Caret lands after the inserted run, past the trailing space.
        expect(setValue).toHaveBeenCalledWith(expected, expected.length);
        expect(h.hook.menuVisible).toBe(false);
    });

    it('drops the `@` sigil on accept and keeps the rest of the line intact', async () => {
        const h = mount();
        const { ref, setValue } = makeEditorRef();
        const setText = vi.fn();

        await type(h, 'look at @src/fo');
        act(() => {
            h.hook.selectResult(h.hook.results[0], 'look at @src/fo', setText, ref);
        });

        const expected = 'look at `src/foo.ts` ';
        expect(setText).toHaveBeenCalledWith(expected);
        expect(setValue).toHaveBeenCalledWith(expected, expected.length);
    });

    it('replaces only the token when text follows the caret, without doubling the space', async () => {
        const h = mount();
        const { ref, setValue } = makeEditorRef();
        const setText = vi.fn();

        act(() => { h.hook.handleInputChange('@src/fo tail', '@src/fo'.length); });
        await settle();
        expect(h.hook.menuVisible).toBe(true);

        act(() => { h.hook.selectResult(h.hook.results[0], '@src/fo tail', setText, ref); });
        expect(setText).toHaveBeenCalledWith('`src/foo.ts` tail');
        // Caret still lands one space after the path, on the existing space.
        expect(setValue).toHaveBeenCalledWith('`src/foo.ts` tail', '`src/foo.ts` '.length);
    });

    it('consumes Arrows/Enter/Tab/Escape only while open (AC-05)', async () => {
        const h = mount();

        // Closed: every key falls through to the rest of the composer chain.
        for (const name of ['Tab', 'Enter', 'ArrowDown', 'Escape']) {
            const e = key(name);
            expect(h.hook.handleKeyDown(e)).toBe(false);
            expect(e.preventDefault).not.toHaveBeenCalled();
        }

        await type(h, '@src/fo');

        for (const name of ['Tab', 'Enter', 'ArrowDown', 'ArrowUp']) {
            const e = key(name);
            let consumed = false;
            act(() => { consumed = h.hook.handleKeyDown(e); });
            expect(consumed).toBe(true);
            expect(e.preventDefault).toHaveBeenCalled();
        }

        // An unrelated key is never consumed, so typing keeps working.
        expect(h.hook.handleKeyDown(key('a'))).toBe(false);

        const esc = key('Escape');
        act(() => { expect(h.hook.handleKeyDown(esc)).toBe(true); });
        expect(h.hook.menuVisible).toBe(false);
        // Escape only closes the popup; the typed text is the caller's.
        expect(h.hook.handleKeyDown(key('Tab'))).toBe(false);
    });

    it('wraps the highlight at both ends', async () => {
        const h = mount();
        await type(h, '@src/fo');

        act(() => { h.hook.handleKeyDown(key('ArrowUp')); });
        expect(h.hook.highlightIndex).toBe(1);
        act(() => { h.hook.handleKeyDown(key('ArrowDown')); });
        expect(h.hook.highlightIndex).toBe(0);
    });

    it('never opens without a repo or when disabled', async () => {
        const noRepos = mount([], true);
        await type(noRepos, '@src/fo');
        expect(noRepos.hook.menuVisible).toBe(false);

        const disabled = mount(REPOS, false);
        await type(disabled, '@src/fo');
        expect(disabled.hook.menuVisible).toBe(false);

        expect(mockSearchFiles).not.toHaveBeenCalled();
    });

    it('ignores a select with no open token', () => {
        const h = mount();
        const setText = vi.fn();
        act(() => {
            h.hook.selectResult(
                { path: 'src/foo.ts', score: 1, indices: [], workspaceId: 'ws-a', repoName: 'alpha' },
                '@src/fo',
                setText,
            );
        });
        expect(setText).not.toHaveBeenCalled();
    });
});
