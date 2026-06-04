/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ForEachRun } from '@plusplusoneplusplus/coc-client';

const mocks = vi.hoisted(() => ({
    generate: vi.fn(),
    updatePlan: vi.fn(),
    approve: vi.fn(),
    getErrorMessage: vi.fn((err: unknown, fallback: string) => err instanceof Error ? err.message : fallback),
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        forEach: {
            generate: mocks.generate,
            updatePlan: mocks.updatePlan,
            approve: mocks.approve,
        },
    }),
    getSpaCocClientErrorMessage: mocks.getErrorMessage,
}));

import { ForEachLaunchDialog } from '../../../../../src/server/spa/client/react/shared/ForEachLaunchDialog';

function makeRun(overrides: Partial<ForEachRun> = {}): ForEachRun {
    return {
        runId: 'for-each-run-1',
        workspaceId: 'ws-1',
        status: 'draft',
        originalRequest: 'Split the work',
        sharedInstructions: 'Keep changes small',
        childMode: 'ask',
        provider: 'copilot',
        model: 'gpt-5.4',
        reasoningEffort: 'medium',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        items: [
            {
                id: 'item-1',
                title: 'First item',
                prompt: 'Do the first item',
                status: 'pending',
            },
            {
                id: 'item-2',
                title: 'Second item',
                prompt: 'Do the second item',
                dependsOn: ['item-1'],
                status: 'pending',
            },
        ],
        ...overrides,
    };
}

const defaultProps = {
    open: true,
    workspaceId: 'ws-1',
    request: 'Split the work',
    resolvedAiSelection: { provider: 'copilot' as const, model: 'gpt-5.4', reasoningEffort: 'medium' },
    onClose: vi.fn(),
    onApproved: vi.fn(),
};

describe('ForEachLaunchDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        defaultProps.onClose.mockClear();
        defaultProps.onApproved.mockClear();
        mocks.generate.mockResolvedValue(makeRun());
        mocks.updatePlan.mockResolvedValue(makeRun());
        mocks.approve.mockResolvedValue(makeRun({ status: 'approved', approvedAt: '2026-01-01T00:01:00.000Z' }));
    });

    it('renders nothing when closed', () => {
        const { container } = render(<ForEachLaunchDialog {...defaultProps} open={false} />);
        expect(container.innerHTML).toBe('');
    });

    it('generates a draft plan with request, shared instructions, child mode, and AI selection', async () => {
        render(<ForEachLaunchDialog {...defaultProps} />);

        fireEvent.change(screen.getByTestId('for-each-shared-instructions'), {
            target: { value: 'Use focused commits' },
        });
        fireEvent.click(screen.getByTestId('for-each-child-mode-autopilot'));
        fireEvent.click(screen.getByTestId('for-each-generate-btn'));

        await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
        expect(mocks.generate).toHaveBeenCalledWith('ws-1', {
            prompt: 'Split the work',
            sharedInstructions: 'Use focused commits',
            childMode: 'autopilot',
            provider: 'copilot',
            config: { model: 'gpt-5.4', reasoningEffort: 'medium' },
        });
        expect(screen.getByTestId('for-each-generated-items').textContent).toContain('First item');
        expect((screen.getByTestId('for-each-items-json') as HTMLTextAreaElement).value).toContain('"id": "item-1"');
    });

    it('updates the reviewed JSON plan and approves without starting children', async () => {
        render(<ForEachLaunchDialog {...defaultProps} />);
        fireEvent.click(screen.getByTestId('for-each-generate-btn'));
        await waitFor(() => expect(screen.getByTestId('for-each-items-json')).toBeTruthy());

        const editedItems = [
            {
                id: 'item-1',
                title: 'Edited item',
                prompt: 'Edited prompt',
                status: 'pending',
            },
        ];
        fireEvent.change(screen.getByTestId('for-each-items-json'), {
            target: { value: JSON.stringify(editedItems, null, 2) },
        });
        fireEvent.click(screen.getByTestId('for-each-approve-btn'));

        await waitFor(() => expect(defaultProps.onApproved).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' })));
        expect(mocks.updatePlan).toHaveBeenCalledWith('ws-1', 'for-each-run-1', {
            items: editedItems,
            sharedInstructions: 'Keep changes small',
            childMode: 'ask',
        });
        expect(mocks.approve).toHaveBeenCalledWith('ws-1', 'for-each-run-1');
    });

    it('surfaces invalid reviewed JSON before calling update or approve', async () => {
        render(<ForEachLaunchDialog {...defaultProps} />);
        fireEvent.click(screen.getByTestId('for-each-generate-btn'));
        await waitFor(() => expect(screen.getByTestId('for-each-items-json')).toBeTruthy());

        fireEvent.change(screen.getByTestId('for-each-items-json'), {
            target: { value: '{not-json' },
        });
        fireEvent.click(screen.getByTestId('for-each-approve-btn'));

        await waitFor(() => expect(screen.getByTestId('for-each-launch-error').textContent).toContain('valid JSON'));
        expect(mocks.updatePlan).not.toHaveBeenCalled();
        expect(mocks.approve).not.toHaveBeenCalled();
        expect(defaultProps.onApproved).not.toHaveBeenCalled();
    });

    it('blocks generation while file attachments are present', () => {
        render(<ForEachLaunchDialog {...defaultProps} attachmentCount={2} />);

        expect(screen.getByTestId('for-each-attachment-warning').textContent).toContain('Remove 2 file attachments');
        expect(screen.getByTestId('for-each-generate-btn')).toBeDisabled();
        expect(mocks.generate).not.toHaveBeenCalled();
    });
});
