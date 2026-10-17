import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { GitFileReview, NAV_WIDTH_STORAGE_KEY } from '../../../../src/server/spa/client/react/features/git/diff/GitFileReview';
import { filterReviewFiles, groupReviewFiles, reviewFileKind } from '../../../../src/server/spa/client/react/features/git/diff/gitReviewFiles';
import type { DiffSource } from '../../../../src/server/spa/client/react/features/git/diff/diffSource';

const panel = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel', () => ({
    FileDiffPanel: (props: any) => { panel(props); return <div data-testid="focused-diff">{props.filePath}<button onClick={() => props.onNavigateToFile(props.source.files.at(-1), 'last')}>Last hunk in last file</button></div>; },
}));
const files = [
    { path: 'src/z.ts', status: 'modified', additions: 4, deletions: 2 },
    { path: 'src/a.ts', oldPath: 'old/name.ts', status: 'R100', additions: 1, deletions: 0 },
    { path: 'test/a.test.ts', status: 'A', additions: 20, deletions: 0 },
    { path: 'docs/README.md', status: 'D', additions: 0, deletions: 5 },
];
const source = { files: [], cacheKey: 'commit:abc', label: 'Commit abc' } as unknown as DiffSource;
const props = { workspaceId: 'ws', attachmentDestinationId: 'remote:one:ws', comparisonKey: 'abc', files, source };
const nav = () => screen.getByRole('complementary', { name: 'Changed files' });
function open(path: string) { fireEvent.click(nav().querySelector(`[data-file-path="${path}"]`)!); }
beforeEach(() => panel.mockClear());

describe('compact focused Git review', () => {
    it('mounts exactly one real file panel for 150 files and keeps owner/source intact', () => {
        const many = Array.from({ length: 150 }, (_, i) => ({ ...files[0], path: `src/${i}.ts` }));
        render(<GitFileReview {...props} files={many} />);
        expect(screen.getAllByTestId('focused-diff')).toHaveLength(1);
        expect(panel.mock.calls.at(-1)![0]).toMatchObject({ workspaceId: 'ws', attachmentDestinationId: 'remote:one:ws', source: { cacheKey: 'commit:abc' } });
        expect(nav().querySelectorAll('[data-file-path]')).toHaveLength(150);
        expect(new Set(panel.mock.calls.map(([p]) => p.filePath)).size).toBe(1);
        open('src/99.ts');
        expect(screen.getByTestId('focused-diff').textContent).toContain('src/99.ts');
        expect(screen.getAllByTestId('focused-diff')).toHaveLength(1);
    });
    it('groups directories, leads with basename, and searches old rename paths', () => {
        render(<GitFileReview {...props} />);
        expect(within(nav()).getByRole('button', { name: /src 2/ }).getAttribute('aria-expanded')).toBe('true');
        expect(nav().querySelector('[data-file-path="src/a.ts"] strong')?.textContent).toBe('a.ts');
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'OLD/NAME' } });
        expect(nav().querySelectorAll('[data-file-path]')).toHaveLength(1);
        expect(panel.mock.calls.at(-1)![0].filePath).toBe('src/a.ts');
    });
    it('applies kind/status filters to the diff and cross-file navigation', () => {
        render(<GitFileReview {...props} />);
        fireEvent.click(within(nav()).getByRole('button', { name: 'Source 2', exact: true }));
        expect(panel.mock.calls.at(-1)![0].source.files).toEqual(['src/a.ts', 'src/z.ts']);
        fireEvent.change(screen.getByLabelText('Change status filter'), { target: { value: 'R' } });
        expect(panel.mock.calls.at(-1)![0].source.files).toEqual(['src/a.ts']);
    });
    it('retains selection while collapsing directories and across overview', () => {
        render(<GitFileReview {...props} />); open('src/z.ts');
        fireEvent.click(within(nav()).getByRole('button', { name: /src 2/ }));
        expect(nav().querySelector('[data-file-path="src/z.ts"]')).toBeNull();
        expect(screen.getByTestId('focused-diff').textContent).toContain('src/z.ts');
        fireEvent.click(screen.getByRole('button', { name: 'Overview', exact: true }));
        expect(screen.queryByTestId('focused-diff')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Read diff', exact: true }));
        expect(screen.getByTestId('focused-diff').textContent).toContain('src/z.ts');
    });
    it('marks viewed explicitly, hides viewed files, and recovers from an empty filter', () => {
        render(<GitFileReview {...props} />); open('src/z.ts');
        fireEvent.click(screen.getByRole('button', { name: 'Mark viewed' }));
        expect(screen.getByRole('progressbar').getAttribute('value')).toBe('1');
        fireEvent.click(screen.getByLabelText('Hide viewed'));
        expect(nav().querySelector('[data-file-path="src/z.ts"]')).toBeNull();
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'no such file' } });
        expect(screen.queryByTestId('focused-diff')).toBeNull();
        fireEvent.click(within(nav()).getByRole('button', { name: 'Clear filters' }));
        expect(nav().querySelectorAll('[data-file-path]')).toHaveLength(4);
    });
    it.each(['owner', 'comparison', 'workspace'])('resets search, viewed state and disclosure on %s change', change => {
        const view = render(<GitFileReview {...props} />); open('src/z.ts');
        fireEvent.click(screen.getByRole('button', { name: 'Mark viewed' }));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'src' } });
        view.rerender(<GitFileReview {...props} {...(change === 'owner' ? { attachmentDestinationId: 'remote:two:ws' } : change === 'workspace' ? { workspaceId: 'ws2' } : { comparisonKey: 'def' })} />);
        expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
        expect(screen.getByRole('progressbar').getAttribute('value')).toBe('0');
        expect(nav().querySelectorAll('[data-file-path]')).toHaveLength(4);
    });
    it('supports arrow/home/end file navigation and first/last hunk targets', () => {
        const onSelect = vi.fn(); render(<GitFileReview {...props} onSelect={onSelect} />); open('src/a.ts');
        const button = nav().querySelector('[data-file-path="src/a.ts"]')!;
        fireEvent.keyDown(button, { key: 'ArrowDown' });
        expect(onSelect).toHaveBeenLastCalledWith('src/z.ts', 'first');
        expect(document.activeElement?.getAttribute('data-file-path')).toBe('src/z.ts');
        fireEvent.click(screen.getByRole('button', { name: 'Last hunk in last file' }));
        expect(onSelect).toHaveBeenLastCalledWith('test/a.test.ts', 'last');
        expect(panel.mock.calls.at(-1)![0].initialHunkTarget).toBe('last');
    });
    it('opens the narrow drawer with search focus, traps Tab and returns focus on Escape', () => {
        render(<GitFileReview {...props} />);
        const trigger = screen.getByRole('button', { name: 'Files · 4' });
        fireEvent.click(trigger);
        expect(document.activeElement).toBe(screen.getByRole('textbox'));
        fireEvent.keyDown(nav(), { key: 'Escape' });
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(trigger);
    });
    it('reveals a routed or priority-selected file outside the current filters', () => {
        const view = render(<GitFileReview {...props} selectedPath="src/a.ts" />);
        fireEvent.click(within(nav()).getByRole('button', { name: 'Docs 1', exact: true }));
        view.rerender(<GitFileReview {...props} selectedPath="test/a.test.ts" />);
        expect(screen.getByTestId('focused-diff').textContent).toContain('test/a.test.ts');
        expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
    });
    it('shows loading and errors without mounting a diff; retries metadata', () => {
        const retry = vi.fn(); const view = render(<GitFileReview {...props} loading />);
        expect(screen.getByRole('status').textContent).toContain('Loading files');
        expect(panel).not.toHaveBeenCalled();
        view.rerender(<GitFileReview {...props} error="Offline" onRetry={retry} />);
        expect(screen.getByRole('alert').textContent).toContain('Offline');
        fireEvent.click(screen.getByRole('button', { name: 'Retry' })); expect(retry).toHaveBeenCalledOnce();
        expect(panel).not.toHaveBeenCalled();
    });
});

describe('changed-file category counts', () => {
    function expectCounts(counts: number[], selected = 'All') {
        ['All', 'Source', 'Tests', 'Docs'].forEach((label, index) => {
            const button = within(nav()).getByRole('button', { name: `${label} ${counts[index]}`, exact: true });
            expect(button.getAttribute('aria-pressed')).toBe(String(label === selected));
        });
    }
    it('shows a plain heading and all four totals using existing category precedence', () => {
        const changed = [files[0], files[2], { path: 'tests/README.md', status: 'M' }, files[3], { path: 'AGENTS.md', status: 'A' }];
        render(<GitFileReview {...props} files={changed} />);
        expect(nav().querySelector('.git-review-filter-title strong')?.textContent).toBe('Changed files');
        expectCounts([5, 1, 2, 2]);
    });
    it('keeps all totals when switching categories and preserves a still-visible selection', () => {
        render(<GitFileReview {...props} />);
        open('src/z.ts');
        fireEvent.click(within(nav()).getByRole('button', { name: 'Source 2' }));
        expectCounts([4, 2, 1, 1], 'Source');
        expect(screen.getByTestId('focused-diff').textContent).toContain('src/z.ts');
        for (const [label, paths] of [
            ['Tests', ['test/a.test.ts']], ['Docs', ['docs/README.md']],
            ['All', ['docs/README.md', 'src/a.ts', 'src/z.ts', 'test/a.test.ts']],
        ] as const) {
            fireEvent.click(within(nav()).getByRole('button', { name: new RegExp(`^${label} `) }));
            expectCounts([4, 2, 1, 1], label);
            expect(panel.mock.calls.at(-1)![0].source.files).toEqual(paths);
        }
    });
    it('keeps full-comparison totals through search, status and hide-viewed filters', () => {
        render(<GitFileReview {...props} reviewedFiles={new Set(['src/a.ts'])} />);
        fireEvent.click(within(nav()).getByRole('button', { name: 'Source 2' }));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'OLD/NAME' } });
        fireEvent.change(screen.getByLabelText('Change status filter'), { target: { value: 'R' } });
        expect(panel.mock.calls.at(-1)![0].source.files).toEqual(['src/a.ts']);
        fireEvent.click(screen.getByLabelText('Hide viewed'));
        expect(nav().querySelectorAll('[data-file-path]')).toHaveLength(0);
        expectCounts([4, 2, 1, 1], 'Source');
        fireEvent.click(within(nav()).getByRole('button', { name: 'Clear filters' }));
        expectCounts([4, 2, 1, 1]);
        expect(nav().querySelectorAll('[data-file-path]')).toHaveLength(4);
    });
    it('refreshes totals with changed data without resetting category or selection and includes zeros', () => {
        const view = render(<GitFileReview {...props} />);
        open('src/z.ts');
        fireEvent.click(within(nav()).getByRole('button', { name: 'Source 2' }));
        view.rerender(<GitFileReview {...props} files={[files[0], { path: 'notes/new.md', status: 'A' }]} />);
        expectCounts([2, 1, 0, 1], 'Source');
        expect(screen.getByTestId('focused-diff').textContent).toContain('src/z.ts');
        view.rerender(<GitFileReview {...props} files={[]} />);
        expectCounts([0, 0, 0, 0], 'Source');
        expect(screen.queryByTestId('focused-diff')).toBeNull();
    });
    it('allows filter controls to wrap within narrow drawers and resized sidebars', () => {
        const css = readFileSync(join(__dirname, '../../../../src/server/spa/client/react/features/git/diff/git-file-review.css'), 'utf8');
        expect(css).toMatch(/\.git-review-filter-row\{[^}]*flex-wrap:wrap/);
    });
});

describe('single-row review toolbar', () => {
    const toolbar = () => screen.getByTestId('git-review-toolbar');
    it('keeps navigation, stats, progress and viewed in one toolbar without auto-advancing', () => {
        const onToggle = vi.fn();
        render(<GitFileReview {...props} reviewedFiles={new Set(['docs/README.md'])} onToggleReviewed={onToggle} />); open('src/z.ts');
        expect(screen.getAllByTestId('git-review-toolbar')).toHaveLength(1);
        for (const name of ['Overview', 'Previous file', 'Next file', 'Mark viewed', 'Files · 4']) {
            expect(toolbar().contains(screen.getByRole('button', { name, exact: true }))).toBe(true);
        }
        expect(screen.getByTestId('git-review-file-index').textContent).toMatch(/^\d\/4$/);
        expect(screen.getByTestId('git-review-change-stats').getAttribute('title')).toBe('Modified · 4 additions, 2 deletions');
        expect(screen.getByTestId('git-review-reviewed-count').textContent).toBe('1/4 reviewed');
        expect(screen.getByTestId('git-review-progress-line').firstElementChild!.getAttribute('style')).toContain('width: 25%');
        fireEvent.click(screen.getByRole('button', { name: 'Mark viewed' }));
        expect(onToggle).toHaveBeenCalledWith('src/z.ts');
        expect(screen.getByTestId('focused-diff').textContent).toContain('src/z.ts');
    });
    it('steps files with previous/next and disables at the ends', () => {
        render(<GitFileReview {...props} />);
        const prev = screen.getByRole('button', { name: 'Previous file' });
        expect(prev).toHaveProperty('disabled', true);
        fireEvent.click(screen.getByRole('button', { name: 'Next file' }));
        expect(screen.getByTestId('git-review-file-index').textContent).toBe('2/4');
        expect(prev).toHaveProperty('disabled', false);
        fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
        expect(screen.getByTestId('git-review-file-index').textContent).toBe('4 files');
        expect(screen.queryByTestId('git-review-change-stats')).toBeNull();
    });
    it('renders context identity, classify, actions, overflow-only items and below content', () => {
        const action = vi.fn(); const menuOnly = vi.fn();
        const title = 'feat: '.padEnd(400, 'very long commit subject ');
        render(<GitFileReview {...props} header={{
            identity: <button type="button" className="git-review-title" title={title}>{title}</button>,
            classify: <button type="button">Classify</button>,
            actions: [{ id: 'chat', label: 'Toggle AI chat', icon: <svg aria-hidden="true" />, onClick: action, pressed: false, count: 3, testId: 'chat' }],
            menuActions: [{ id: 'copy', label: 'Copy full SHA', icon: null, onClick: menuOnly, testId: 'copy' }],
            below: <div data-testid="below">details</div>,
        }} />);
        expect(toolbar().contains(screen.getByRole('button', { name: title }))).toBe(true);
        expect(toolbar().firstElementChild!.className).toBe('git-review-identity');
        expect(screen.getByRole('button', { name: 'Toggle AI chat' }).textContent).toBe('3');
        expect(toolbar().contains(screen.getByTestId('below'))).toBe(false);
        const more = screen.getByRole('button', { name: 'More review actions' });
        // Overflow-only items keep the trigger visible in wide panes.
        expect(more.className).not.toContain('git-review-collapsible');
        fireEvent.click(more);
        expect(screen.getByTestId('chat-menu-item').className).toContain('git-review-collapsible');
        expect(screen.getByTestId('copy-menu-item').className).not.toContain('git-review-collapsible');
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByTestId('copy-menu-item'));
        fireEvent.click(screen.getByTestId('copy-menu-item'));
        expect(menuOnly).toHaveBeenCalledOnce();
        expect(screen.queryByRole('menu')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Toggle AI chat' }));
        expect(action).toHaveBeenCalledOnce();
    });
    it('keeps the toolbar and header while files load, without viewed controls', () => {
        render(<GitFileReview {...props} files={[]} loading header={{ identity: <span>Commit</span> }} />);
        expect(toolbar().textContent).toContain('Commit');
        expect(screen.queryByRole('button', { name: 'Mark viewed' })).toBeNull();
        expect(screen.queryByTestId('git-review-reviewed-count')).toBeNull();
        expect(screen.queryByTestId('git-review-more')).toBeNull();
    });
    it('portals overflow outside a narrow clipped review and keeps it inside the viewport', () => {
        const action = vi.fn();
        const outside = vi.fn();
        let anchor = { right: window.innerWidth - 2, bottom: window.innerHeight - 2 };
        const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
            if (this.classList.contains('git-review-menu')) return { width: 200, height: 180 } as DOMRect;
            if (this.classList.contains('git-file-review')) return { width: 60, left: anchor.right - 60 } as DOMRect;
            return anchor as DOMRect;
        });
        document.addEventListener('mousedown', outside);
        try {
            const view = render(<GitFileReview {...props} header={{ actions: [
                { id: 'chat', label: 'Toggle AI chat', icon: null, onClick: action, pressed: true, testId: 'chat' },
            ] }} />);
            const more = screen.getByTestId('git-review-more');
            fireEvent.click(more);
            const menu = screen.getByRole('menu', { name: 'More review actions' });
            expect(view.container.contains(menu)).toBe(false);
            expect(menu.parentElement!.parentElement).toBe(document.body);
            expect(menu.parentElement!.style.width).toBe('60px');
            expect(menu.parentElement!.classList.contains('git-file-review')).toBe(true);
            expect(menu.style.left).toBe(`${window.innerWidth - 208}px`);
            expect(menu.style.top).toBe(`${window.innerHeight - 188}px`);
            anchor = { right: 750, bottom: 100 };
            fireEvent.scroll(window);
            expect(menu.style.left).toBe('550px');
            expect(menu.style.top).toBe('104px');
            const item = within(menu).getByRole('menuitemcheckbox', { name: 'Toggle AI chat' });
            fireEvent.mouseDown(item);
            expect(outside).not.toHaveBeenCalled();
            fireEvent.click(item);
            expect(action).toHaveBeenCalledOnce();
            expect(screen.queryByRole('menu')).toBeNull();
            expect(document.activeElement).toBe(more);
        } finally {
            document.removeEventListener('mousedown', outside);
            bounds.mockRestore();
        }
    });
    it('defines a 34px nonwrapping row with container-driven compaction tiers', () => {
        const css = readFileSync(join(__dirname, '../../../../src/server/spa/client/react/features/git/diff/git-file-review.css'), 'utf8');
        expect(css).toMatch(/\.git-review-tools\{[^}]*flex-wrap:nowrap[^}]*height:34px/);
        expect(css).toContain('@container(min-width:900px){.git-review-collapsible{display:none!important}}');
        expect(css).toContain('@container(max-width:899px){.git-review-wide{display:none!important}}');
        expect(css).toContain('@container(max-width:599px){.git-review-md{display:none!important}}');
        expect(css).toContain('@container(max-width:479px){.git-review-label-sm{display:none!important}}');
    });
});

describe('resizable changed-files separator', () => {
    let resizeObservers: Array<(width: number) => void> = [];
    beforeEach(() => {
        localStorage.clear(); resizeObservers = [];
        vi.stubGlobal('ResizeObserver', class {
            constructor(private cb: ResizeObserverCallback) {}
            observe() { resizeObservers.push(width => act(() => this.cb([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver))); }
            disconnect() {}
        });
    });
    afterEach(() => vi.unstubAllGlobals());
    const separator = () => screen.getByRole('separator', { name: 'Resize changed files list' });
    const navWidth = () => (screen.getByTestId('git-file-review').querySelector('.git-review-body') as HTMLElement).style.getPropertyValue('--git-review-nav-width');

    it('sits between the file list and the diff with an accessible default width', () => {
        render(<GitFileReview {...props} />);
        const sep = separator();
        expect(sep.previousElementSibling).toBe(nav());
        expect(sep.nextElementSibling?.getAttribute('aria-label')).toBe('Focused file diff');
        expect(sep.getAttribute('aria-orientation')).toBe('vertical');
        expect(sep.getAttribute('aria-controls')).toBe(nav().id);
        expect(sep.tabIndex).toBe(0);
        expect(sep.getAttribute('aria-valuenow')).toBe('262');
        expect(navWidth()).toBe('262px');
    });
    it('resizes by keyboard within bounds, persists, and keeps the selected diff mounted', () => {
        render(<GitFileReview {...props} />); open('src/z.ts');
        const mounts = panel.mock.calls.length;
        fireEvent.keyDown(separator(), { key: 'ArrowRight' });
        expect(navWidth()).toBe('278px');
        fireEvent.keyDown(separator(), { key: 'ArrowLeft', shiftKey: true });
        expect(navWidth()).toBe('214px');
        fireEvent.keyDown(separator(), { key: 'Home' });
        expect(navWidth()).toBe('180px');
        fireEvent.keyDown(separator(), { key: 'ArrowLeft' });
        expect(navWidth()).toBe('180px');
        fireEvent.keyDown(separator(), { key: 'End' });
        expect(navWidth()).toBe('560px');
        expect(localStorage.getItem(NAV_WIDTH_STORAGE_KEY)).toBe('560');
        expect(screen.getByTestId('focused-diff').textContent).toContain('src/z.ts');
        expect(panel.mock.calls.slice(mounts).every(([p]) => p.filePath === 'src/z.ts')).toBe(true);
        fireEvent.doubleClick(separator());
        expect(navWidth()).toBe('262px');
    });
    it('resizes by mouse drag', () => {
        render(<GitFileReview {...props} />);
        fireEvent.mouseDown(separator(), { clientX: 262 });
        expect(separator().className).toContain('dragging');
        fireEvent.mouseMove(document, { clientX: 362 });
        fireEvent.mouseUp(document);
        expect(navWidth()).toBe('362px');
        expect(localStorage.getItem(NAV_WIDTH_STORAGE_KEY)).toBe('362');
    });
    it('caps the list so the diff keeps room, and restores the preference when the container widens', () => {
        localStorage.setItem(NAV_WIDTH_STORAGE_KEY, '500');
        render(<GitFileReview {...props} />);
        expect(navWidth()).toBe('500px');
        resizeObservers.forEach(fire => fire(720));
        expect(navWidth()).toBe('400px');
        expect(separator().getAttribute('aria-valuemax')).toBe('400');
        fireEvent.keyDown(separator(), { key: 'ArrowRight' });
        expect(navWidth()).toBe('400px');
        resizeObservers.forEach(fire => fire(300));
        expect(navWidth()).toBe('180px');
        expect(localStorage.getItem(NAV_WIDTH_STORAGE_KEY)).toBe('500');
        resizeObservers.forEach(fire => fire(1400));
        expect(navWidth()).toBe('500px');
    });
    it('ignores a corrupt stored width and hides the separator in the narrow drawer tier', () => {
        localStorage.setItem(NAV_WIDTH_STORAGE_KEY, 'wide');
        render(<GitFileReview {...props} />);
        expect(navWidth()).toBe('262px');
        const css = readFileSync(join(__dirname, '../../../../src/server/spa/client/react/features/git/diff/git-file-review.css'), 'utf8');
        expect(css).toContain('.git-review-nav{width:var(--git-review-nav-width,262px)');
        expect(css).toMatch(/\.git-review-resizer\{[^}]*cursor:col-resize/);
        expect(css).toContain('@container(max-width:700px){.git-review-nav,.git-review-resizer{display:none}');
    });
});

describe('review metadata model', () => {
    it('classifies portable paths and groups root files', () => {
        expect(reviewFileKind('packages/x/spec/example.ts')).toBe('tests');
        expect(reviewFileKind('a/b.spec.ts')).toBe('tests');
        expect(reviewFileKind('README.md')).toBe('docs');
        expect(reviewFileKind('src/a.ts')).toBe('source');
        expect(groupReviewFiles([{ path: 'z.ts', status: 'M' }])[0].directory).toBe('.');
    });
    it('preserves rename/deletion metadata and does not mutate input ordering', () => {
        const before = files.map(file => file.path);
        expect(filterReviewFiles(files, '', 'all', 'R', false, new Set())[0]).toBe(files[1]);
        expect(filterReviewFiles(files, '', 'docs', 'D', false, new Set())[0]).toBe(files[3]);
        groupReviewFiles(files);
        expect(files.map(file => file.path)).toEqual(before);
    });
});
