// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mockFileIdentity } from './fileIdentityMock';
import { useFileIdentityOpen } from '../../../../src/server/spa/client/react/features/language-servers/useFileIdentityOpen';

const owner = { workspaceId: 'ws', routingRef: 'exact-clone' };
afterEach(cleanup);
function Host({ context, commit }: { context: string; commit(path: string): void }) {
    const opener = useFileIdentityOpen(context);
    return <><button onClick={() => opener.open(owner, 'src/mixed.ts', () => [], commit)}>Open</button>{opener.error}</>;
}

describe('file identity admission UI', () => {
    it('shows a visible error, creates no state, and retries the original owner', async () => {
        mockFileIdentity.mockRejectedValueOnce(new Error('Owner offline.'));
        const commit = vi.fn();
        render(<Host context="chat-a" commit={commit} />);
        fireEvent.click(screen.getByText('Open'));
        expect(await screen.findByRole('alert')).toHaveTextContent('Owner offline.');
        expect(commit).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('Retry'));
        await waitFor(() => expect(commit).toHaveBeenCalledExactlyOnceWith('src/mixed.ts', expect.any(AbortSignal)));
        expect(mockFileIdentity.mock.calls.every(call => call[0] === owner)).toBe(true);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it.each(['owner-b', 'chat-b'])('ignores late completions after changing context to %s', async context => {
        let finish!: (path: string) => void;
        mockFileIdentity.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const commit = vi.fn();
        const view = render(<Host context="chat-a" commit={commit} />);
        fireEvent.click(screen.getByText('Open'));
        await waitFor(() => expect(finish).toBeTypeOf('function'));
        view.rerender(<Host context={context} commit={commit} />);
        await act(async () => { finish('src/Mixed.ts'); });
        expect(commit).not.toHaveBeenCalled();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('aborts owner I/O on unmount and ignores an abort-insensitive result', async () => {
        let finish!: (path: string) => void;
        let activeSignal!: AbortSignal;
        mockFileIdentity.mockImplementationOnce((_owner, _path, signal?: AbortSignal) => {
            activeSignal = signal!;
            return new Promise(resolve => { finish = resolve; });
        });
        const commit = vi.fn();
        const view = render(<Host context="chat-a" commit={commit} />);
        fireEvent.click(screen.getByText('Open'));
        await waitFor(() => expect(finish).toBeTypeOf('function'));
        view.unmount();
        expect(activeSignal.aborted).toBe(true);
        await act(async () => { finish('src/Mixed.ts'); });
        expect(commit).not.toHaveBeenCalled();
    });
});
