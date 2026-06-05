/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ForEachRun } from '@plusplusoneplusplus/coc-client';
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
        forEach: {
            create: mocks.create,
            updatePlan: mocks.updatePlan,
            approve: mocks.approve,
            start: mocks.start,
            continue: mocks.continueRun,
        },
        processes: {
            update: mocks.processUpdate,
        },
    }),
    getSpaCocClientErrorMessage: mocks.getErrorMessage,
}));

vi.mock('../../../../../src/server/spa/client/react/ui/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

import { ForEachPlanReviewCard, scanForEachPlans, type ForEachGenerationMetadata } from '../../../../../src/server/spa/client/react/features/chat/ForEachPlanReviewCard';

const generation: ForEachGenerationMetadata = {
    kind: 'generation',
    workspaceId: 'ws-1',
    generationId: 'for-each-gen-1',
    childMode: 'ask',
    originalRequest: 'Split this work',
    status: 'draft',
};

function makeRun(overrides: Partial<ForEachRun> = {}): ForEachRun {
    return {
        runId: 'for-each-run-1',
        workspaceId: 'ws-1',
        status: 'draft',
        originalRequest: 'Split this work',
        childMode: 'ask',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        items: [
            { id: 'item-1', title: 'First item', prompt: 'Do first', status: 'pending' },
            { id: 'item-2', title: 'Second item', prompt: 'Do second', dependsOn: ['item-1'], status: 'pending' },
        ],
        ...overrides,
    };
}

function assistantPlan(items = makeRun().items, turnIndex = 1): ClientConversationTurn {
    return {
        role: 'assistant',
        turnIndex,
        timeline: [],
        content: `Here is the proposed plan.\n\n\`\`\`json\n${JSON.stringify({ items }, null, 2)}\n\`\`\``,
    };
}

function renderCard(turns: ClientConversationTurn[] = [assistantPlan()], overrides: Partial<ForEachGenerationMetadata> = {}) {
    return render(
        <ForEachPlanReviewCard
            workspaceId="ws-1"
            processId="queue_gen-1"
            metadataProcess={{
                metadata: {
                    provider: 'copilot',
                    model: 'gpt-5.4',
                    forEach: { ...generation, ...overrides },
                },
            }}
            forEach={{ ...generation, ...overrides }}
            turns={turns}
            provider="copilot"
            model="gpt-5.4"
            reasoningEffort="medium"
            onApprovedRun={mocks.processUpdate}
        />,
    );
}

describe('ForEachPlanReviewCard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.create.mockResolvedValue(makeRun());
        mocks.updatePlan.mockResolvedValue(makeRun());
        mocks.approve.mockResolvedValue(makeRun({ status: 'approved', approvedAt: '2026-01-01T00:01:00.000Z' }));
        mocks.processUpdate.mockResolvedValue({ process: {} });
    });

    it('renders the latest valid generated plan as a structured editable card', async () => {
        renderCard();

        await waitFor(() => expect(screen.getByTestId('for-each-plan-review-card')).toBeTruthy());
        expect((screen.getByTestId('for-each-plan-item-title-0') as HTMLInputElement).value).toBe('First item');
        expect(screen.getByTestId('for-each-plan-validation-ok').textContent).toContain('ready for approval');

        fireEvent.change(screen.getByTestId('for-each-plan-item-title-0'), { target: { value: 'Edited first' } });
        fireEvent.change(screen.getByTestId('for-each-plan-item-prompt-0'), { target: { value: 'Edited prompt' } });
        fireEvent.click(screen.getByTestId('for-each-plan-add-item'));
        fireEvent.change(screen.getByTestId('for-each-plan-item-prompt-2'), { target: { value: 'Do the added item' } });
        fireEvent.click(screen.getByTestId('for-each-plan-item-up-2'));

        expect((screen.getByTestId('for-each-plan-item-title-0') as HTMLInputElement).value).toBe('Edited first');
        expect(screen.getByTestId('for-each-plan-dirty').textContent).toContain('Edited');
        expect(screen.getByTestId('for-each-plan-validation-ok').textContent).toContain('ready for approval');
    });

    it('keeps the previous valid plan when a later assistant turn has invalid Advanced JSON', () => {
        const invalidTurn: ClientConversationTurn = {
            role: 'assistant',
            turnIndex: 3,
            timeline: [],
            content: 'Refinement failed.\n\n```json\n{"items":[{"id":"item-3","title":"Missing prompt","status":"pending"}]}\n```',
        };

        renderCard([assistantPlan(makeRun().items, 1), invalidTurn]);

        expect(screen.getByTestId('for-each-plan-scan-error').textContent).toContain('Latest assistant output did not contain a valid item plan');
        expect((screen.getByTestId('for-each-plan-item-title-0') as HTMLInputElement).value).toBe('First item');
    });

    it('shows Advanced JSON errors inline and blocks approval', async () => {
        renderCard();
        await waitFor(() => expect(screen.getByTestId('for-each-plan-json-toggle')).toBeTruthy());

        fireEvent.click(screen.getByTestId('for-each-plan-json-toggle'));
        fireEvent.change(screen.getByTestId('for-each-plan-json'), { target: { value: '{not-json' } });

        expect(screen.getByTestId('for-each-plan-json-error').textContent).toContain('valid JSON');
        expect(screen.getByTestId('for-each-plan-approve-btn')).toBeDisabled();
        expect(mocks.create).not.toHaveBeenCalled();
        expect(mocks.approve).not.toHaveBeenCalled();
    });

    it('approves the reviewed plan without starting children and links generation metadata', async () => {
        const onApprovedRun = vi.fn();
        render(
            <ForEachPlanReviewCard
                workspaceId="ws-1"
                processId="queue_gen-1"
                metadataProcess={{
                    metadata: {
                        provider: 'copilot',
                        model: 'gpt-5.4',
                        forEach: generation,
                    },
                }}
                forEach={generation}
                turns={[assistantPlan()]}
                provider="copilot"
                model="gpt-5.4"
                reasoningEffort="medium"
                onApprovedRun={onApprovedRun}
            />,
        );

        await waitFor(() => expect(screen.getByTestId('for-each-plan-approve-btn')).toBeEnabled());
        fireEvent.click(screen.getByTestId('for-each-plan-approve-btn'));

        await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
        expect(mocks.create).toHaveBeenCalledWith('ws-1', expect.objectContaining({
            originalRequest: 'Split this work',
            childMode: 'ask',
            provider: 'copilot',
            config: { model: 'gpt-5.4', reasoningEffort: 'medium' },
            generationProcessId: 'queue_gen-1',
            generationId: 'for-each-gen-1',
        }));
        expect(mocks.approve).toHaveBeenCalledWith('ws-1', 'for-each-run-1');
        expect(mocks.start).not.toHaveBeenCalled();
        expect(mocks.continueRun).not.toHaveBeenCalled();
        expect(mocks.processUpdate).toHaveBeenCalledWith('queue_gen-1', expect.objectContaining({
            metadata: expect.objectContaining({
                forEach: expect.objectContaining({
                    status: 'approved',
                    runId: 'for-each-run-1',
                    latestItemCount: 2,
                    latestPlanTurnIndex: 1,
                }),
            }),
        }), { workspace: 'ws-1' });
        expect(onApprovedRun).toHaveBeenCalledWith('for-each-run-1');
    });

    it('scans the newest valid plan after a successful refinement', () => {
        const refined = [
            { id: 'item-1', title: 'Refined item', prompt: 'Do refined work', status: 'pending' as const },
        ];
        const result = scanForEachPlans([assistantPlan(makeRun().items, 1), assistantPlan(refined, 3)]);

        expect(result.error).toBeNull();
        expect(result.plan?.turnIndex).toBe(3);
        expect(result.plan?.items).toHaveLength(1);
        expect(result.plan?.items[0].title).toBe('Refined item');
    });
});
