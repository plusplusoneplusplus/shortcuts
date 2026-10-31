// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { GitFileDiffContentResponse } from '@plusplusoneplusplus/coc-client';
import { ReviewContentSearchPanel } from '../../../src/server/spa/client/react/features/git/diff/ReviewContentSearchPanel';
import { ReviewContentSearchController, type ReviewSearchFile } from '../../../src/server/spa/client/react/features/git/diff/reviewContentSearchController';

function content(old = 'old target', next = 'new target'): GitFileDiffContentResponse {
    return {
        path: 'a', fileName: 'a', language: 'text', binary: false, tooLarge: false,
        base: { content: old, exists: true, ref: 'base' },
        head: { content: next, exists: true, ref: 'head' },
    };
}
const files = [{ id: 'staged:a', path: 'src/a.ts' }, { id: 'unstaged:a', path: 'src/a.ts' }, { id: 'b', path: 'readme.md' }];
const controllers: ReviewContentSearchController[] = [];
function mount(load: (file: ReviewSearchFile) => Promise<GitFileDiffContentResponse> = vi.fn(async () => content()), entries = files) {
    const controller = new ReviewContentSearchController(entries, load);
    controllers.push(controller);
    const onOpenMatch = vi.fn();
    const view = render(<ReviewContentSearchPanel controller={controller} onOpenMatch={onOpenMatch} />);
    return { controller, load, onOpenMatch, ...view };
}
async function settle() {
    await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
}
function query(value: string) {
    fireEvent.change(screen.getByTestId('review-content-search-input'), { target: { value } });
}
afterEach(() => { cleanup(); controllers.forEach(controller => controller.dispose()); controllers.length = 0; });

describe('ReviewContentSearchPanel', () => {
    it('loads only after a query and groups both sides with highlighted snippets and exact navigation coordinates', async () => {
        const { load, onOpenMatch } = mount(vi.fn(async () => content('unchanged\nold target', 'target new')));
        await settle();
        expect(load).not.toHaveBeenCalled();
        query('target');
        await settle();
        expect(screen.getByText('Searched 3 of 3 files')).toBeDefined();
        expect(screen.getByText('6 matches')).toBeDefined();
        expect(screen.getAllByText('src/a.ts (2)')).toHaveLength(2);
        const row = screen.getAllByRole('button', { name: 'src/a.ts, OLD line 2, column 5' })[1];
        expect(row.querySelector('mark')?.textContent).toBe('target');
        expect(within(row).getByText('OLD')).toBeDefined();
        fireEvent.click(row);
        expect(onOpenMatch).toHaveBeenLastCalledWith(files[1], { side: 'old', line: 2, startColumn: 5, endColumn: 11, text: 'old target' });
        fireEvent.keyDown(screen.getByTestId('review-content-search-input'), { key: 'Enter' });
        expect(onOpenMatch).toHaveBeenLastCalledWith(files[0], expect.objectContaining({ side: 'old', line: 2 }));
        fireEvent.click(screen.getByTestId('review-content-search-clear'));
        expect(screen.queryByText('6 matches')).toBeNull();
        expect(load).toHaveBeenCalledTimes(3);
    });

    it('rematches cached contents with Explorer mode controls and side/include filters', async () => {
        const { load } = mount(vi.fn(async () => content('Target target targets', 'target')));
        query('target');
        await settle();
        expect(screen.getByText('12 matches')).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Match case' }));
        expect(screen.getByText('9 matches')).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Whole word' }));
        expect(screen.getByText('6 matches')).toBeDefined();
        fireEvent.change(screen.getByLabelText('Search side'), { target: { value: 'old' } });
        expect(screen.getByText('3 matches')).toBeDefined();
        fireEvent.change(screen.getByLabelText('Files to include'), { target: { value: '*.ts' } });
        expect(screen.getByText('Searched 2 of 2 files')).toBeDefined();
        expect(screen.getByText('2 matches')).toBeDefined();
        expect(screen.queryByText('readme.md (1)')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Regex' }));
        query('t.rget');
        expect(screen.getByText('2 matches')).toBeDefined();
        expect(load).toHaveBeenCalledTimes(3);
    });

    it('shows bad regex and glob errors without reading files or opening stale matches', async () => {
        const { load, onOpenMatch } = mount();
        fireEvent.click(screen.getByRole('button', { name: 'Regex' }));
        query('[');
        await settle();
        expect(screen.getByRole('alert').textContent).toMatch(/regular expression/i);
        expect(load).not.toHaveBeenCalled();
        query('target');
        await settle();
        fireEvent.change(screen.getByLabelText('Files to include'), { target: { value: '[' } });
        expect(screen.getByRole('alert')).toBeDefined();
        expect(screen.queryByText('6 matches')).toBeNull();
        fireEvent.keyDown(screen.getByTestId('review-content-search-input'), { key: 'Enter' });
        expect(onOpenMatch).not.toHaveBeenCalled();
        expect(load).toHaveBeenCalledTimes(3);
    });

    it('applies include globs before lazy loads and accepts whitespace queries literally', async () => {
        const { load } = mount();
        fireEvent.change(screen.getByLabelText('Files to include'), { target: { value: '*.md' } });
        query(' ');
        await settle();
        expect(load).toHaveBeenCalledExactlyOnceWith(files[2]);
        expect(screen.getByText('Searched 1 of 1 files')).toBeDefined();
        expect(screen.getByText('2 matches')).toBeDefined();
    });

    it('shows skips and errors separately and retries only the failed file', async () => {
        let failed = false;
        const load = vi.fn(async (file: ReviewSearchFile) => {
            if (file.id === files[0].id) return { ...content(), binary: true };
            if (file.id === files[1].id) return { ...content(), tooLarge: true };
            if (!failed) { failed = true; throw new Error('Disconnected'); }
            return content();
        });
        mount(load);
        query('target');
        await settle();
        const skipped = screen.getByRole('region', { name: 'Skipped' });
        expect(within(skipped).getByText(/Binary file/)).toBeDefined();
        expect(within(skipped).getByText(/10 MB/)).toBeDefined();
        const errors = screen.getByRole('region', { name: 'Errors' });
        expect(within(errors).getByText(/Disconnected/)).toBeDefined();
        expect(screen.getByText('Searched 3 of 3 files')).toBeDefined();
        fireEvent.click(within(errors).getByRole('button', { name: 'Retry readme.md' }));
        await settle();
        expect(screen.queryByRole('region', { name: 'Errors' })).toBeNull();
        expect(screen.getByText('2 matches')).toBeDefined();
        expect(load).toHaveBeenCalledTimes(4);
    });

    it('stops dispatch after four reads and resumes pending reads when the query changes', async () => {
        const pending: ((value: GitFileDiffContentResponse) => void)[] = [];
        const entries = Array.from({ length: 6 }, (_, index) => ({ id: String(index), path: `${index}.ts` }));
        const load = vi.fn(() => new Promise<GitFileDiffContentResponse>(resolve => pending.push(resolve)));
        mount(load, entries);
        query('target');
        await settle();
        expect(load).toHaveBeenCalledTimes(4);
        expect(screen.getByText('Searched 0 of 6 files')).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
        await act(async () => { pending.slice(0, 4).forEach(resolve => resolve(content())); });
        await settle();
        expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
        expect(screen.getByText('Searched 4 of 6 files')).toBeDefined();
        expect(load).toHaveBeenCalledTimes(4);
        query('new');
        await settle();
        expect(load).toHaveBeenCalledTimes(6);
        await act(async () => { pending.slice(4).forEach(resolve => resolve(content())); });
        await settle();
        expect(screen.getByText('Searched 6 of 6 files')).toBeDefined();
    });

    it('renders empty results and zero-width regex matches without losing their columns', async () => {
        const { onOpenMatch } = mount(vi.fn(async () => content('', 'abc')), [files[0]]);
        query('missing');
        await settle();
        expect(screen.getByText('No matches.')).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Regex' }));
        query('^');
        expect(screen.getByText('2 matches')).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'src/a.ts, NEW line 1, column 1' }));
        expect(onOpenMatch).toHaveBeenLastCalledWith(files[0], expect.objectContaining({ side: 'new', startColumn: 1, endColumn: 1 }));
    });

    it('shows all matches and brings distant text into the displayed snippet', async () => {
        const text = `${'x'.repeat(300)}target ${'target '.repeat(550)}`;
        const { container } = mount(vi.fn(async () => content('', text)), [files[0]]);
        query('target');
        await settle();
        expect(screen.getByText('551 matches')).toBeDefined();
        expect(container.querySelectorAll('mark')).toHaveLength(551);
        expect(container.querySelector('mark')?.textContent).toBe('target');
        expect(container.querySelector('mark')?.parentElement?.textContent?.startsWith('…')).toBe(true);
    });
});
