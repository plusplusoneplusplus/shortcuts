/**
 * AC-06 (UI half): the Git Sync panel's account of the one-time initial merge.
 *
 * The engine already produces the report and serves it on SyncStatus; what these
 * pin is that a user who never reads a git log learns what the merge did — which
 * notes the AI combined, and which binaries it could not.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReconcileReport, SyncStatus } from '@plusplusoneplusplus/coc-client';

const mockClient = vi.hoisted(() => ({
    sync: {
        getStatus: vi.fn(),
        trigger: vi.fn(),
    },
    preferences: {
        getRepo: vi.fn(),
        patchRepo: vi.fn(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => mockClient,
    getSpaCocClientErrorMessage: (error: unknown, fallback: string) =>
        error instanceof Error ? error.message : fallback,
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    useGlobalToast: () => ({ addToast: vi.fn() }),
}));

import {
    SyncSettingsSection,
    reconcileSummaryText,
} from '../../../../src/server/spa/client/react/features/repo-settings/SyncSettingsSection';

/** The north-star demo's merge: A, B (AI-combined), C from here; D, E from the remote. */
const demoReport: ReconcileReport = {
    counts: { identical: 0, addedFromLocal: 2, keptFromRemote: 2, combined: 1, keptBothBinary: 0 },
    total: 5,
    combined: ['b.md'],
    flagged: [],
    backupTag: 'sync-backup/20260716T154000Z',
    mergedCommit: 'abc1234',
    reconciledAt: '2026-07-16T15:40:00.000Z',
};

function makeStatus(overrides: Partial<SyncStatus> = {}): SyncStatus {
    return {
        enabled: true,
        inProgress: false,
        lastSyncTime: '2026-07-16T15:40:00.000Z',
        lastError: null,
        reconcileInProgress: false,
        reconcileReport: null,
        ...overrides,
    };
}

async function renderPanel(status: SyncStatus) {
    mockClient.sync.getStatus.mockResolvedValue(status);
    mockClient.preferences.getRepo.mockResolvedValue({ sync: { gitRemote: 'git@example.com:me/notes.git', intervalMinutes: 5 } });
    render(<SyncSettingsSection workspaceId="ws-1" />);
    await waitFor(() => expect(screen.getByTestId('sync-status-pill')).toBeTruthy());
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('SyncSettingsSection — initial reconcile report', () => {
    it('tells the demo story in one sentence once the merge has run', async () => {
        await renderPanel(makeStatus({ reconcileReport: demoReport }));

        expect(screen.getByTestId('sync-reconcile-summary').textContent).toBe(
            'Merged 5 notes — 0 identical, 2 added from this device, 2 kept from remote, ' +
            '1 combined by AI (b.md). Review recommended.',
        );
    });

    it('names every AI-combined note, since a count alone is not reviewable', async () => {
        await renderPanel(makeStatus({
            reconcileReport: {
                ...demoReport,
                counts: { ...demoReport.counts, combined: 2 },
                combined: ['b.md', 'notes/deep/c.md'],
            },
        }));

        const text = screen.getByTestId('sync-reconcile-summary').textContent ?? '';
        expect(text).toContain('2 combined by AI (b.md, notes/deep/c.md)');
    });

    it('points at where a flagged binary local copy was parked', async () => {
        await renderPanel(makeStatus({
            reconcileReport: {
                ...demoReport,
                counts: { ...demoReport.counts, keptBothBinary: 1 },
                flagged: [{ path: 'img/logo.png', localVariantPath: 'img/logo.local.png' }],
            },
        }));

        const flagged = screen.getByTestId('sync-reconcile-flagged').textContent ?? '';
        expect(flagged).toContain('img/logo.png');
        expect(flagged).toContain('img/logo.local.png');
    });

    it('surfaces the backup tag, so the undo is discoverable without a git log', async () => {
        await renderPanel(makeStatus({ reconcileReport: demoReport }));

        expect(screen.getByTestId('sync-reconcile-backup').textContent).toContain('sync-backup/20260716T154000Z');
    });

    it('shows nothing about a first merge when none established this mirror', async () => {
        await renderPanel(makeStatus({ reconcileReport: null }));

        expect(screen.queryByTestId('sync-reconcile-report')).toBeNull();
        expect(screen.queryByTestId('sync-reconcile-progress')).toBeNull();
    });

    it('says it is merging rather than syncing, because the merge runs far longer', async () => {
        await renderPanel(makeStatus({ inProgress: true, reconcileInProgress: true }));

        expect(screen.getByTestId('sync-status-pill').textContent).toContain('Merging notes');
        expect(screen.getByTestId('sync-reconcile-progress').textContent).toContain('nothing is deleted');
    });

    it('reports the in-progress merge, not the stale report, when one heals an unrelated remote', async () => {
        // Both are true at once on the self-healing path: a marker (and its report)
        // already exist when the pull hits unrelated histories and re-merges.
        await renderPanel(makeStatus({ inProgress: true, reconcileInProgress: true, reconcileReport: demoReport }));

        expect(screen.getByTestId('sync-reconcile-progress')).toBeTruthy();
        expect(screen.queryByTestId('sync-reconcile-report')).toBeNull();
    });

    it('disables Sync Now while the merge is running', async () => {
        await renderPanel(makeStatus({ inProgress: true, reconcileInProgress: true }));

        expect((screen.getByTestId('btn-sync-trigger') as HTMLButtonElement).disabled).toBe(true);
    });
});

describe('reconcileSummaryText', () => {
    it('keeps zero counts rather than dropping the clause', () => {
        const text = reconcileSummaryText({
            ...demoReport,
            counts: { identical: 5, addedFromLocal: 0, keptFromRemote: 0, combined: 0, keptBothBinary: 0 },
            total: 5,
            combined: [],
        });
        expect(text).toContain('0 added from this device');
        expect(text).toContain('0 kept from remote');
    });

    it('does not recommend a review when the merge had nothing to resolve', () => {
        const text = reconcileSummaryText({
            ...demoReport,
            counts: { identical: 2, addedFromLocal: 3, keptFromRemote: 0, combined: 0, keptBothBinary: 0 },
            combined: [],
            flagged: [],
        });
        expect(text).not.toContain('Review recommended');
        expect(text).not.toContain('(');
    });

    it('recommends a review for a flagged binary even with nothing AI-combined', () => {
        const text = reconcileSummaryText({
            ...demoReport,
            counts: { identical: 0, addedFromLocal: 0, keptFromRemote: 0, combined: 0, keptBothBinary: 1 },
            total: 1,
            combined: [],
            flagged: [{ path: 'a.png', localVariantPath: 'a.local.png' }],
        });
        expect(text).toContain('Review recommended');
    });

    it('says "note" for a single note', () => {
        const text = reconcileSummaryText({
            ...demoReport,
            counts: { identical: 1, addedFromLocal: 0, keptFromRemote: 0, combined: 0, keptBothBinary: 0 },
            total: 1,
            combined: [],
        });
        expect(text).toContain('Merged 1 note —');
    });
});
