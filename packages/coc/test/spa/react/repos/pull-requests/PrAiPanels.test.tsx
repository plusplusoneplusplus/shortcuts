/**
 * Coverage for the small AI presentational sub-panels on the redesigned
 * PR review page.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PrAiSummaryPanel } from '../../../../../src/server/spa/client/react/features/pull-requests/PrAiSummaryPanel';
import { PrQuickReviewWorkflow } from '../../../../../src/server/spa/client/react/features/pull-requests/PrQuickReviewWorkflow';
import { PrAiGroupedThreads } from '../../../../../src/server/spa/client/react/features/pull-requests/PrAiGroupedThreads';
import { PrCommitTable } from '../../../../../src/server/spa/client/react/features/pull-requests/PrCommitTable';
import {
    PrChecksTable,
    PrMergeReadiness,
} from '../../../../../src/server/spa/client/react/features/pull-requests/PrChecksAndReadiness';
import { PrFilesPanel } from '../../../../../src/server/spa/client/react/features/pull-requests/PrFilesPanel';
import { PrConversationPanel } from '../../../../../src/server/spa/client/react/features/pull-requests/PrConversationPanel';
import {
    buildAiThreadGroupsFromThreads,
    getMockAiSummary,
    getMockCheckRows,
    getMockMergeReadiness,
    getMockPersonaLenses,
    getMockTimeline,
} from '../../../../../src/server/spa/client/react/features/pull-requests/pr-mock-data';
import { parseUnifiedDiff } from '../../../../../src/server/spa/client/react/features/pull-requests/unified-diff-parser';
import type { PullRequest } from '../../../../../src/server/spa/client/react/features/pull-requests/pr-utils';

const samplePr: PullRequest = {
    id: 4289,
    number: 4289,
    title: 'feat(stream): add JSONL backpressure to ingestion worker',
    sourceBranch: 'morgan:jsonl-streaming',
    targetBranch: 'main',
    status: 'open',
    createdAt: '2026-04-01T10:00:00Z',
    updatedAt: '2026-04-02T12:30:00Z',
};

describe('PrAiSummaryPanel', () => {
    it('renders the metric grid and finding list', () => {
        render(<PrAiSummaryPanel summary={getMockAiSummary(samplePr)} />);
        expect(screen.getByTestId('pr-ai-summary')).toBeInTheDocument();
        expect(screen.getByTestId('pr-ai-metrics').children.length).toBe(4);
        expect(screen.getByTestId('pr-ai-findings').children.length).toBeGreaterThan(0);
    });
});

describe('PrQuickReviewWorkflow', () => {
    it('renders one card per persona lens', () => {
        render(<PrQuickReviewWorkflow lenses={getMockPersonaLenses()} />);
        expect(screen.getAllByTestId('pr-quick-workflow-lens')).toHaveLength(3);
    });
});

describe('PrConversationPanel', () => {
    it('renders the timeline and lets the user draft a reply', () => {
        render(<PrConversationPanel events={getMockTimeline()} />);
        expect(screen.getAllByTestId('pr-timeline-event').length).toBeGreaterThanOrEqual(3);
        const reply = screen.getByTestId('pr-reply-box') as HTMLTextAreaElement;
        expect(reply.value).toBe('');

        fireEvent.click(screen.getByTestId('pr-draft-reply'));
        expect(reply.value.length).toBeGreaterThan(0);
    });
});

describe('PrAiGroupedThreads', () => {
    it('groups real threads into the three AI severity buckets', () => {
        const realThreads = [
            { id: 1, comments: [{ body: 'this looks like a real bug, crash on null' }] },
            { id: 2, comments: [{ body: 'nit: typo here' }] },
            { id: 3, comments: [{ body: 'general note about future work' }], threadContext: { filePath: 'src/foo.ts' } },
        ];
        render(
            <PrAiGroupedThreads
                groups={buildAiThreadGroupsFromThreads(realThreads)}
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
        render(<PrAiGroupedThreads groups={buildAiThreadGroupsFromThreads([])} totalThreads={0} />);
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
                author: { displayName: 'Alice' },
                committedAt: '2024-01-01T00:00:00Z',
            },
            {
                sha: '123456abcdef7890',
                shortSha: '123456a',
                title: 'Add retry tests',
                author: { displayName: 'Bob' },
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
        render(<PrChecksTable rows={getMockCheckRows()} />);
        expect(screen.getAllByTestId('pr-check-row').length).toBeGreaterThanOrEqual(5);
        expect(screen.getByText(/passing/i)).toBeInTheDocument();
    });

    it('renders the merge readiness checklist', () => {
        render(<PrMergeReadiness items={getMockMergeReadiness()} />);
        expect(screen.getAllByTestId('pr-merge-readiness-item').length).toBeGreaterThan(0);
    });
});

describe('PrFilesPanel', () => {
    const realDiff = parseUnifiedDiff([
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
    ].join('\n')).files;

    it('renders a row per parsed file', () => {
        render(<PrFilesPanel files={realDiff} />);
        const rows = screen.getAllByTestId('pr-file-row');
        expect(rows).toHaveLength(3);
        expect(screen.getByTestId('pr-file-diff-card')).toBeInTheDocument();
    });

    it('shows AI annotations only for paths supplied in the annotations map', () => {
        render(
            <PrFilesPanel
                files={realDiff}
                annotations={{ 'src/foo.ts': { title: 'AI noticed', body: 'Watch this', actions: ['Apply'] } }}
            />,
        );
        expect(screen.getByTestId('pr-file-ai-annotation').textContent).toContain('AI noticed');
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

    it('renders a binary-file placeholder instead of diff body for binary files', () => {
        const binaryDiff = parseUnifiedDiff([
            'diff --git a/logo.png b/logo.png',
            'index 1..2 100644',
            'Binary files a/logo.png and b/logo.png differ',
            '',
        ].join('\n')).files;
        render(<PrFilesPanel files={binaryDiff} />);
        expect(screen.getByText(/Binary file/i)).toBeTruthy();
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
        // Initially readme.md is visible (folder expanded).
        expect(
            screen.getAllByTestId('pr-file-row').some(r => r.getAttribute('data-file-path') === 'docs/readme.md'),
        ).toBe(true);
        fireEvent.click(docsFolder!);
        // After collapse, docs/readme.md row should be gone.
        const visible = screen
            .getAllByTestId('pr-file-row')
            .map(r => r.getAttribute('data-file-path'));
        expect(visible).not.toContain('docs/readme.md');
        // src/foo.ts and test/worker.ts stay visible.
        expect(visible).toContain('src/foo.ts');
        expect(visible).toContain('test/worker.ts');
    });

    it('switches to flat mode when the Flat toggle is clicked and shows dirname above basename', () => {
        render(<PrFilesPanel files={realDiff} />);
        fireEvent.click(screen.getByTestId('pr-file-view-flat'));
        // Folders disappear in flat mode.
        expect(screen.queryByTestId('pr-file-tree-folder')).toBeNull();
        // Each row shows the basename (no slash) inside `pr-file-basename`.
        const basenames = screen
            .getAllByTestId('pr-file-row')
            .map(row => row.querySelector('[data-testid="pr-file-basename"]')?.textContent);
        expect(basenames.sort()).toEqual(['foo.ts', 'readme.md', 'worker.ts']);
        // And the dirname is rendered as a separate muted line — every row
        // includes the trailing slash that the flat renderer adds.
        screen.getAllByTestId('pr-file-row').forEach(row => {
            expect(row.textContent ?? '').toMatch(/\//);
        });
    });
});

// suppress unused import warning when running through transformer
void vi;
