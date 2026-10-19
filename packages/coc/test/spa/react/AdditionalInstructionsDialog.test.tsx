import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SENTINEL_ADDITIONAL_INSTRUCTIONS_MAX_CHARS } from '@plusplusoneplusplus/coc-client';
import {
    AdditionalInstructionsDialog,
    ADDITIONAL_INSTRUCTIONS_TIMING_COPY,
} from '../../../src/server/spa/client/react/features/chat/conversation/AdditionalInstructionsDialog';
import { ConversationMetadataPopover } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationMetadataPopover';

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ stats: { turnPerformance: async () => ({ groups: [] }) } }),
}));

function makeTarget(saved = 'Prefer short answers.') {
    let stored = saved;
    const getAdditionalInstructions = vi.fn(async () => ({ additionalInstructions: { text: stored } }));
    const updateAdditionalInstructions = vi.fn(async (_id: string, text: string) => {
        stored = text.trim();
        return { additionalInstructions: { text: stored } };
    });
    return {
        client: { processes: { getAdditionalInstructions, updateAdditionalInstructions } } as any,
        workspaceId: 'ws-owner',
        processId: 'proc-sentinel',
        getAdditionalInstructions,
        updateAdditionalInstructions,
    };
}

function renderDialog(target = makeTarget(), onClose = vi.fn()) {
    const { getAdditionalInstructions: _g, updateAdditionalInstructions: _u, ...props } = target;
    const view = render(<AdditionalInstructionsDialog {...props} open onClose={onClose} />);
    return { ...view, target, onClose };
}

const textarea = () => screen.getByRole('textbox', { name: 'Additional instructions' }) as HTMLTextAreaElement;

beforeEach(() => {
    vi.restoreAllMocks();
});

describe('AdditionalInstructionsDialog', () => {
    it('loads the saved text from the exact owner and shows the timing copy', async () => {
        const { target } = renderDialog();
        expect(screen.getByRole('status').textContent).toContain('Loading');
        await waitFor(() => expect(textarea().value).toBe('Prefer short answers.'));
        expect(target.getAdditionalInstructions).toHaveBeenCalledWith('proc-sentinel', { workspace: 'ws-owner' });
        expect(screen.getByText(ADDITIONAL_INSTRUCTIONS_TIMING_COPY)).toBeTruthy();
        expect(ADDITIONAL_INSTRUCTIONS_TIMING_COPY).toBe('Applies when initial context is built or after the next compression.');
    });

    it('saves multiline text and closes only after persistence succeeds', async () => {
        let resolveSave!: () => void;
        const target = makeTarget('');
        target.updateAdditionalInstructions.mockImplementationOnce(() => new Promise(resolve => {
            resolveSave = () => resolve({ additionalInstructions: { text: 'Line 1\nLine 2' } });
        }));
        const { onClose } = renderDialog(target);
        await waitFor(() => expect(textarea().disabled).toBe(false));
        fireEvent.change(textarea(), { target: { value: 'Line 1\nLine 2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy();
        expect(onClose).not.toHaveBeenCalled();
        resolveSave();
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(target.updateAdditionalInstructions).toHaveBeenCalledWith('proc-sentinel', 'Line 1\nLine 2', { workspace: 'ws-owner' });
    });

    it('saves empty text to clear the instructions', async () => {
        const { target, onClose } = renderDialog();
        await waitFor(() => expect(textarea().value).toBe('Prefer short answers.'));
        fireEvent.change(textarea(), { target: { value: '' } });
        expect(screen.getByText('Saving empty text clears the instructions.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(target.updateAdditionalInstructions).toHaveBeenCalledWith('proc-sentinel', '', { workspace: 'ws-owner' });
    });

    it('Cancel discards the draft and reopening reloads the saved text', async () => {
        const target = makeTarget();
        const onClose = vi.fn();
        const { getAdditionalInstructions: _g, updateAdditionalInstructions: _u, ...props } = target;
        const view = render(<AdditionalInstructionsDialog {...props} open onClose={onClose} />);
        await waitFor(() => expect(textarea().value).toBe('Prefer short answers.'));
        fireEvent.change(textarea(), { target: { value: 'Unsaved edit' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(target.updateAdditionalInstructions).not.toHaveBeenCalled();
        view.rerender(<AdditionalInstructionsDialog {...props} open={false} onClose={onClose} />);
        view.rerender(<AdditionalInstructionsDialog {...props} open onClose={onClose} />);
        await waitFor(() => expect(textarea().value).toBe('Prefer short answers.'));
        expect(target.getAdditionalInstructions).toHaveBeenCalledTimes(2);
    });

    it('Escape dismisses without saving', async () => {
        const { target, onClose } = renderDialog();
        await waitFor(() => expect(textarea().disabled).toBe(false));
        fireEvent.change(textarea(), { target: { value: 'Unsaved edit' } });
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
        expect(target.updateAdditionalInstructions).not.toHaveBeenCalled();
    });

    it('keeps the draft and shows the server error after a failed save', async () => {
        const target = makeTarget('');
        target.updateAdditionalInstructions.mockRejectedValueOnce(new Error('text exceeds 10000 characters'));
        const { onClose } = renderDialog(target);
        await waitFor(() => expect(textarea().disabled).toBe(false));
        fireEvent.change(textarea(), { target: { value: 'Keep me' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain('Could not save additional instructions.');
        expect(alert.textContent).toContain('text exceeds 10000 characters');
        expect(textarea().value).toBe('Keep me');
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('shows a retryable load error and blocks Save until loaded', async () => {
        const target = makeTarget('Loaded later');
        target.getAdditionalInstructions.mockRejectedValueOnce(new Error('offline'));
        renderDialog(target);
        expect((await screen.findByRole('alert')).textContent).toContain('Could not load additional instructions.');
        expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(textarea().value).toBe('Loaded later'));
        expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    });

    it('blocks Save past the shared character limit', async () => {
        renderDialog(makeTarget(''));
        await waitFor(() => expect(textarea().disabled).toBe(false));
        fireEvent.change(textarea(), { target: { value: 'x'.repeat(SENTINEL_ADDITIONAL_INSTRUCTIONS_MAX_CHARS + 1) } });
        expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    });
});

describe('ConversationMetadataPopover — Additional instructions action', () => {
    it('shows the action only when a Sentinel target is supplied and opens the editor', async () => {
        const target = makeTarget();
        const { getAdditionalInstructions: _g, updateAdditionalInstructions: _u, ...props } = target;
        render(<ConversationMetadataPopover process={{ id: 'proc-sentinel' }} additionalInstructionsTarget={props} />);
        expect(target.getAdditionalInstructions).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Show conversation metadata' }));
        fireEvent.click(screen.getByRole('button', { name: 'Additional instructions' }));
        expect(screen.queryByText('Conversation metadata')).toBeNull();
        expect(screen.getByRole('dialog', { name: 'Additional instructions' })).toBeTruthy();
        await waitFor(() => expect(textarea().value).toBe('Prefer short answers.'));
    });

    it('hides the action without a target', () => {
        render(<ConversationMetadataPopover process={{ id: 'proc-ask', metadata: { mode: 'ask' } }} />);
        fireEvent.click(screen.getByRole('button', { name: 'Show conversation metadata' }));
        expect(screen.queryByRole('button', { name: 'Additional instructions' })).toBeNull();
    });
});
