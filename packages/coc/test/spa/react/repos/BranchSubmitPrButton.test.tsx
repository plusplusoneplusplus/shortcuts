import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BranchSubmitPrButton, buildSubmitPrPrompt } from '../../../../src/server/spa/client/react/features/git/branches/BranchSubmitPrButton';

const chat = vi.hoisted(() => ({
    current: { send: vi.fn(), disabledReason: undefined as string | undefined, requiresAutopilotConfirmation: false },
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/currentChatSend', () => ({
    useCurrentChatSend: () => chat.current,
}));

const range = {
    baseRef: 'origin/main', headRef: 'HEAD', branchName: 'feature/x', mergeBase: 'merge0', baseSha: 'base1', headSha: 'head2',
    commitCount: 2, additions: 3, deletions: 1, fileCount: 2,
};

afterEach(() => {
    cleanup();
    chat.current = { send: vi.fn(), disabledReason: undefined, requiresAutopilotConfirmation: false };
});

describe('buildSubmitPrPrompt', () => {
    it('asks for create_pull_request on the exact resolved range with auto-fix on', () => {
        const prompt = buildSubmitPrPrompt('ws-a', range);
        expect(prompt).toContain('Repository workspace: ws-a');
        expect(prompt).toContain('`feature/x`');
        expect(prompt).toContain('commits ["base1..head2"] and autoFix: true');
    });

    it('falls back to the merge base and head ref when the range has no resolved SHAs', () => {
        const prompt = buildSubmitPrPrompt('ws-a', { ...range, baseSha: undefined, headSha: undefined, branchName: undefined });
        expect(prompt).toContain('commits ["merge0..HEAD"]');
        expect(prompt).toContain('`HEAD`');
    });
});

describe('BranchSubmitPrButton', () => {
    it('sends the submit prompt to the open chat without switching mode', async () => {
        chat.current.send.mockResolvedValue(undefined);
        render(<BranchSubmitPrButton workspaceId="ws-a" range={range} />);
        fireEvent.click(screen.getByTestId('branch-range-submit-pr-btn'));
        await waitFor(() => expect(screen.getByTestId('branch-range-submit-pr-btn').textContent).toBe('PR requested'));
        expect(chat.current.send).toHaveBeenCalledWith(buildSubmitPrPrompt('ws-a', range), false);
    });

    it('confirms before switching an Ask chat to Autopilot', async () => {
        chat.current.requiresAutopilotConfirmation = true;
        chat.current.send.mockResolvedValue(undefined);
        render(<BranchSubmitPrButton workspaceId="ws-a" range={range} />);
        fireEvent.click(screen.getByTestId('branch-range-submit-pr-btn'));
        expect(chat.current.send).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Switch to Autopilot and send' }));
        await waitFor(() => expect(chat.current.send).toHaveBeenCalledWith(expect.any(String), true));
    });

    it('is disabled with the chat reason or when there are no commits', () => {
        chat.current.disabledReason = 'Open a chat to send comments.';
        const view = render(<BranchSubmitPrButton workspaceId="ws-a" range={range} />);
        const button = screen.getByTestId('branch-range-submit-pr-btn') as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(button.title).toBe('Open a chat to send comments.');
        view.unmount();
        chat.current.disabledReason = undefined;
        render(<BranchSubmitPrButton workspaceId="ws-a" range={{ ...range, commitCount: 0 }} />);
        expect((screen.getByTestId('branch-range-submit-pr-btn') as HTMLButtonElement).title).toBe('No commits to submit.');
    });

    it('shows a send failure and allows a retry', async () => {
        chat.current.send.mockRejectedValueOnce(new Error('The open chat changed.'));
        render(<BranchSubmitPrButton workspaceId="ws-a" range={range} />);
        const button = screen.getByTestId('branch-range-submit-pr-btn') as HTMLButtonElement;
        fireEvent.click(button);
        await waitFor(() => expect(button.textContent).toBe('Submit PR failed'));
        expect(button.title).toBe('The open chat changed.');
        expect(button.disabled).toBe(false);
    });
});
