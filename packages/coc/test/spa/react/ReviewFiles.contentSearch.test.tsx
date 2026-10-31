// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GitFileDiffContentResponse } from '@plusplusoneplusplus/coc-client';
import { ReviewFiles, type ReviewFileRenderContext } from '../../../src/server/spa/client/react/features/git/diff/ReviewFiles';
import { ReviewContentSearchController } from '../../../src/server/spa/client/react/features/git/diff/reviewContentSearchController';
import { applyRuntimeConfigPatch, isDiffContentSearchEnabled } from '../../../src/server/spa/client/react/utils/config';

const files = [{ id: 'staged:a', path: 'a.ts', status: 'M' }, { id: 'unstaged:a', path: 'a.ts', status: 'M' }];
const controllers: ReviewContentSearchController[] = [];
function paired(): GitFileDiffContentResponse {
    return {
        path: 'a.ts', fileName: 'a.ts', language: 'typescript', binary: false, tooLarge: false,
        base: { content: 'old target', exists: true, ref: 'HEAD' },
        head: { content: 'new target', exists: true, ref: 'index' },
    };
}
function setup(entries = files, load = vi.fn(async () => paired())) {
    const controller = new ReviewContentSearchController(entries, load);
    controllers.push(controller);
    const onOpenMatch = vi.fn();
    const props = { identity: 'owner:comparison', files: entries, renderFile: ({ file }: ReviewFileRenderContext) => <div>{file.id}</div>, contentSearch: { controller, onOpenMatch } };
    return { ...render(<ReviewFiles {...props} />), props, controller, load, onOpenMatch };
}
function enabled(value = true) { act(() => applyRuntimeConfigPatch({ diffContentSearchEnabled: value })); }
function search(value = 'target') {
    fireEvent.click(screen.getByRole('button', { name: 'Search review contents' }));
    fireEvent.change(screen.getByTestId('review-content-search-input'), { target: { value } });
}
async function settle() { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); }
afterEach(() => { cleanup(); controllers.splice(0).forEach(controller => controller.dispose()); enabled(false); });

describe('shared review content search capability', () => {
    it('defaults off and mounts no search controls or loads until explicitly enabled', async () => {
        expect(isDiffContentSearchEnabled()).toBe(false);
        const { load } = setup();
        expect(screen.queryByRole('group', { name: 'Review navigator' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Search review contents' })).toBeNull();
        enabled();
        expect(screen.getByRole('group', { name: 'Review navigator' })).toBeDefined();
        expect(screen.queryByRole('region', { name: 'Review content search' })).toBeNull();
        await settle();
        expect(load).not.toHaveBeenCalled();
        search(); await settle();
        expect(load).toHaveBeenCalledTimes(2);
        expect(screen.getByRole('region', { name: 'Review content search' })).toBeDefined();
    });

    it('leaves chat and other callers without the capability unchanged even when enabled', () => {
        enabled();
        render(<ReviewFiles identity="chat" files={files} renderFile={() => null} />);
        expect(screen.queryByRole('group', { name: 'Review navigator' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Search review contents' })).toBeNull();
        expect(screen.getByLabelText('Search changed files by name or path')).toBeDefined();
    });

    it('preserves file filters, query, options and cached reads across Files/Search switches', async () => {
        enabled(); const { load } = setup();
        fireEvent.change(screen.getByLabelText('Search changed files by name or path'), { target: { value: 'absent' } });
        search(); await settle();
        expect(document.activeElement).toBe(screen.getByTestId('review-content-search-input'));
        fireEvent.change(screen.getByLabelText('Search side'), { target: { value: 'old' } });
        expect(screen.getByText('2 matches')).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Files' }));
        expect(screen.queryByRole('region', { name: 'Review content search' })).toBeNull();
        expect((screen.getByLabelText('Search changed files by name or path') as HTMLInputElement).value).toBe('absent');
        fireEvent.click(screen.getByRole('button', { name: 'Search' }));
        expect((screen.getByTestId('review-content-search-input') as HTMLInputElement).value).toBe('target');
        expect((screen.getByLabelText('Search side') as HTMLSelectElement).value).toBe('old');
        expect(screen.getByText('2 matches')).toBeDefined();
        await settle(); expect(load).toHaveBeenCalledTimes(2);
    });

    it('keeps drawer keyboard focus within the visible navigator mode', async () => {
        enabled(); setup(); search(); await settle();
        const first = screen.getByRole('button', { name: 'Files' });
        const last = screen.getAllByRole('button', { name: 'a.ts, NEW line 1, column 5' })[1];
        const nav = screen.getByRole('complementary', { name: 'Changed files' });
        expect(nav.className).toContain('open');
        last.focus(); fireEvent.keyDown(last, { key: 'Tab' });
        expect(document.activeElement).toBe(first);
        fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(last);
    });

    it('passes stage-qualified IDs and exact side coordinates through click and Enter', async () => {
        enabled(); const { onOpenMatch } = setup(); search(); await settle();
        fireEvent.click(screen.getAllByRole('button', { name: 'a.ts, NEW line 1, column 5' })[1]);
        expect(onOpenMatch).toHaveBeenLastCalledWith(files[1], {
            side: 'new', line: 1, startColumn: 5, endColumn: 11, text: 'new target',
        });
        fireEvent.keyDown(screen.getByTestId('review-content-search-input'), { key: 'Enter' });
        expect(onOpenMatch).toHaveBeenLastCalledWith(files[0], expect.objectContaining({ side: 'old', line: 1 }));
    });

    it('stops dispatch on live disable and removes hidden search controls and query state', async () => {
        enabled();
        let release!: (content: GitFileDiffContentResponse) => void;
        const pending = new Promise<GitFileDiffContentResponse>(resolve => { release = resolve; });
        const load = vi.fn(() => pending);
        const many = Array.from({ length: 8 }, (_, n) => ({ id: String(n), path: `${n}.ts`, status: 'M' }));
        const { controller } = setup(many, load);
        search(); await settle(); expect(load).toHaveBeenCalledTimes(4);
        enabled(false);
        expect(screen.queryByRole('button', { name: 'Search review contents' })).toBeNull();
        expect(screen.queryByTestId('review-content-search-input')).toBeNull();
        expect(controller.getSnapshot().running).toBe(false);
        release(paired()); await settle(); expect(load).toHaveBeenCalledTimes(4);
        enabled();
        expect(screen.getByLabelText('Search changed files by name or path')).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Search' }));
        expect((screen.getByTestId('review-content-search-input') as HTMLInputElement).value).toBe('');
    });

    it('stops dispatch on unmount while leaving controller disposal to its host', async () => {
        enabled(); const { unmount, controller } = setup();
        const dispose = vi.spyOn(controller, 'dispose');
        search(); unmount(); await settle();
        expect(controller.getSnapshot().running).toBe(false);
        expect(dispose).not.toHaveBeenCalled();
    });

    it('resets panel state when the review identity changes', async () => {
        enabled(); const view = setup(); search(); await settle();
        const nextLoad = vi.fn(async () => paired());
        const next = new ReviewContentSearchController([{ id: 'new', path: 'b.ts' }], nextLoad);
        controllers.push(next);
        view.rerender(<ReviewFiles {...view.props} identity="another-owner:comparison" contentSearch={{ controller: next, onOpenMatch: vi.fn() }} />);
        expect((screen.getByTestId('review-content-search-input') as HTMLInputElement).value).toBe('');
        expect(nextLoad).not.toHaveBeenCalled();
        fireEvent.change(screen.getByTestId('review-content-search-input'), { target: { value: 'target' } }); await settle();
        expect(screen.getByRole('button', { name: 'b.ts, NEW line 1, column 5' })).toBeDefined();
    });
});
