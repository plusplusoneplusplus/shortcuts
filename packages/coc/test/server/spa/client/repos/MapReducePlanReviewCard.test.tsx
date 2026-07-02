/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MapReduceRun } from '@plusplusoneplusplus/coc-client';
import type { ClientConversationTurn } from '../../../../../src/server/spa/client/react/types/dashboard';

const mocks = vi.hoisted(() => ({
    create: vi.fn(),
    updatePlan: vi.fn(),
    approve: vi.fn(),
    start: vi.fn(),
    continueRun: vi.fn(),
    processUpdate: vi.fn(),
    getErrorMessage: vi.fn((err: unknown, fallback: string) => err instanceof Error ? err.message : fallback),
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        mapReduce: {
            create: mocks.create,
            updatePlan: mocks.updatePlan,
            approve: mocks.approve,
            start: mocks.start,
            continue: mocks.continueRun,
        },
        processes: {
            patchMetadata: mocks.processUpdate,
        },
    }),
    getSpaCocClientErrorMessage: mocks.getErrorMessage,
}));

vi.mock('../../../../../src/server/spa/client/react/ui/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

import { MapReducePlanReviewCard, scanMapReducePlans, type MapReduceGenerationMetadata } from '../../../../../src/server/spa/client/react/features/chat/MapReducePlanReviewCard';

const generation: MapReduceGenerationMetadata = {
    kind: 'generation',
    workspaceId: 'ws-1',
    generationId: 'map-reduce-gen-1',
    childMode: 'ask',
    originalRequest: 'Fan out this work',
    status: 'draft',
};

function makeRun(overrides: Partial<MapReduceRun> = {}): MapReduceRun {
    return {
        runId: 'map-reduce-run-1',
        workspaceId: 'ws-1',
        status: 'draft',
        originalRequest: 'Fan out this work',
        reduceInstructions: 'Merge everything',
        maxParallel: 2,
        childMode: 'ask',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        reduceStep: { status: 'pending' },
        items: [
            { id: 'item-1', title: 'First item', prompt: 'Do first', status: 'pending' },
            { id: 'item-2', title: 'Second item', prompt: 'Do second', dependsOn: ['item-1'], status: 'pending' },
        ],
        ...overrides,
    } as MapReduceRun;
}

function planJson(items = makeRun().items) {
    return { items, reduceInstructions: 'Merge everything', maxParallel: 2 };
}

function assistantPlan(items = makeRun().items, turnIndex = 1): ClientConversationTurn {
    return {
        role: 'assistant',
        turnIndex,
        timeline: [],
        content: `Here is the proposed plan.\n\n\`\`\`json\n${JSON.stringify(planJson(items), null, 2)}\n\`\`\``,
    };
}

function renderCard(turns: ClientConversationTurn[] = [assistantPlan()], overrides: Partial<MapReduceGenerationMetadata> = {}) {
    return render(
        <MapReducePlanReviewCard
            workspaceId="ws-1"
            processId="queue_gen-1"
            metadataProcess={{
                metadata: {
                    provider: 'copilot',
                    model: 'gpt-5.4',
                    mapReduce: { ...generation, ...overrides },
                },
            }}
            mapReduce={{ ...generation, ...overrides }}
            turns={turns}
            provider="copilot"
            model="gpt-5.4"
            reasoningEffort="medium"
            onApprovedRun={mocks.processUpdate}
        />,
    );
}

describe('MapReducePlanReviewCard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.create.mockResolvedValue(makeRun());
        mocks.updatePlan.mockResolvedValue(makeRun());
        mocks.approve.mockResolvedValue(makeRun({ status: 'approved', approvedAt: '2026-01-01T00:01:00.000Z' }));
        mocks.processUpdate.mockResolvedValue({ process: {} });
    });

    it('renders the latest valid generated plan with reduce fields as an editable card', async () => {
        renderCard();

        await waitFor(() => expect(screen.getByTestId('map-reduce-plan-review-card')).toBeTruthy());
        expect((screen.getByTestId('map-reduce-plan-item-title-0') as HTMLInputElement).value).toBe('First item');
        expect((screen.getByTestId('map-reduce-reduce-instructions-editor') as HTMLTextAreaElement).value).toBe('Merge everything');
        expect((screen.getByTestId('map-reduce-max-parallel-editor') as HTMLInputElement).value).toBe('2');
        expect(screen.getByTestId('map-reduce-plan-max-parallel-pill').textContent).toContain('max 2 parallel');
        expect(screen.getByTestId('map-reduce-plan-validation-ok').textContent).toContain('ready for approval');

        fireEvent.change(screen.getByTestId('map-reduce-plan-item-title-0'), { target: { value: 'Edited first' } });
        fireEvent.click(screen.getByTestId('map-reduce-plan-add-item'));
        fireEvent.change(screen.getByTestId('map-reduce-plan-item-prompt-2'), { target: { value: 'Do the added item' } });

        expect((screen.getByTestId('map-reduce-plan-item-title-0') as HTMLInputElement).value).toBe('Edited first');
        expect(screen.getByTestId('map-reduce-plan-dirty').textContent).toContain('Edited');
        expect(screen.getByTestId('map-reduce-plan-validation-ok').textContent).toContain('ready for approval');
    });

    it('keeps the previous valid plan when a later assistant turn has invalid JSON', () => {
        const invalidTurn: ClientConversationTurn = {
            role: 'assistant',
            turnIndex: 3,
            timeline: [],
            content: 'Refinement failed.\n\n```json\n{"items":[{"id":"item-3","title":"Missing prompt","status":"pending"}]}\n```',
        };

        renderCard([assistantPlan(makeRun().items, 1), invalidTurn]);

        expect(screen.getByTestId('map-reduce-plan-scan-error').textContent).toContain('Latest assistant output did not contain a valid Map Reduce plan');
        expect((screen.getByTestId('map-reduce-plan-item-title-0') as HTMLInputElement).value).toBe('First item');
    });

    it('renders a persisted latest plan from metadata when the transcript has no parseable JSON', () => {
        renderCard([
            { role: 'assistant', turnIndex: 1, timeline: [], content: 'Readable summary without JSON.' },
        ], {
            latestItemCount: 2,
            latestPlanTurnIndex: 1,
            latestPlan: {
                turnIndex: 1,
                childMode: 'ask',
                items: makeRun().items,
                reduceInstructions: 'Merge everything',
                maxParallel: 2,
                rawJson: JSON.stringify(planJson()),
            },
        });

        expect(screen.getByTestId('map-reduce-plan-review-card')).toBeTruthy();
        expect((screen.getByTestId('map-reduce-plan-item-title-0') as HTMLInputElement).value).toBe('First item');
        expect(screen.queryByTestId('map-reduce-plan-scan-error')).toBeNull();
    });

    it('blocks approval when reduce instructions are cleared', async () => {
        renderCard();
        await waitFor(() => expect(screen.getByTestId('map-reduce-plan-approve-btn')).toBeEnabled());

        fireEvent.change(screen.getByTestId('map-reduce-reduce-instructions-editor'), { target: { value: '   ' } });

        expect(screen.getByTestId('map-reduce-plan-validation-error')).toBeTruthy();
        expect(screen.getByTestId('map-reduce-plan-approve-btn')).toBeDisabled();
        expect(mocks.create).not.toHaveBeenCalled();

        fireEvent.change(screen.getByTestId('map-reduce-reduce-instructions-editor'), { target: { value: 'Merge again' } });
        expect(screen.getByTestId('map-reduce-plan-validation-ok').textContent).toContain('ready for approval');
    });

    it('shows Advanced JSON errors inline and blocks approval', async () => {
        renderCard();
        await waitFor(() => expect(screen.getByTestId('map-reduce-plan-json-toggle')).toBeTruthy());

        fireEvent.click(screen.getByTestId('map-reduce-plan-json-toggle'));
        fireEvent.change(screen.getByTestId('map-reduce-plan-json'), { target: { value: '{not-json' } });

        expect(screen.getByTestId('map-reduce-plan-json-error').textContent).toContain('valid JSON');
        expect(screen.getByTestId('map-reduce-plan-approve-btn')).toBeDisabled();
        expect(mocks.create).not.toHaveBeenCalled();
        expect(mocks.approve).not.toHaveBeenCalled();
    });

    it('applies valid Advanced JSON edits back to the structured editor', async () => {
        renderCard();
        await waitFor(() => expect(screen.getByTestId('map-reduce-plan-json-toggle')).toBeTruthy());

        fireEvent.click(screen.getByTestId('map-reduce-plan-json-toggle'));
        fireEvent.change(screen.getByTestId('map-reduce-plan-json'), {
            target: {
                value: JSON.stringify({
                    childMode: 'autopilot',
                    sharedInstructions: 'Run these in order.',
                    maxParallel: 4,
                    reduceInstructions: 'Combine outputs',
                    items: [
                        { id: 'json-item', title: 'JSON item', prompt: 'Do JSON work', status: 'pending' },
                    ],
                }, null, 2),
            },
        });

        expect(screen.queryByTestId('map-reduce-plan-json-error')).toBeNull();
        expect((screen.getByTestId('map-reduce-plan-item-title-0') as HTMLInputElement).value).toBe('JSON item');
        expect((screen.getByTestId('map-reduce-shared-instructions-editor') as HTMLTextAreaElement).value).toBe('Run these in order.');
        expect((screen.getByTestId('map-reduce-max-parallel-editor') as HTMLInputElement).value).toBe('4');
        expect((screen.getByTestId('map-reduce-reduce-instructions-editor') as HTMLTextAreaElement).value).toBe('Combine outputs');
        expect(screen.getByTestId('map-reduce-plan-validation-ok').textContent).toContain('ready for approval');
    });

    it('approves the reviewed plan with reduce fields and links generation metadata', async () => {
        const onApprovedRun = vi.fn();
        render(
            <MapReducePlanReviewCard
                workspaceId="ws-1"
                processId="queue_gen-1"
                metadataProcess={{
                    metadata: {
                        provider: 'copilot',
                        model: 'gpt-5.4',
                        mapReduce: generation,
                    },
                }}
                mapReduce={generation}
                turns={[assistantPlan()]}
                provider="copilot"
                model="gpt-5.4"
                reasoningEffort="medium"
                onApprovedRun={onApprovedRun}
            />,
        );

        await waitFor(() => expect(screen.getByTestId('map-reduce-plan-approve-btn')).toBeEnabled());
        fireEvent.change(screen.getByTestId('map-reduce-max-parallel-editor'), { target: { value: '5' } });
        fireEvent.click(screen.getByTestId('map-reduce-plan-child-mode-autopilot'));
        fireEvent.click(screen.getByTestId('map-reduce-plan-approve-btn'));

        await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
        expect(mocks.create).toHaveBeenCalledWith('ws-1', expect.objectContaining({
            originalRequest: 'Fan out this work',
            childMode: 'autopilot',
            reduceInstructions: 'Merge everything',
            maxParallel: 5,
            provider: 'copilot',
            config: { model: 'gpt-5.4', reasoningEffort: 'medium' },
            generationProcessId: 'queue_gen-1',
            generationId: 'map-reduce-gen-1',
        }));
        expect(mocks.approve).toHaveBeenCalledWith('ws-1', 'map-reduce-run-1');
        expect(mocks.start).not.toHaveBeenCalled();
        expect(mocks.continueRun).not.toHaveBeenCalled();
        expect(mocks.processUpdate).toHaveBeenCalledWith('queue_gen-1', {
            set: expect.objectContaining({
                mapReduce: expect.objectContaining({
                    status: 'approved',
                    runId: 'map-reduce-run-1',
                    latestItemCount: 2,
                    latestPlanTurnIndex: 1,
                }),
            }),
        }, { workspace: 'ws-1' });
        expect(onApprovedRun).toHaveBeenCalledWith('map-reduce-run-1');
    });

    it('updates the existing run plan when the generation already has a run id', async () => {
        renderCard([assistantPlan()], { runId: 'map-reduce-run-1' });

        await waitFor(() => expect(screen.getByTestId('map-reduce-plan-approve-btn')).toBeEnabled());
        fireEvent.click(screen.getByTestId('map-reduce-plan-approve-btn'));

        await waitFor(() => expect(mocks.updatePlan).toHaveBeenCalledOnce());
        expect(mocks.updatePlan).toHaveBeenCalledWith('ws-1', 'map-reduce-run-1', expect.objectContaining({
            reduceInstructions: 'Merge everything',
            maxParallel: 2,
        }));
        expect(mocks.create).not.toHaveBeenCalled();
        expect(mocks.approve).toHaveBeenCalledWith('ws-1', 'map-reduce-run-1');
    });

    it('scans the newest valid plan after a successful refinement', () => {
        const refined = [
            { id: 'item-1', title: 'Refined item', prompt: 'Do refined work', status: 'pending' as const },
        ];
        const result = scanMapReducePlans([assistantPlan(makeRun().items, 1), assistantPlan(refined, 3)]);

        expect(result.error).toBeNull();
        expect(result.plan?.turnIndex).toBe(3);
        expect(result.plan?.items).toHaveLength(1);
        expect(result.plan?.items[0].title).toBe('Refined item');
    });
});
