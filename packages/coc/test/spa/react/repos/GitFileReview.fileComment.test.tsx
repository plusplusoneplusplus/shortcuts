import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { GitFileReview } from '../../../../src/server/spa/client/react/features/git/diff/GitFileReview';
import type { DiffSource } from '../../../../src/server/spa/client/react/features/git/diff/diffSource';

const h = vi.hoisted(() => ({ create: vi.fn(), clientFor: vi.fn() }));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/diffSource', async importOriginal => ({
    ...await importOriginal<object>(),
    getGitReviewClient: (...args: unknown[]) => { h.clientFor(...args); return { git: { createDiffComment: h.create } }; },
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/repos/cloneRegistry')>();
    return { ...actual, resolveCloneRoute: (ref: unknown) => ref === 'remote:one:ws' ? { kind: 'remote', baseUrl: 'http://one' } : actual.resolveCloneRoute(ref as string) };
});
vi.mock('../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel', () => ({
    FileDiffPanel: (props: any) => <div data-testid="focused-diff">{props.filePath}</div>,
}));

const target = 'packages/coc-desktop/test/e2e/html-download.e2e.test.ts';
const files = [
    { path: 'src/z.ts', status: 'modified', additions: 4, deletions: 2 },
    { path: 'src/a.ts', oldPath: 'old/name.ts', status: 'R100', additions: 1, deletions: 0 },
    { path: target, status: 'M', additions: 2, deletions: 1 },
    { path: 'docs/README.md', status: 'D', additions: 0, deletions: 5 },
];
function makeSource(routingTarget?: string | null) {
    return {
        files: [], cacheKey: 'commit:abc', label: 'Commit abc', routingTarget,
        commentContext: (filePath: string) => ({ repositoryId: 'ws', filePath, oldRef: 'abc^', newRef: 'abc' }),
    } as unknown as DiffSource;
}
const props = { workspaceId: 'ws', attachmentDestinationId: 'ws', comparisonKey: 'abc', files, source: makeSource() };
const nav = () => screen.getByRole('complementary', { name: 'Changed files' });
const row = (path: string) => nav().querySelector<HTMLElement>(`[data-file-path="${path}"]`)!;
const commentItem = () => within(screen.getByTestId('context-menu')).getByRole('menuitem', { name: /Comment/ });
const composer = () => screen.getByRole('dialog', { name: /^Comment on file / });
const textarea = () => within(composer()).getByTestId('comment-textarea');

function openComposer(path: string) {
    fireEvent.contextMenu(row(path), { clientX: 40, clientY: 50 });
    fireEvent.click(commentItem());
}

beforeEach(() => {
    h.create.mockReset().mockResolvedValue({ comment: { id: 'c1' } });
    h.clientFor.mockClear();
});

describe('changed-file row Comment', () => {
    it.each(['Groups', 'Tree', 'Flat'])('saves a file-level comment on the right-clicked row in %s view without changing the diff', async view => {
        render(<GitFileReview {...props} />);
        fireEvent.click(screen.getByRole('button', { name: view, exact: true }));
        const selected = screen.getByTestId('focused-diff').textContent;
        expect(selected).not.toBe(target);
        const items = () => within(screen.getByTestId('context-menu')).getAllByRole('menuitem').map(item => item.textContent);
        fireEvent.contextMenu(row(target), { clientX: 40, clientY: 50 });
        expect(items()).toEqual([expect.stringContaining('Open file'), expect.stringContaining('Comment')]);
        fireEvent.click(commentItem());
        expect(composer()).toHaveAccessibleName(`Comment on file ${target}`);
        expect(document.activeElement).toBe(textarea());
        fireEvent.change(textarea(), { target: { value: '  Needs a cleanup test  ' } });
        fireEvent.click(within(composer()).getByRole('button', { name: /Submit/ }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(h.create).toHaveBeenCalledTimes(1);
        expect(h.create).toHaveBeenCalledWith('ws', {
            context: { repositoryId: 'ws', filePath: target, oldRef: 'abc^', newRef: 'abc' },
            scope: 'file', selectedText: '', comment: 'Needs a cleanup test', category: 'general',
        });
        expect(h.create.mock.calls[0][1]).not.toHaveProperty('selection');
        expect(screen.getByTestId('focused-diff').textContent).toBe(selected);
        expect(document.activeElement).toBe(row(target));
    });

    it('cancels without saving and returns focus to the row', () => {
        render(<GitFileReview {...props} />);
        openComposer('src/z.ts');
        fireEvent.change(textarea(), { target: { value: 'draft' } });
        fireEvent.click(within(composer()).getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(h.create).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(row('src/z.ts'));
    });

    it('opens from the keyboard and saves with Ctrl+Enter; Escape cancels', async () => {
        render(<GitFileReview {...props} />);
        const z = row('src/z.ts');
        z.focus();
        fireEvent.keyDown(z, { key: 'F10', shiftKey: true });
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(commentItem());
        fireEvent.keyDown(commentItem(), { key: 'Enter' });
        expect(document.activeElement).toBe(textarea());
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(z);

        fireEvent.keyDown(z, { key: 'ContextMenu' });
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
        fireEvent.keyDown(commentItem(), { key: 'Enter' });
        fireEvent.change(textarea(), { target: { value: 'Keyboard note' } });
        fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true });
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(h.create).toHaveBeenCalledWith('ws', expect.objectContaining({ scope: 'file', comment: 'Keyboard note' }));
        expect(document.activeElement).toBe(z);
    });

    it('keeps the draft and shows the error when saving fails, then retries once', async () => {
        h.create.mockRejectedValueOnce(new Error('offline'));
        render(<GitFileReview {...props} />);
        openComposer('src/z.ts');
        fireEvent.change(textarea(), { target: { value: 'Retry me' } });
        fireEvent.click(within(composer()).getByRole('button', { name: /Submit/ }));
        expect(await within(composer()).findByRole('alert')).toHaveTextContent('Comment not saved: offline');
        expect(textarea()).toHaveValue('Retry me');
        fireEvent.click(within(composer()).getByRole('button', { name: /Submit/ }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(h.create).toHaveBeenCalledTimes(2);
    });

    it('comments on a rename at its new path and on a deleted file at its path', async () => {
        render(<GitFileReview {...props} />);
        for (const path of ['src/a.ts', 'docs/README.md']) {
            openComposer(path);
            fireEvent.change(textarea(), { target: { value: `on ${path}` } });
            fireEvent.click(within(composer()).getByRole('button', { name: /Submit/ }));
            await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
            expect(h.create).toHaveBeenLastCalledWith('ws', expect.objectContaining({
                context: expect.objectContaining({ filePath: path }), comment: `on ${path}`,
            }));
        }
    });

    it.each([
        ['a remote owner', 'remote:one:ws'],
        ['a page-origin owner', null],
        ['the default owner', undefined],
    ])('saves through the review source route for %s', async (_name, routingTarget) => {
        render(<GitFileReview {...props} source={makeSource(routingTarget)} />);
        openComposer('src/z.ts');
        fireEvent.change(textarea(), { target: { value: 'routed' } });
        fireEvent.click(within(composer()).getByRole('button', { name: /Submit/ }));
        await waitFor(() => expect(h.create).toHaveBeenCalled());
        expect(h.clientFor).toHaveBeenCalledWith('ws', routingTarget);
        expect(h.create.mock.calls[0][0]).toBe('ws');
    });

    it('tells open comment views of the review to re-read', async () => {
        const listener = new BroadcastChannel('coc-git-review-popout');
        const messages: unknown[] = [];
        listener.onmessage = event => messages.push(event.data);
        try {
            render(<GitFileReview {...props} />);
            openComposer('src/z.ts');
            fireEvent.change(textarea(), { target: { value: 'notify' } });
            fireEvent.click(within(composer()).getByRole('button', { name: /Submit/ }));
            await waitFor(() => expect(messages).toEqual([expect.objectContaining({ type: 'git-review-comments-updated' })]));
        } finally {
            listener.close();
        }
    });
});
