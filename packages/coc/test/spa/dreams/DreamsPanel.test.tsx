import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DreamCard, PerRepoPreferences } from '@plusplusoneplusplus/coc-client';
import { DreamsPanel } from '../../../src/server/spa/client/react/features/dreams/DreamsPanel';

const mockGetRepo = vi.fn<[], Promise<PerRepoPreferences>>();
const mockPatchRepo = vi.fn();
const mockListCards = vi.fn<[], Promise<DreamCard[]>>();
const mockRunNow = vi.fn();
const mockApprove = vi.fn();
const mockDismiss = vi.fn();
const mockConvert = vi.fn();
const mockMarkSuperseded = vi.fn();

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    isDreamsEnabled: () => true,
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getRepo: mockGetRepo,
            patchRepo: mockPatchRepo,
        },
        dreams: {
            listCards: mockListCards,
            runNow: mockRunNow,
            approve: mockApprove,
            dismiss: mockDismiss,
            convert: mockConvert,
            markSuperseded: mockMarkSuperseded,
        },
    }),
    getSpaCocClientErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
}));

function makeDreamCard(overrides: Partial<DreamCard> = {}): DreamCard {
    return {
        id: 'dream-1',
        workspaceId: 'ws-1',
        runId: 'run-1',
        category: 'user-workflow-suggestion',
        status: 'visible',
        sourceRanges: [
            { processId: 'proc-one', startTurnIndex: 1, endTurnIndex: 3 },
            { processId: 'proc-two', startTurnIndex: 4, endTurnIndex: 4 },
        ],
        observedPattern: 'Users repeatedly ask for the same release checklist after every build.',
        whyItMatters: 'Repeated checklist reconstruction wastes review time and causes missed steps.',
        recommendation: 'Save a reusable release checklist note that can be linked from future build chats.',
        expectedImpact: 'Future release reviews start from a complete checklist instead of recreating one.',
        confidence: 0.91,
        dedupFingerprint: 'workflow-release-checklist',
        notAlreadyCoveredRationale: 'No existing note, work item, or memory captures this checklist.',
        criticRationale: 'The source conversations show a stable repeated workflow.',
        createdAt: '2026-06-10T12:00:00.000Z',
        updatedAt: '2026-06-11T12:00:00.000Z',
        visibleAt: '2026-06-11T12:00:00.000Z',
        ...overrides,
    };
}

async function renderDreamsPanel(cards: DreamCard[]) {
    mockGetRepo.mockResolvedValue({ dreams: { enabled: true } } as PerRepoPreferences);
    mockListCards.mockResolvedValue(cards);

    render(<DreamsPanel workspaceId="ws-1" />);

    await waitFor(() => expect(mockListCards).toHaveBeenCalled());
}

describe('DreamsPanel cards', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('explains visible cards with plain-language recommendation, guidance, and source labels', async () => {
        const card = makeDreamCard();
        await renderDreamsPanel([card]);

        const renderedCard = await screen.findByTestId(`dream-card-${card.id}`);
        expect(renderedCard).toHaveAccessibleName('Dream card dream-1: Needs review');
        expect(renderedCard).toHaveTextContent('Captures a repeatable workflow worth saving.');
        expect(renderedCard).toHaveTextContent('What CoC noticed');
        expect(renderedCard).toHaveTextContent(card.observedPattern);
        expect(renderedCard).toHaveTextContent('Coverage check');

        const recommendation = within(renderedCard).getByTestId(`dream-recommendation-${card.id}`);
        expect(recommendation).toHaveTextContent('Recommended next step');
        expect(recommendation).toHaveTextContent(card.recommendation);

        expect(within(renderedCard).getByTestId(`dream-review-guidance-${card.id}`))
            .toHaveTextContent('Approve this idea to unlock next actions');
        expect(within(renderedCard).getByTestId(`dream-source-summary-${card.id}`))
            .toHaveTextContent('Evidence from 2 source ranges across 2 conversations.');

        const sourceLinks = within(renderedCard).getAllByTestId('dream-source-link');
        expect(sourceLinks).toHaveLength(2);
        expect(sourceLinks[0]).toHaveTextContent('Open source 1: turns 1-3');
        expect(sourceLinks[0]).toHaveAttribute('href', '#repos/ws-1/activity/proc-one');
        expect(sourceLinks[0]).toHaveAttribute('title', 'proc-one turns 1-3');
        expect(sourceLinks[1]).toHaveTextContent('Open source 2: turn 4');
    });

    it('shows approved product cards as backlog-ready next actions', async () => {
        const card = makeDreamCard({
            id: 'dream-product',
            category: 'product-improvement',
            status: 'approved',
            recommendation: 'Create a backlog item for an explicit Dreams onboarding explainer.',
            approvedAt: '2026-06-11T12:30:00.000Z',
        });
        await renderDreamsPanel([card]);

        const renderedCard = await screen.findByTestId(`dream-card-${card.id}`);
        expect(renderedCard).toHaveAccessibleName('Dream card dream-product: Approved');
        expect(renderedCard).toHaveTextContent('Suggests a product or backlog change.');
        expect(within(renderedCard).getByTestId(`dream-review-guidance-${card.id}`))
            .toHaveTextContent('Create or update a work item when you are ready to turn this into backlog work.');
        expect(within(renderedCard).getByRole('button', { name: 'Take next action' })).toBeEnabled();
        expect(within(renderedCard).getByRole('button', { name: 'Record conversion' })).toBeEnabled();
    });

    it('keeps converted cards understandable as traceable history', async () => {
        const card = makeDreamCard({
            id: 'dream-converted',
            status: 'converted',
            conversion: {
                artifactType: 'work-item',
                artifactId: 'WI-42',
                createdAt: '2026-06-11T13:00:00.000Z',
            },
            convertedAt: '2026-06-11T13:00:00.000Z',
        });
        await renderDreamsPanel([card]);

        const renderedCard = await screen.findByTestId(`dream-card-${card.id}`);
        expect(renderedCard).toHaveAccessibleName('Dream card dream-converted: Converted');
        expect(within(renderedCard).getByTestId(`dream-review-guidance-${card.id}`))
            .toHaveTextContent('linked to a concrete artifact');
        expect(renderedCard).toHaveTextContent('Conversion recorded: Work item WI-42');
        expect(within(renderedCard).queryByRole('button', { name: 'Take next action' })).toBeNull();
        expect(within(renderedCard).queryByRole('button', { name: 'Record conversion' })).toBeNull();
    });

    it('states when a card has no attached source evidence', async () => {
        const card = makeDreamCard({
            id: 'dream-no-source',
            sourceRanges: [],
        });
        await renderDreamsPanel([card]);

        const renderedCard = await screen.findByTestId(`dream-card-${card.id}`);
        expect(within(renderedCard).getByTestId(`dream-source-summary-${card.id}`))
            .toHaveTextContent('No source ranges are attached to this card.');
        expect(within(renderedCard).getByTestId(`dream-no-source-evidence-${card.id}`))
            .toHaveTextContent('No source evidence attached.');
        expect(within(renderedCard).queryByTestId('dream-source-link')).toBeNull();
    });
});
