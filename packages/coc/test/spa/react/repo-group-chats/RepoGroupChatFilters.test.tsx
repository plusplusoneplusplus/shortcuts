/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { RepoGroupChatFilters } from '../../../../src/server/spa/client/react/repos/RepoGroupChatFilters';
import { useRepoGroupChatFilters } from '../../../../src/server/spa/client/react/repos/useRepoGroupChatFilters';

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: true, isTablet: false }),
}));
afterEach(() => { cleanup(); localStorage.clear(); });
describe('group chat filters', () => {
    it('keeps ownership and search compact on mobile and provides all owner/status/archive filters', () => {
        const onChange = vi.fn();
        render(<RepoGroupChatFilters filters={{}} onChange={onChange} sources={[
            { workspaceId: 'group-ai', role: 'group', available: true },
            { workspaceId: 'ws-a', role: 'member', name: 'Repo A', available: true },
            { workspaceId: 'ws-b', role: 'member', name: 'Repo B', available: true },
        ]} />);
        expect(screen.getByText('Filters').tagName).toBe('SUMMARY');
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'body term' } });
        expect(onChange).toHaveBeenLastCalledWith({ q: 'body term' });
        fireEvent.change(screen.getByLabelText('Repo filter'), { target: { value: 'group-ai' } });
        expect(onChange).toHaveBeenLastCalledWith({ owners: ['group-ai'] });
        fireEvent.change(screen.getByLabelText('Status filter'), { target: { value: 'cancelled' } });
        expect(onChange).toHaveBeenLastCalledWith({ statuses: ['cancelled'] });
        fireEvent.change(screen.getByLabelText('Archived filter'), { target: { value: 'only' } });
        expect(onChange).toHaveBeenLastCalledWith({ archived: 'only' });
    });

    it('persists filters per server-qualified group and restores them on return and refresh', () => {
        const { result, rerender, unmount } = renderHook(
            ({ scope }) => useRepoGroupChatFilters(scope),
            { initialProps: { scope: 'remote:server-a:group-ai' } });
        act(() => result.current[1]({ q: 'body', owners: ['ws-a'], archived: 'only' }));
        rerender({ scope: 'remote:server-b:group-ai' });
        expect(result.current[0]).toEqual({});
        rerender({ scope: 'remote:server-a:group-ai' });
        expect(result.current[0]).toEqual({ q: 'body', owners: ['ws-a'], archived: 'only' });
        unmount();
        const restored = renderHook(() => useRepoGroupChatFilters('remote:server-a:group-ai'));
        expect(restored.result.current[0]).toEqual({ q: 'body', owners: ['ws-a'], archived: 'only' });
    });
});
