/**
 * BranchSubmitPrButton — asks the open chat to submit the branch range's
 * commits as a pull request with Auto-fix CI & conflicts turned on.
 *
 * The PR is created by the chat's `create_pull_request` tool, so the chat
 * owns the PR and its auto-fix monitor. That tool is offered only to
 * write-capable turns: an Ask chat is switched to Autopilot after the user
 * confirms, the same way review comments are sent.
 */

import { useRef, useState } from 'react';
import { Button, Dialog } from '../../../ui';
import { useCurrentChatSend } from '../../repo-detail/unified-right-panel/currentChatSend';
import type { BranchRangeInfo } from './BranchChanges';

/** The chat prompt that submits `range` as an auto-fixed PR. */
export function buildSubmitPrPrompt(workspaceId: string, range: BranchRangeInfo): string {
    const base = range.baseSha ?? range.mergeBase;
    const head = range.headSha ?? range.headRef;
    const branch = range.branchName || range.headRef;
    return [
        `Repository workspace: ${workspaceId}`,
        '',
        `Submit the ${range.commitCount} commit(s) on \`${branch}\` (compared with \`${range.baseRef}\`) as a pull request.`,
        `Call create_pull_request with commits ["${base}..${head}"] and autoFix: true.`,
        'Write a clear title and body from the commits. If the cherry-pick conflicts, report the conflict and stop.',
    ].join('\n');
}

export function BranchSubmitPrButton({ workspaceId, range }: { workspaceId: string; range: BranchRangeInfo }) {
    const chat = useCurrentChatSend();
    const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
    const [error, setError] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);
    const pending = useRef(false);
    const reason = range.commitCount === 0 ? 'No commits to submit.' : chat.disabledReason;

    const send = async (switchToAutopilot: boolean) => {
        if (pending.current || reason) return;
        pending.current = true;
        setState('sending');
        setError(null);
        try {
            await chat.send(buildSubmitPrPrompt(workspaceId, range), switchToAutopilot);
            setState('sent');
        } catch (err) {
            setState('idle');
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            pending.current = false;
        }
    };

    return <>
        <button
            type="button"
            className="min-h-7 px-1 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!!reason || state === 'sending' || confirming}
            title={error ?? reason ?? (state === 'sent' ? 'Sent to the open chat.' : 'Ask the open chat to submit these commits as a PR with auto-fix on')}
            aria-busy={state === 'sending'}
            onClick={() => {
                if (chat.requiresAutopilotConfirmation) setConfirming(true);
                else void send(false);
            }}
            data-testid="branch-range-submit-pr-btn"
        >
            {state === 'sending' ? 'Submitting…' : state === 'sent' ? 'PR requested' : error ? 'Submit PR failed' : 'Submit PR'}
        </button>
        <Dialog
            open={confirming}
            title="Switch to Autopilot to submit a PR?"
            onClose={() => setConfirming(false)}
            trapFocus
            dense
            footer={<>
                <Button variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>
                <Button variant="primary" disabled={!!reason} onClick={() => {
                    setConfirming(false);
                    void send(true);
                }}>Switch to Autopilot and send</Button>
            </>}
        >
            <p>This chat is in Ask mode. Creating a pull request needs Autopilot. Switch this chat to Autopilot and send the request?</p>
        </Dialog>
    </>;
}
