import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { GitFileReview } from '../../../../src/server/spa/client/react/features/git/diff/GitFileReview';
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
        fireEvent.click(within(nav()).getByRole('button', { name: 'Source', exact: true }));
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
        fireEvent.click(within(nav()).getByRole('button', { name: 'Docs', exact: true }));
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
