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
    getMockAiSummary,
    getMockCheckRows,
    getMockCommitRows,
    getMockFiles,
    getMockMergeReadiness,
    getMockPersonaLenses,
    getMockThreadGroups,
    getMockTimeline,
} from '../../../../../src/server/spa/client/react/features/pull-requests/pr-mock-data';
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
    it('renders one row per thread group with a blocking pill', () => {
        render(<PrAiGroupedThreads groups={getMockThreadGroups()} />);
        expect(screen.getAllByTestId('pr-ai-thread-group').length).toBeGreaterThanOrEqual(4);
        // At least one element mentions "blocking" — header pill or severity tag
        expect(screen.getAllByText(/blocking/i).length).toBeGreaterThan(0);
    });
});

describe('PrCommitTable', () => {
    it('renders one row per commit', () => {
        render(<PrCommitTable rows={getMockCommitRows()} />);
        expect(screen.getAllByTestId('pr-commit-row').length).toBeGreaterThanOrEqual(5);
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
    it('renders a row per file and shows AI annotations', () => {
        render(<PrFilesPanel files={getMockFiles()} />);
        const rows = screen.getAllByTestId('pr-file-row');
        expect(rows.length).toBeGreaterThanOrEqual(5);
        expect(screen.getAllByTestId('pr-file-diff-card').length).toBeGreaterThan(0);
    });

    it('filters files by the search input', () => {
        render(<PrFilesPanel files={getMockFiles()} />);
        const search = screen.getByTestId('pr-file-search') as HTMLInputElement;
        fireEvent.change(search, { target: { value: 'docs/' } });
        const rows = screen.getAllByTestId('pr-file-row');
        rows.forEach(row => {
            expect(row.textContent?.toLowerCase()).toContain('docs/');
        });
    });

    it('changes the active file when a row is clicked', () => {
        render(<PrFilesPanel files={getMockFiles()} />);
        const rows = screen.getAllByTestId('pr-file-row');
        const target = rows.find(row => row.textContent?.includes('worker.ts'));
        expect(target).toBeTruthy();
        fireEvent.click(target!);
        expect(target!.className).toMatch(/bg-blue-100|bg-blue-900/);
    });
});

// suppress unused import warning when running through transformer
void vi;
