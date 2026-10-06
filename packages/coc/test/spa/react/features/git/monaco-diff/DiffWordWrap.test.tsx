import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { DiffWordWrapToggle } from '../../../../../../src/server/spa/client/react/features/git/diff/DiffViewToggle';
import { MonacoFileDiffViewer } from '../../../../../../src/server/spa/client/react/features/git/diff/MonacoFileDiffViewer';
import { useDiffWordWrap, __resetDiffWordWrapForTesting } from '../../../../../../src/server/spa/client/react/features/git/hooks/useDiffWordWrap';
import { createFakeDiffEditor, deferred, flush, type FakeDiffEditor } from './fakeDiffEditorAdapter';

const prefs = vi.hoisted(() => ({ getGlobal: vi.fn(), patchGlobal: vi.fn() }));
vi.mock('../../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ preferences: prefs }),
}));
vi.mock('../../../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'light' }),
}));

beforeEach(() => {
    __resetDiffWordWrapForTesting();
    prefs.getGlobal.mockReset().mockResolvedValue({});
    prefs.patchGlobal.mockReset().mockResolvedValue({});
});

describe('diff word wrap', () => {
    it('updates mounted inline and split editors across workspaces without replacing models or editors', async () => {
        const fakes: FakeDiffEditor[] = [];
        const createEditor = vi.fn(async (_host, options) => {
            const fake = createFakeDiffEditor(options);
            fakes.push(fake);
            return fake.adapter;
        });
        render(<>
            <DiffWordWrapToggle />
            <MonacoFileDiffViewer workspaceId="ws-a" relativePath="a.ts" stage="unstaged"
                original="old" modified="new" viewMode="unified" languageFeatures={false} createEditor={createEditor} />
            <MonacoFileDiffViewer workspaceId="ws-b" relativePath="a.ts" stage="staged"
                original="old" modified="new" viewMode="split" languageFeatures={false} createEditor={createEditor} />
        </>);
        await act(flush);
        const toggle = screen.getByRole('button', { name: 'Word wrap' });
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        expect(toggle.getAttribute('title')).toBe('Enable word wrap');
        for (const fake of fakes) expect(fake.options.at(-1)).toMatchObject({ wordWrap: 'off', diffWordWrap: 'off' });
        await act(async () => { fireEvent.click(toggle); await flush(); });
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        expect(toggle.getAttribute('title')).toBe('Disable word wrap');
        for (const fake of fakes) expect(fake.options.at(-1)).toMatchObject({ wordWrap: 'on', diffWordWrap: 'on' });
        expect(fakes[0].options.at(-1)?.renderSideBySide).toBe(false);
        expect(fakes[1].options.at(-1)?.renderSideBySide).toBe(true);
        await act(async () => { fireEvent.click(toggle); await flush(); });
        for (const fake of fakes) {
            expect(fake.options.at(-1)).toMatchObject({ wordWrap: 'off', diffWordWrap: 'off' });
            expect(fake.models).toHaveLength(1);
        }
        expect(createEditor).toHaveBeenCalledTimes(2);
        expect(prefs.patchGlobal.mock.calls).toEqual([[{ diffWordWrap: true }], [{ diffWordWrap: false }]]);
        expect(prefs.getGlobal).toHaveBeenCalledTimes(1);
    });

    it('restores the persisted choice after a fresh session and ignores malformed settings', async () => {
        let saved = {};
        prefs.getGlobal.mockImplementation(async () => saved);
        prefs.patchGlobal.mockImplementation(async patch => { saved = patch; });
        const first = renderHook(useDiffWordWrap);
        await act(flush);
        await act(async () => { first.result.current[1](true); await flush(); });
        first.unmount();
        __resetDiffWordWrapForTesting();
        const reopened = renderHook(useDiffWordWrap);
        await act(flush);
        expect(reopened.result.current[0]).toBe(true);
        reopened.unmount();
        __resetDiffWordWrapForTesting();
        saved = { diffWordWrap: 'true' };
        const malformed = renderHook(useDiffWordWrap);
        await act(flush);
        expect(malformed.result.current[0]).toBe(false);
    });

    it('keeps a user choice made during a pending server read', async () => {
        const pending = deferred<{ diffWordWrap: boolean }>();
        prefs.getGlobal.mockReturnValue(pending.promise);
        const hook = renderHook(useDiffWordWrap);
        act(() => hook.result.current[1](true));
        await act(async () => { pending.resolve({ diffWordWrap: false }); await flush(); });
        expect(hook.result.current[0]).toBe(true);
    });

    it('serializes rapid writes and continues after a failed write', async () => {
        const pending = deferred<void>();
        prefs.patchGlobal.mockReturnValueOnce(pending.promise);
        const hook = renderHook(useDiffWordWrap);
        await act(flush);
        await act(async () => {
            hook.result.current[1](true);
            hook.result.current[1](false);
            await flush();
        });
        expect(hook.result.current[0]).toBe(false);
        expect(prefs.patchGlobal).toHaveBeenCalledTimes(1);
        await act(async () => { pending.reject(new Error('offline')); await flush(); });
        expect(prefs.patchGlobal.mock.calls).toEqual([[{ diffWordWrap: true }], [{ diffWordWrap: false }]]);
    });

    it('works for the session when preference reads and writes fail', async () => {
        prefs.getGlobal.mockRejectedValue(new Error('offline'));
        prefs.patchGlobal.mockRejectedValue(new Error('offline'));
        const hook = renderHook(useDiffWordWrap);
        await act(flush);
        expect(hook.result.current[0]).toBe(false);
        await act(async () => { hook.result.current[1](true); await flush(); });
        expect(hook.result.current[0]).toBe(true);
    });
});
