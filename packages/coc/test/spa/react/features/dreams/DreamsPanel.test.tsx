import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DreamCard } from '@plusplusoneplusplus/coc-client';

const mocks = vi.hoisted(() => ({
    isDreamsEnabled: vi.fn(),
    getRepo: vi.fn(),
    patchRepo: vi.fn(),
    listCards: vi.fn(),
    runNow: vi.fn(),
    approve: vi.fn(),
    dismiss: vi.fn(),
    convert: vi.fn(),
    markSuperseded: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isDreamsEnabled: mocks.isDreamsEnabled,
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getRepo: mocks.getRepo,
            patchRepo: mocks.patchRepo,
        },
        dreams: {
            listCards: mocks.listCards,
            runNow: mocks.runNow,
            approve: mocks.approve,
            dismiss: mocks.dismiss,
            convert: mocks.convert,
            markSuperseded: mocks.markSuperseded,
        },
    }),
    getSpaCocClientErrorMessage: (error: unknown, fallback: string) =>
        error instanceof Error ? error.message : fallback,
}));

import { DreamsPanel } from '../../../../../src/server/spa/client/react/features/dreams/DreamsPanel';

const sampleCard: DreamCard = {
    id: 'dream-1',
    workspaceId: 'ws-1',
    runId: 'dream-run-1',
    category: 'product-improvement',
    status: 'visible',
    sourceRanges: [{ processId: 'queue_task-1', startTurnIndex: 1, endTurnIndex: 4 }],
    observedPattern: 'The user repeatedly asked for manual status checks during long-running coding loops.',
    whyItMatters: 'Manual polling interrupts the user and hides an opportunity for better automation.',
    recommendation: 'Add a dashboard reminder that suggests using loops for repeated status checks.',
    expectedImpact: 'Reduces repetitive user prompts during autonomous coding sessions.',
    confidence: 0.92,
    dedupFingerprint: 'dream:product-improvement:abc123',
    notAlreadyCoveredRationale: 'No active work item or prior dream covers this reminder.',
    criticRationale: 'Specific and backed by multiple completed conversations.',
    createdAt: '2026-06-10T08:00:00.000Z',
    updatedAt: '2026-06-10T08:01:00.000Z',
    visibleAt: '2026-06-10T08:01:00.000Z',
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDreamsEnabled.mockReturnValue(true);
    mocks.getRepo.mockResolvedValue({ dreams: { enabled: true } });
    mocks.patchRepo.mockResolvedValue({ dreams: { enabled: true } });
    mocks.listCards.mockResolvedValue([sampleCard]);
    mocks.runNow.mockResolvedValue({
        run: {
            id: 'dream-run-2',
            workspaceId: 'ws-1',
            trigger: 'manual',
            status: 'completed',
            sourceRanges: [],
            candidateCardIds: [],
            startedAt: '2026-06-10T08:02:00.000Z',
            completedAt: '2026-06-10T08:02:01.000Z',
        },
        cards: [],
        selection: {
            workspaceId: 'ws-1',
            conversationCount: 0,
            scannedProcessCount: 0,
            skipped: {
                wrongWorkspace: 0,
                nonCompleted: 0,
                archived: 0,
                missingProcess: 0,
                noVisibleTurns: 0,
                fullyCovered: 0,
            },
        },
        analysis: {
            sourceRanges: [],
            rawCandidateCount: 0,
            deterministicCandidateCount: 0,
            acceptedCandidateCount: 0,
            rejectedCandidateCount: 0,
        },
    });
    mocks.approve.mockResolvedValue({ ...sampleCard, status: 'approved', approvedAt: '2026-06-10T08:03:00.000Z' });
    mocks.dismiss.mockResolvedValue({ ...sampleCard, status: 'dismissed', dismissedAt: '2026-06-10T08:03:00.000Z' });
    mocks.convert.mockResolvedValue({
        ...sampleCard,
        status: 'converted',
        convertedAt: '2026-06-10T08:03:00.000Z',
        conversion: {
            artifactType: 'work-item',
            artifactId: 'WI-123',
            createdAt: '2026-06-10T08:03:00.000Z',
        },
    });
});

describe('DreamsPanel', () => {
    it('shows the disabled-by-flag state without calling Dreams routes', () => {
        mocks.isDreamsEnabled.mockReturnValue(false);

        render(<DreamsPanel workspaceId="ws-1" />);

        expect(screen.getByTestId('dreams-disabled-by-flag')).toBeTruthy();
        expect(mocks.getRepo).not.toHaveBeenCalled();
        expect(mocks.listCards).not.toHaveBeenCalled();
    });

    it('requires a workspace opt-in before listing cards', async () => {
        mocks.getRepo.mockResolvedValue({ dreams: { enabled: false } });
        mocks.listCards.mockResolvedValue([]);

        render(<DreamsPanel workspaceId="ws-1" />);

        await screen.findByTestId('dreams-workspace-disabled');
        expect(mocks.listCards).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('dreams-enable-workspace'));

        await waitFor(() => expect(mocks.patchRepo).toHaveBeenCalledWith('ws-1', { dreams: { enabled: true } }));
        await waitFor(() => expect(mocks.listCards).toHaveBeenCalledWith('ws-1', { statuses: ['visible'] }));
    });

    it('renders visible dream cards with source links and safe lifecycle actions', async () => {
        render(<DreamsPanel workspaceId="ws-1" />);

        await screen.findByTestId('dream-card-dream-1');
        expect(screen.getByText('Product')).toBeTruthy();
        expect(screen.getByText('92% confidence')).toBeTruthy();
        expect(screen.getByText(sampleCard.recommendation)).toBeTruthy();
        expect(screen.getByTestId('dream-source-link').getAttribute('href')).toBe('#repos/ws-1/activity/queue_task-1');

        mocks.listCards.mockResolvedValueOnce([]);
        fireEvent.click(screen.getByText('Approve'));

        await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith('ws-1', 'dream-1'));
    });

    it('runs a manual dream pass and shows the run summary', async () => {
        render(<DreamsPanel workspaceId="ws-1" />);

        await screen.findByTestId('dream-card-dream-1');
        fireEvent.click(screen.getByTestId('dreams-run-now'));

        await waitFor(() => expect(mocks.runNow).toHaveBeenCalledWith('ws-1'));
        expect(await screen.findByTestId('dreams-run-summary')).toBeTruthy();
        expect(screen.getByText('Accepted')).toBeTruthy();
    });

    it('records conversion links without creating external artifacts', async () => {
        render(<DreamsPanel workspaceId="ws-1" />);

        await screen.findByTestId('dream-card-dream-1');
        fireEvent.click(screen.getByTestId('dream-convert-dream-1'));

        fireEvent.change(screen.getByTestId('dream-convert-artifact-id'), { target: { value: 'WI-123' } });
        fireEvent.click(screen.getByTestId('dream-convert-submit'));

        await waitFor(() => expect(mocks.convert).toHaveBeenCalledWith('ws-1', 'dream-1', {
            artifactType: 'work-item',
            artifactId: 'WI-123',
        }));
    });
});

