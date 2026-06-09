/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { ComponentProps } from 'react';

const mocks = vi.hoisted(() => ({
    applyAiDraft: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workItems: {
            applyAiDraft: mocks.applyAiDraft,
        },
    }),
    getSpaCocClientErrorMessage: (error: unknown, fallback: string) =>
        error instanceof Error ? error.message : fallback,
}));

import { WorkItemAiDraftApplyDialog } from '../../../../../src/server/spa/client/react/features/work-items/WorkItemAiDraftApplyDialog';

const BASE_ITEM = {
    id: 'wi-1',
    title: 'Title-only shell',
    updatedAt: '2026-01-01T00:00:00.000Z',
    currentContentVersion: undefined,
};

const UPDATED_ITEM = {
    id: 'wi-1',
    repoId: 'ws-1',
    title: 'Title-only shell',
    description: 'Generated description',
    status: 'planning',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
};

function renderDialog(props: Partial<ComponentProps<typeof WorkItemAiDraftApplyDialog>> = {}) {
    const onClose = vi.fn();
    const onApplied = vi.fn();
    render(
        <WorkItemAiDraftApplyDialog
            open={true}
            workspaceId="ws-1"
            item={BASE_ITEM}
            onClose={onClose}
            onApplied={onApplied}
            {...props}
        />,
    );
    return { onClose, onApplied };
}

describe('WorkItemAiDraftApplyDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it('auto-starts an AI draft apply with optimistic base metadata', async () => {
        mocks.applyAiDraft.mockResolvedValue({
            kind: 'applied',
            item: UPDATED_ITEM,
            plan: { version: 1, content: '## Plan', createdAt: '2026-01-01T00:00:01.000Z' },
            version: 1,
        });

        const { onApplied, onClose } = renderDialog();

        await waitFor(() => expect(onApplied).toHaveBeenCalledWith(UPDATED_ITEM));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mocks.applyAiDraft).toHaveBeenCalledTimes(1);
        const [workspaceId, workItemId, request, options] = mocks.applyAiDraft.mock.calls[0];
        expect(workspaceId).toBe('ws-1');
        expect(workItemId).toBe('wi-1');
        expect(request).toMatchObject({
            targets: ['fields', 'goal'],
            baseUpdatedAt: BASE_ITEM.updatedAt,
            baseContentVersion: null,
            summary: 'AI drafted implementation plan',
            reason: 'User requested AI draft',
        });
        expect(request.prompt).toMatch(/title-only Work Item/i);
        expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    it('continues after a clarification response and applies the answered draft', async () => {
        mocks.applyAiDraft
            .mockResolvedValueOnce({
                kind: 'clarification',
                questions: ['Who is the target user?'],
                clarificationCount: 0,
            })
            .mockResolvedValueOnce({
                kind: 'applied',
                item: UPDATED_ITEM,
                plan: { version: 1, content: '## Plan', createdAt: '2026-01-01T00:00:01.000Z' },
                version: 1,
            });

        const { onApplied } = renderDialog();

        await waitFor(() => expect(screen.getByTestId('wi-ai-draft-clarification')).toBeTruthy());
        fireEvent.change(screen.getByTestId('wi-ai-draft-answer-0'), { target: { value: 'Internal users' } });
        fireEvent.click(screen.getByTestId('wi-ai-draft-continue-btn'));

        await waitFor(() => expect(onApplied).toHaveBeenCalledWith(UPDATED_ITEM));
        expect(mocks.applyAiDraft).toHaveBeenCalledTimes(2);
        expect(mocks.applyAiDraft.mock.calls[1][2]).toMatchObject({
            clarificationAnswers: ['Internal users'],
            clarificationCount: 1,
        });
    });

    it('aborts the in-flight request when cancel is clicked', async () => {
        mocks.applyAiDraft.mockReturnValue(new Promise(() => {}));
        const { onClose } = renderDialog();

        await waitFor(() => expect(screen.getByTestId('wi-ai-draft-progress')).toBeTruthy());
        const signal = mocks.applyAiDraft.mock.calls[0][3].signal as AbortSignal;
        expect(signal.aborted).toBe(false);

        fireEvent.click(screen.getByTestId('wi-ai-draft-cancel-btn'));

        expect(signal.aborted).toBe(true);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('shows a failure state and retries the same draft action', async () => {
        mocks.applyAiDraft
            .mockRejectedValueOnce(new Error('LLM unavailable'))
            .mockResolvedValueOnce({
                kind: 'applied',
                item: UPDATED_ITEM,
                plan: { version: 1, content: '## Plan', createdAt: '2026-01-01T00:00:01.000Z' },
                version: 1,
            });

        const { onApplied } = renderDialog();

        await waitFor(() => expect(screen.getByTestId('wi-ai-draft-error').textContent).toContain('LLM unavailable'));
        fireEvent.click(screen.getByTestId('wi-ai-draft-retry-btn'));

        await waitFor(() => expect(onApplied).toHaveBeenCalledWith(UPDATED_ITEM));
        expect(mocks.applyAiDraft).toHaveBeenCalledTimes(2);
    });
});
