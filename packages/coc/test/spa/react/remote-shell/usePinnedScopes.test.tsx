/**
 * usePinnedScopes — global `pinnedScopes` preference store.
 *
 * The point of the module-level store (rather than per-hook state) is that the
 * pin toggles in the picker and the pin segments in the switcher are siblings
 * with no common owner, so both mounts must see one list. That cross-mount sync
 * is what these tests pin down.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

const getGlobal = vi.fn();
const patchGlobal = vi.fn();

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ preferences: { getGlobal, patchGlobal } }),
}));

import {
    __resetPinnedScopesStore,
    usePinnedScopes,
} from '../../../../src/server/spa/client/react/features/remote-shell/usePinnedScopes';
import { MAX_PINNED_SCOPES, type PinnedScopeRef } from '../../../../src/server/spa/client/react/features/remote-shell/pinnedScopes';

const repoPin = (key: string): PinnedScopeRef => ({ kind: 'repo', key });
const groupPin = (key: string): PinnedScopeRef => ({ kind: 'group', key });

let api: ReturnType<typeof usePinnedScopes> | null = null;

function Probe({ testId }: { testId: string }) {
    const value = usePinnedScopes();
    api = value;
    return (
        <div data-testid={testId} data-full={value.full} data-loaded={value.loaded}>
            {value.pins.map(p => `${p.kind}:${p.key}`).join(',')}
        </div>
    );
}

beforeEach(() => {
    cleanup();
    api = null;
    __resetPinnedScopesStore();
    getGlobal.mockReset().mockResolvedValue({ pinnedScopes: [] });
    patchGlobal.mockReset().mockResolvedValue({});
});

afterEach(() => cleanup());

describe('usePinnedScopes — load', () => {
    it('loads and parses the stored list', async () => {
        getGlobal.mockResolvedValue({ pinnedScopes: ['repo:github.com/a/b', 'group:group-ai'] });
        render(<Probe testId="p" />);

        await waitFor(() => expect(screen.getByTestId('p').textContent).toBe('repo:github.com/a/b,group:group-ai'));
        expect(screen.getByTestId('p').getAttribute('data-loaded')).toBe('true');
    });

    it('drops stored entries without a valid kind prefix', async () => {
        getGlobal.mockResolvedValue({ pinnedScopes: ['group-ai', 'repo:ok', 7] });
        render(<Probe testId="p" />);

        await waitFor(() => expect(screen.getByTestId('p').textContent).toBe('repo:ok'));
    });

    it('falls back to an empty list when preferences fail to load', async () => {
        getGlobal.mockRejectedValue(new Error('offline'));
        render(<Probe testId="p" />);

        await waitFor(() => expect(screen.getByTestId('p').getAttribute('data-loaded')).toBe('true'));
        expect(screen.getByTestId('p').textContent).toBe('');
    });

    it('reads preferences once for many mounts', async () => {
        render(<><Probe testId="a" /><Probe testId="b" /></>);

        await waitFor(() => expect(screen.getByTestId('a').getAttribute('data-loaded')).toBe('true'));
        expect(getGlobal).toHaveBeenCalledTimes(1);
    });
});

describe('usePinnedScopes — write and cross-mount sync', () => {
    it('persists a pin through patchGlobal in serialized form', async () => {
        render(<Probe testId="p" />);
        await waitFor(() => expect(screen.getByTestId('p').getAttribute('data-loaded')).toBe('true'));

        act(() => api!.toggle(repoPin('github.com/a/b')));

        expect(patchGlobal).toHaveBeenCalledWith({ pinnedScopes: ['repo:github.com/a/b'] });
        expect(screen.getByTestId('p').textContent).toBe('repo:github.com/a/b');
    });

    it('a pin toggled in one mount immediately reaches the other', async () => {
        render(<><Probe testId="a" /><Probe testId="b" /></>);
        await waitFor(() => expect(screen.getByTestId('a').getAttribute('data-loaded')).toBe('true'));

        act(() => api!.toggle(groupPin('group-ai')));

        expect(screen.getByTestId('a').textContent).toBe('group:group-ai');
        expect(screen.getByTestId('b').textContent).toBe('group:group-ai');
    });

    it('unpins and reorders, persisting each change', async () => {
        getGlobal.mockResolvedValue({ pinnedScopes: ['repo:a', 'repo:b', 'group:g'] });
        render(<Probe testId="p" />);
        await waitFor(() => expect(screen.getByTestId('p').textContent).toContain('repo:a'));

        act(() => api!.move(groupPin('g'), -1));
        expect(screen.getByTestId('p').textContent).toBe('repo:a,group:g,repo:b');

        act(() => api!.toggle(repoPin('a')));
        expect(screen.getByTestId('p').textContent).toBe('group:g,repo:b');
        expect(patchGlobal).toHaveBeenLastCalledWith({ pinnedScopes: ['group:g', 'repo:b'] });
    });

    it('reports `full` and refuses further pins at the cap', async () => {
        getGlobal.mockResolvedValue({ pinnedScopes: Array.from({ length: MAX_PINNED_SCOPES }, (_, i) => `repo:r${i}`) });
        render(<Probe testId="p" />);
        await waitFor(() => expect(screen.getByTestId('p').getAttribute('data-full')).toBe('true'));

        act(() => api!.toggle(repoPin('extra')));

        expect(screen.getByTestId('p').textContent).not.toContain('extra');
    });

    it('survives a failed patch — local state still advances', async () => {
        patchGlobal.mockRejectedValue(new Error('nope'));
        render(<Probe testId="p" />);
        await waitFor(() => expect(screen.getByTestId('p').getAttribute('data-loaded')).toBe('true'));

        act(() => api!.toggle(repoPin('a')));

        expect(screen.getByTestId('p').textContent).toBe('repo:a');
    });
});
