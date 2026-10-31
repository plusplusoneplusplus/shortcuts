// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReviewFiles } from '../../../src/server/spa/client/react/features/git/diff/ReviewFiles';
import { ReviewContentSearchController } from '../../../src/server/spa/client/react/features/git/diff/reviewContentSearchController';
import { applyRuntimeConfigPatch } from '../../../src/server/spa/client/react/utils/config';
import { useContentSearchShortcut } from '../../../src/server/spa/client/react/features/repo-detail/content-search/useContentSearchShortcut';

const entries = [{ id: 'a', path: 'a.ts', status: 'M' }, { id: 'b', path: 'b.ts', status: 'M' }];
const controllers: ReviewContentSearchController[] = [];
function setup() {
    const onOpenMatch = vi.fn();
    const load = vi.fn(async () => ({
        path: 'a.ts', fileName: 'a.ts', language: 'typescript', binary: false, tooLarge: false,
        base: { content: 'old target', exists: true, ref: 'base' },
        head: { content: 'new target', exists: true, ref: 'head' },
    }));
    const controller = new ReviewContentSearchController(entries, load);
    controllers.push(controller);
    const view = render(<ReviewFiles identity="owner:refs" files={entries} contentSearch={{ controller, onOpenMatch }}
        renderFile={() => <div className="monaco-editor"><textarea aria-label="Review editor" /></div>} />);
    return { ...view, onOpenMatch, controller, load };
}
function enable(value = true) { act(() => applyRuntimeConfigPatch({ diffContentSearchEnabled: value })); }
async function settle() { await act(async () => { for (let n = 0; n < 25; n++) await Promise.resolve(); }); }
afterEach(() => { cleanup(); enable(false); controllers.splice(0).forEach(controller => controller.dispose()); });

describe('review-scoped search keyboard ownership', () => {
    it.each(['ctrlKey', 'metaKey'] as const)('opens/focuses review search with %s and leaves repository search elsewhere', async modifier => {
        const repoOpen = vi.fn();
        function RepositoryShortcut() {
            useContentSearchShortcut({ scope: 'repo', overlayOpen: false, onOpen: repoOpen, onFocusExisting: vi.fn() });
            return <input aria-label="Outside review" />;
        }
        render(<RepositoryShortcut />);
        enable();
        const view = setup();
        const editor = screen.getByLabelText('Review editor');
        fireEvent.keyDown(editor, { key: 'F', shiftKey: true, [modifier]: true });
        expect(repoOpen).not.toHaveBeenCalled();
        const input = screen.getByTestId('review-content-search-input') as HTMLInputElement;
        expect(document.activeElement).toBe(input);
        expect(view.load).not.toHaveBeenCalled();
        fireEvent.change(input, { target: { value: 'target' } }); await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Files' }));
        fireEvent.keyDown(editor, { key: 'f', shiftKey: true, [modifier]: true });
        expect(document.activeElement).toBe(input);
        expect(input.value).toBe('target');
        fireEvent.keyDown(screen.getByLabelText('Outside review'), { key: 'f', shiftKey: true, [modifier]: true });
        expect(repoOpen).toHaveBeenCalledTimes(1);
        enable(false);
        fireEvent.keyDown(editor, { key: 'f', shiftKey: true, [modifier]: true });
        expect(repoOpen).toHaveBeenCalledTimes(2);
    });

    it('leaves modifiers, composition and handled events untouched', () => {
        enable(); setup();
        const editor = screen.getByLabelText('Review editor');
        for (const options of [{ altKey: true }, { isComposing: true }, { shiftKey: false }]) {
            fireEvent.keyDown(editor, { key: 'f', ctrlKey: true, shiftKey: true, ...options });
            expect(screen.queryByRole('region', { name: 'Review content search' })).toBeNull();
        }
        const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
        event.preventDefault();
        fireEvent(editor, event);
        expect(screen.queryByRole('region', { name: 'Review content search' })).toBeNull();
    });

    it('cycles F3/Shift+F3 through all files and both sides, wraps, and follows clicked rows in Files mode', async () => {
        enable(); const { onOpenMatch } = setup();
        const editor = screen.getByLabelText('Review editor');
        const empty = new KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true });
        fireEvent(editor, empty); expect(empty.defaultPrevented).toBe(false);
        fireEvent.keyDown(editor, { key: 'f', ctrlKey: true, shiftKey: true });
        fireEvent.change(screen.getByTestId('review-content-search-input'), { target: { value: 'target' } });
        await settle();
        const input = screen.getByTestId('review-content-search-input');
        const group = screen.getByRole('region', { name: 'Review content search' }).querySelector('details')!;
        group.open = false;
        for (const [file, side] of [['a', 'old'], ['a', 'new'], ['b', 'old'], ['b', 'new'], ['a', 'old']]) {
            const event = new KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true });
            fireEvent(input, event);
            expect(event.defaultPrevented).toBe(true);
            expect(onOpenMatch).toHaveBeenLastCalledWith(expect.objectContaining({ id: file }), expect.objectContaining({ side }));
        }
        expect(group.open).toBe(true);
        fireEvent.keyDown(input, { key: 'F3', shiftKey: true });
        expect(onOpenMatch).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }), expect.objectContaining({ side: 'new' }));
        fireEvent.click(screen.getByRole('button', { name: 'a.ts, OLD line 1, column 5' }));
        fireEvent.click(screen.getByRole('button', { name: 'Files' }));
        fireEvent.keyDown(editor, { key: 'F3' });
        expect(onOpenMatch).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a' }), expect.objectContaining({ side: 'new' }));
        fireEvent.click(screen.getByRole('button', { name: 'Search' }));
        fireEvent.change(screen.getByLabelText('Search side'), { target: { value: 'old' } });
        fireEvent.keyDown(input, { key: 'F3', shiftKey: true });
        expect(onOpenMatch).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }), expect.objectContaining({ side: 'old' }));
    });

    it('does not navigate stale results for invalid queries and removes handlers on unmount', async () => {
        enable(); const { onOpenMatch, unmount } = setup();
        fireEvent.click(screen.getByRole('button', { name: 'Search review contents' }));
        const input = screen.getByTestId('review-content-search-input');
        fireEvent.change(input, { target: { value: 'target' } }); await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Regex' }));
        fireEvent.change(input, { target: { value: '[' } });
        fireEvent.keyDown(input, { key: 'F3' });
        expect(onOpenMatch).not.toHaveBeenCalled();
        unmount();
        fireEvent.keyDown(document, { key: 'F3' });
        expect(onOpenMatch).not.toHaveBeenCalled();
    });
});
