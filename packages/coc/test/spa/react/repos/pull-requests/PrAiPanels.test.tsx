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

describe('PrReviewSummaryPanel', () => {
    it('renders deterministic metric and finding facts', () => {
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
        expect(screen.getByTestId('pr-review-metrics').children.length).toBe(5);
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
    const realDiff = parseDiffFileList([
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
    ].join('\n'));

    it('renders a row per parsed file', () => {
        render(<PrFilesPanel files={realDiff} />);
        const rows = screen.getAllByTestId('pr-file-row');
        expect(rows).toHaveLength(3);
    });

    it('filters files by the search input', () => {
        render(<PrFilesPanel files={realDiff} />);
        const search = screen.getByTestId('pr-file-search') as HTMLInputElement;
        fireEvent.change(search, { target: { value: 'docs/' } });
        const rows = screen.getAllByTestId('pr-file-row');
        rows.forEach(row => {
            expect(row.textContent?.toLowerCase()).toContain('docs/');
        });
    });

    it('changes the active file when a row is clicked', () => {
        render(<PrFilesPanel files={realDiff} />);
        const rows = screen.getAllByTestId('pr-file-row');
        const target = rows.find(row => row.getAttribute('data-file-path') === 'test/worker.ts');
        expect(target).toBeTruthy();
        fireEvent.click(target!);
        expect(target!.className).toMatch(/bg-blue-100|bg-blue-900/);
    });

    it('renders an empty placeholder when there are no files', () => {
        render(<PrFilesPanel files={[]} />);
        expect(screen.getByText(/No file changes/i)).toBeTruthy();
    });

    it('calls onFileClick when a file row is clicked', () => {
        const onFileClick = vi.fn();
        render(<PrFilesPanel files={realDiff} onFileClick={onFileClick} />);
        const rows = screen.getAllByTestId('pr-file-row');
        fireEvent.click(rows[0]);
        expect(onFileClick).toHaveBeenCalledWith(rows[0].getAttribute('data-file-path'));
    });

    it('shows file rows by basename (not full path) inside their parent folder', () => {
        render(<PrFilesPanel files={realDiff} />);
        const rows = screen.getAllByTestId('pr-file-row');
        const labels = rows.map(row => row.querySelector('[data-testid="pr-file-basename"]')?.textContent);
        expect(labels.sort()).toEqual(['foo.ts', 'readme.md', 'worker.ts']);
    });

    it('renders folder rows in tree mode by default', () => {
        render(<PrFilesPanel files={realDiff} />);
        const folders = screen.getAllByTestId('pr-file-tree-folder');
        const names = folders.map(f => f.getAttribute('data-folder-path'));
        expect(names.sort()).toEqual(['docs', 'src', 'test'].sort());
    });

    it('collapses a folder when its row is clicked, hiding its files', () => {
        render(<PrFilesPanel files={realDiff} />);
        const docsFolder = screen
            .getAllByTestId('pr-file-tree-folder')
            .find(f => f.getAttribute('data-folder-path') === 'docs');
        expect(docsFolder).toBeTruthy();
        expect(docsFolder!.getAttribute('data-collapsed')).toBe('false');
        expect(
            screen.getAllByTestId('pr-file-row').some(r => r.getAttribute('data-file-path') === 'docs/readme.md'),
        ).toBe(true);
        fireEvent.click(docsFolder!);
        const visible = screen
            .getAllByTestId('pr-file-row')
            .map(r => r.getAttribute('data-file-path'));
        expect(visible).not.toContain('docs/readme.md');
        expect(visible).toContain('src/foo.ts');
        expect(visible).toContain('test/worker.ts');
    });

    it('switches to flat mode when the Flat toggle is clicked and shows dirname above basename', () => {
        render(<PrFilesPanel files={realDiff} />);
        fireEvent.click(screen.getByTestId('pr-file-view-flat'));
        expect(screen.queryByTestId('pr-file-tree-folder')).toBeNull();
        const basenames = screen
            .getAllByTestId('pr-file-row')
            .map(row => row.querySelector('[data-testid="pr-file-basename"]')?.textContent);
        expect(basenames.sort()).toEqual(['foo.ts', 'readme.md', 'worker.ts']);
        screen.getAllByTestId('pr-file-row').forEach(row => {
            expect(row.textContent ?? '').toMatch(/\//);
        });
    });

    it('keeps the basename and +/- delta visible side-by-side in tree rows so the delta is never overflow-hidden', () => {
        render(<PrFilesPanel files={realDiff} />);
        const row = screen
            .getAllByTestId('pr-file-row')
            .find(r => r.getAttribute('data-file-path') === 'src/foo.ts');
        expect(row).toBeTruthy();
        const basename = row!.querySelector('[data-testid="pr-file-basename"]') as HTMLElement;
        expect(basename.className).toMatch(/flex-1/);
        expect(basename.className).toMatch(/min-w-0/);
        expect(basename.className).toMatch(/truncate/);
        expect(row!.textContent ?? '').toMatch(/\+\d+\s+-\d+/);
    });

    it('disables horizontal scrolling on the file list and keeps min-w-0 on the wrappers so deeply nested or long collapsed folder names truncate instead of overflowing', () => {
        const deepDiff = parseDiffFileList([
            'diff --git a/packages/coc/src/server/spa/client/react/features/pull-requests/an-extremely-long-component-name-that-would-otherwise-overflow-the-panel.tsx b/packages/coc/src/server/spa/client/react/features/pull-requests/an-extremely-long-component-name-that-would-otherwise-overflow-the-panel.tsx',
            '--- a/packages/coc/src/server/spa/client/react/features/pull-requests/an-extremely-long-component-name-that-would-otherwise-overflow-the-panel.tsx',
            '+++ b/packages/coc/src/server/spa/client/react/features/pull-requests/an-extremely-long-component-name-that-would-otherwise-overflow-the-panel.tsx',
            '@@ -1,1 +1,2 @@',
            ' keep',
            '+added',
            '',
        ].join('\n'));

        render(<PrFilesPanel files={deepDiff} />);

        const scroll = screen.getByTestId('pr-file-list-scroll');
        expect(scroll.className).toMatch(/overflow-x-hidden/);
        expect(scroll.className).toMatch(/overflow-y-auto/);
        expect(scroll.className).toMatch(/min-w-0/);

        const folders = screen.getAllByTestId('pr-file-tree-folder');
        expect(folders.length).toBeGreaterThan(0);
        for (const folder of folders) {
            expect(folder.className).toMatch(/min-w-0/);
            const label = folder.querySelector('span.truncate');
            expect(label).toBeTruthy();
        }
    });
});

// suppress unused import warning when running through transformer
void vi;
