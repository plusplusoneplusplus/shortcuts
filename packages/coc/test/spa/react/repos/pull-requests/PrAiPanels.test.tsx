/**
 * Coverage for the small presentational sub-panels on the redesigned PR review page.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PrReviewSummaryPanel } from '../../../../../src/server/spa/client/react/features/pull-requests/PrReviewSummaryPanel';
import { PrAiGroupedThreads } from '../../../../../src/server/spa/client/react/features/pull-requests/PrAiGroupedThreads';
import { PrCommitTable } from '../../../../../src/server/spa/client/react/features/pull-requests/PrCommitTable';
import {
    PrChecksTable,
    PrMergeReadiness,
} from '../../../../../src/server/spa/client/react/features/pull-requests/PrChecksAndReadiness';
import { PrFilesPanel } from '../../../../../src/server/spa/client/react/features/pull-requests/PrFilesPanel';
import { PrConversationPanel } from '../../../../../src/server/spa/client/react/features/pull-requests/PrConversationPanel';
import { buildPrReviewSummary } from '../../../../../src/server/spa/client/react/features/pull-requests/pr-detail-summary';
import {
    buildCheckRowsFromChecks,
    buildMergeReadinessFromData,
    buildThreadGroupsFromThreads,
    buildTimelineFromRealData,
} from '../../../../../src/server/spa/client/react/features/pull-requests/pr-derived-data';
import { parseDiffFileList } from '../../../../../src/server/spa/client/react/features/git/diff';
import type {
    CommentThread,
    PullRequest,
    PullRequestCheck,
    PullRequestCommit,
    Reviewer,
} from '../../../../../src/server/spa/client/react/features/pull-requests/pr-utils';

const samplePr: PullRequest = {
    id: 4289,
    number: 4289,
    title: 'feat(stream): add JSONL backpressure to ingestion worker',
    sourceBranch: 'morgan:jsonl-streaming',
    targetBranch: 'main',
    status: 'open',
    createdAt: '2026-04-01T10:00:00Z',
    updatedAt: '2026-04-02T12:30:00Z',
    description: 'Switches the ingestion worker to a streaming JSONL pipeline.',
};

const sampleThreads: CommentThread[] = [
    {
        id: 'thread-1',
        status: 'active',
        comments: [{
            id: 'comment-1',
            author: { displayName: 'Reviewer One' },
            body: 'Please handle the null stream case.',
        }],
        threadContext: { filePath: 'src/stream.ts', line: 42 },
    },
];

const sampleCommits: PullRequestCommit[] = [
    {
        id: 'abcdef1234567890',
        shortId: 'abcdef1',
        message: 'Fix retry handling',
        subject: 'Fix retry handling',
        author: { displayName: 'Contributor One' },
    },
];

const sampleChecks: PullRequestCheck[] = [
    { id: 'build', name: 'build', status: 'success', source: 'check', durationMs: 60_000 },
    { id: 'lint', name: 'lint', status: 'success', source: 'check', durationMs: 30_000 },
];

const sampleReviewers: Reviewer[] = [
    { identity: { displayName: 'Approving Reviewer' }, vote: 'approved', isRequired: true },
];

function fileRows() {
    return Array.from(screen.getByRole('complementary', { name: 'Changed files' }).querySelectorAll<HTMLElement>('[data-file-path]'));
}

describe('PrReviewSummaryPanel', () => {
    it('renders deterministic finding facts', () => {
        const summary = buildPrReviewSummary({
            pr: samplePr,
            diffStats: { additions: 240, deletions: 60, changedFiles: 6 },
            checks: [{
                id: 'lint',
                name: 'lint',
                status: 'failure',
                source: 'check',
                description: 'eslint failed',
            }],
            reviewers: [{ identity: { displayName: 'Reviewer' }, vote: 'approved' }],
            threads: [{
                id: 'thread-1',
                status: 'active',
                comments: [{ id: 'c1', body: 'Please handle the null stream case.' }],
                threadContext: { filePath: 'src/stream.ts', line: 42 },
            }],
        });

        render(<PrReviewSummaryPanel summary={summary} />);
        expect(screen.getByTestId('pr-review-summary')).toBeInTheDocument();
        expect(screen.getByTestId('pr-review-summary-copy').textContent?.trim()).toBe(samplePr.description);
        expect(screen.queryByTestId('pr-review-metrics')).not.toBeInTheDocument();
        expect(screen.getByTestId('pr-review-findings').textContent).toContain('lint: eslint failed');
        expect(screen.getByTestId('pr-review-findings').textContent).toContain('src/stream.ts:42');
    });

    it('renders markdown summary as HTML', () => {
        const mdDescription = '## Summary\n- **Bold** item\n- [Link](https://example.com)\n\n`inline code` and regular text.';
        const summary = buildPrReviewSummary({
            pr: { ...samplePr, description: mdDescription },
            diffStats: { additions: 10, deletions: 2, changedFiles: 1 },
            checks: [],
            reviewers: [],
            threads: [],
        });

        render(<PrReviewSummaryPanel summary={summary} />);
        const el = screen.getByTestId('pr-review-summary-copy');
        expect(el.innerHTML).toContain('<h2');
        expect(el.innerHTML).toContain('<strong>Bold</strong>');
        expect(el.innerHTML).toContain('<a href="https://example.com"');
        expect(el.innerHTML).toContain('target="_blank"');
        expect(el.innerHTML).toContain('<code>inline code</code>');
        expect(el.querySelector('ul')).not.toBeNull();
    });
});

describe('PrConversationPanel', () => {
    it('renders the timeline and lets the user draft a reply', () => {
        render(
            <PrConversationPanel
                events={buildTimelineFromRealData(
                    sampleThreads,
                    sampleCommits,
                    buildThreadGroupsFromThreads(sampleThreads),
                )}
            />,
        );
        expect(screen.getAllByTestId('pr-timeline-event').length).toBeGreaterThanOrEqual(2);
        const reply = screen.getByTestId('pr-reply-box') as HTMLTextAreaElement;
        expect(reply.value).toBe('');

        fireEvent.click(screen.getByTestId('pr-draft-reply'));
        expect(reply.value.length).toBeGreaterThan(0);
    });
});

describe('PrAiGroupedThreads', () => {
    it('groups real threads into the three deterministic severity buckets', () => {
        const realThreads = [
            { id: 1, comments: [{ body: 'this looks like a real bug, crash on null' }] },
            { id: 2, comments: [{ body: 'nit: typo here' }] },
            { id: 3, comments: [{ body: 'general note about future work' }], threadContext: { filePath: 'src/foo.ts' } },
        ];
        render(
            <PrAiGroupedThreads
                groups={buildThreadGroupsFromThreads(realThreads)}
                totalThreads={realThreads.length}
            />,
        );
        const rows = screen.getAllByTestId('pr-ai-thread-group');
        expect(rows).toHaveLength(3);
        const severities = rows.map(row => row.getAttribute('data-severity'));
        expect(severities).toEqual(['blocking', 'non-blocking', 'noise']);
        expect(screen.getByTestId('pr-ai-thread-total').textContent).toContain('3');
        // header pill or severity tag — at least one mention of "blocking"
        expect(screen.getAllByText(/blocking/i).length).toBeGreaterThan(0);
    });

    it('renders an empty-state message when there are no threads', () => {
        render(<PrAiGroupedThreads groups={buildThreadGroupsFromThreads([])} totalThreads={0} />);
        expect(screen.getByText(/No comment threads/i)).toBeTruthy();
        expect(screen.queryAllByTestId('pr-ai-thread-group')).toHaveLength(0);
    });
});

describe('PrCommitTable', () => {
    it('renders one row per commit', () => {
        render(<PrCommitTable rows={[
            {
                sha: 'abcdef1234567890',
                shortSha: 'abcdef1',
                title: 'Fix retry handling',
                author: { displayName: 'Contributor Two' },
                committedAt: '2024-01-01T00:00:00Z',
            },
            {
                sha: '123456abcdef7890',
                shortSha: '123456a',
                title: 'Add retry tests',
                author: { displayName: 'Contributor Three' },
                committedAt: '2024-01-02T00:00:00Z',
            },
        ]} />);
        expect(screen.getAllByTestId('pr-commit-row')).toHaveLength(2);
        expect(screen.getByText('Fix retry handling')).toBeInTheDocument();
    });

    it('renders an empty state', () => {
        render(<PrCommitTable rows={[]} />);
        expect(screen.getByTestId('pr-commits-empty')).toBeInTheDocument();
    });
});

describe('PrChecksTable + PrMergeReadiness', () => {
    it('renders a row per check and a passing pill', () => {
        render(<PrChecksTable rows={buildCheckRowsFromChecks(sampleChecks)} />);
        expect(screen.getAllByTestId('pr-check-row')).toHaveLength(2);
        expect(screen.getByText(/passing/i)).toBeInTheDocument();
    });

    it('renders the merge readiness checklist', () => {
        render(<PrMergeReadiness items={buildMergeReadinessFromData({
            checks: sampleChecks,
            threads: [],
            reviewers: sampleReviewers,
        })} />);
        expect(screen.getAllByTestId('pr-merge-readiness-item').length).toBeGreaterThan(0);
    });
});

describe('PrFilesPanel', () => {
    const rawFilesDiff = [
        'diff --git a/src/foo.ts b/src/foo.ts',
        '--- a/src/foo.ts',
        '+++ b/src/foo.ts',
        '@@ -1,1 +1,2 @@',
        ' keep',
        '+added',
        'diff --git a/docs/readme.md b/docs/readme.md',
        '--- a/docs/readme.md',
        '+++ b/docs/readme.md',
        '@@ -1,1 +1,1 @@',
        '-old',
        '+new',
        'diff --git a/test/worker.ts b/test/worker.ts',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/test/worker.ts',
        '@@ -0,0 +1,1 @@',
        '+ok',
        '',
    ].join('\n');
    const realDiff = parseDiffFileList(rawFilesDiff);

    it('renders a row per parsed file', () => {
        render(<PrFilesPanel files={realDiff} />);
        const rows = fileRows();
        expect(rows).toHaveLength(3);
    });

    it('filters files by the search input', () => {
        render(<PrFilesPanel files={realDiff} />);
        const search = screen.getByRole('textbox', { name: 'Search changed files by name or path' }) as HTMLInputElement;
        fireEvent.change(search, { target: { value: 'docs/' } });
        const rows = fileRows();
        rows.forEach(row => {
            expect(row.getAttribute('data-file-path')).toContain('docs/');
        });
    });

    it('changes the active file when a row is clicked', () => {
        render(<PrFilesPanel files={realDiff} />);
        const rows = fileRows();
        const target = rows.find(row => row.getAttribute('data-file-path') === 'test/worker.ts');
        expect(target).toBeTruthy();
        fireEvent.click(target!);
        expect(target).toHaveAttribute('aria-current', 'true');
    });

    it('renders an empty placeholder when there are no files', () => {
        render(<PrFilesPanel files={[]} />);
        // Split layout: both the file list and the diff panel report the empty state.
        expect(screen.getAllByText(/No file changes/i).length).toBeGreaterThan(0);
    });

    it('selects a file inline on row click without triggering the pop-out', () => {
        const onPopOut = vi.fn();
        render(<PrFilesPanel files={realDiff} onPopOut={onPopOut} />);
        const rows = fileRows();
        fireEvent.click(rows[0]);
        expect(onPopOut).not.toHaveBeenCalled();
    });

    it('calls onPopOut with the active file from the explicit pop-out button', () => {
        const onPopOut = vi.fn();
        render(<PrFilesPanel files={realDiff} diffText={rawFilesDiff} onPopOut={onPopOut} />);
        const target = fileRows()
            .find(row => row.getAttribute('data-file-path') === 'test/worker.ts');
        fireEvent.click(target!);
        fireEvent.click(screen.getByTestId('pr-diff-popout'));
        expect(onPopOut).toHaveBeenCalledWith('test/worker.ts');
    });

    it('renders the selected file diff inline and swaps to another file lazily', () => {
        render(<PrFilesPanel files={realDiff} diffText={rawFilesDiff} />);
        // Default selection (src/foo.ts) renders inline; other files are not rendered.
        const fooDiff = screen.getByTestId('pr-inline-diff');
        expect(fooDiff.textContent).toContain('added');
        expect(fooDiff.textContent).not.toContain('old');

        const readmeRow = fileRows()
            .find(row => row.getAttribute('data-file-path') === 'docs/readme.md');
        fireEvent.click(readmeRow!);
        const readmeDiff = screen.getByTestId('pr-inline-diff');
        expect(readmeDiff.textContent).toContain('old');
        expect(readmeDiff.textContent).toContain('new');
    });

    it('shows file rows by basename (not full path) inside their parent folder', () => {
        render(<PrFilesPanel files={realDiff} />);
        const rows = fileRows();
        const labels = rows.map(row => row.querySelector('.git-review-file-name strong')?.textContent);
        expect(labels.sort()).toEqual(['foo.ts', 'readme.md', 'worker.ts']);
    });

    it('renders folder rows in tree mode by default', () => {
        render(<PrFilesPanel files={realDiff} />);
        const folders = Array.from(screen.getByRole('complementary', { name: 'Changed files' }).querySelectorAll<HTMLElement>('[aria-expanded]')).filter(el => el.classList.contains('git-review-directory'));
        const names = folders.map(f => f.getAttribute('aria-label'));
        expect(names.sort()).toEqual(['docs', 'src', 'test'].sort());
    });

    it('collapses a folder when its row is clicked, hiding its files', () => {
        render(<PrFilesPanel files={realDiff} />);
        const docsFolder = Array.from(screen.getByRole('complementary', { name: 'Changed files' }).querySelectorAll<HTMLElement>('[aria-expanded]')).filter(el => el.classList.contains('git-review-directory'))
            .find(f => f.getAttribute('aria-label') === 'docs');
        expect(docsFolder).toBeTruthy();
        expect(docsFolder!.getAttribute('aria-expanded')).toBe('true');
        expect(
            fileRows().some(r => r.getAttribute('data-file-path') === 'docs/readme.md'),
        ).toBe(true);
        fireEvent.click(docsFolder!);
        const visible = fileRows()
            .map(r => r.getAttribute('data-file-path'));
        expect(visible).not.toContain('docs/readme.md');
        expect(visible).toContain('src/foo.ts');
        expect(visible).toContain('test/worker.ts');
    });

    it('switches to flat mode and shows each file directory with its basename', () => {
        render(<PrFilesPanel files={realDiff} />);
        fireEvent.click(screen.getByRole('button', { name: 'Flat', exact: true }));
        expect(screen.getByRole('complementary', { name: 'Changed files' }).querySelector('.git-review-directory')).toBeNull();
        const basenames = fileRows()
            .map(row => row.querySelector('.git-review-file-name strong')?.textContent);
        expect(basenames.sort()).toEqual(['foo.ts', 'readme.md', 'worker.ts']);
        fileRows().forEach(row => {
            expect(row.querySelector('.git-review-file-name small')?.textContent).toBe(row.getAttribute('data-file-path')?.split('/').slice(0, -1).join('/'));
        });
    });

    it('uses the compact shared rows for long paths, with separate basename and change counts', () => {
        const path = 'packages/coc/src/server/spa/client/react/features/pull-requests/very-long-component-name.tsx';
        render(<PrFilesPanel files={[{ path, status: 'M', additions: 2, deletions: 1 }]} />);
        const nav = screen.getByRole('complementary', { name: 'Changed files' });
        const row = nav.querySelector('[data-file-path]')!;
        expect(row.querySelector('.git-review-file-name strong')?.textContent).toBe('very-long-component-name.tsx');
        expect(row.querySelector('.git-review-counts')?.textContent).toBe('+2−1');
        expect(nav.querySelector('.git-review-directory')).toHaveAttribute('aria-label', 'packages/coc/src/server/spa/client/react/features/pull-requests');
        expect(nav.querySelector('.git-review-file-list')).toBeTruthy();
    });

});

// suppress unused import warning when running through transformer
void vi;
