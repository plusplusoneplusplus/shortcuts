/**
 * DangerousCommandApprovalCard — the chat-side face of the dangerous-command
 * guard.
 *
 * The guard holds a `Bash` call and asks the user through the ordinary
 * `ask_user` channel, tagging the question with an `approval` block. Without
 * this card the prompt still renders — as a three-option select whose question
 * text happens to contain the command — but the command runs together with the
 * prose and there is nothing to tell the user *why* it was stopped. This is the
 * one place the full command text is presented for a human to judge, so it is
 * shown verbatim in a monospace block: no markdown, no truncation, no
 * re-wrapping that could hide a trailing `; rm -rf /`.
 *
 * Read-only. Answering happens through the normal option rows in
 * `AskUserInline`, which is what keeps the answer on the existing
 * ask-user-response route.
 */

interface DangerousCommandApproval {
    kind: 'dangerous-command';
    command: string;
    ruleId: string;
    description: string;
    matchedSegment: string;
}

export interface DangerousCommandApprovalCardProps {
    approval: DangerousCommandApproval;
}

/** Verbatim command text: wraps rather than scrolls, so nothing hides off-screen. */
const COMMAND_CLASS =
    'mt-1 block whitespace-pre-wrap break-all rounded border border-amber-300/70 bg-white px-2 py-1 font-mono text-[12px] leading-5 text-[#1e1e1e] dark:border-amber-500/30 dark:bg-[#1e1e1e] dark:text-[#e0e0e0]';

const LABEL_CLASS = 'text-[11px] font-semibold uppercase tracking-wide text-amber-800/80 dark:text-amber-200/80';

export function DangerousCommandApprovalCard({ approval }: DangerousCommandApprovalCardProps) {
    // The matched segment is only worth its own row when the command is a
    // compound one — for a single-segment command it is the command again.
    const showSegment = approval.matchedSegment.trim() !== approval.command.trim();
    return (
        <div
            className="mt-1 rounded-md border border-amber-300 bg-amber-50/80 p-2 dark:border-amber-500/30 dark:bg-amber-500/10"
            data-testid="dangerous-command-approval-card"
        >
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs">⚠️</span>
                <span className="text-[12px] font-semibold text-amber-900 dark:text-amber-100">
                    Blocked by the dangerous-command guard
                </span>
                <span
                    className="rounded-full bg-amber-200/70 px-2 py-0.5 font-mono text-[11px] font-medium text-amber-900 dark:bg-amber-500/20 dark:text-amber-100"
                    data-testid="dangerous-command-rule-chip"
                >
                    {approval.ruleId}
                </span>
            </div>
            <p
                className="mt-1 text-[12px] leading-5 text-amber-900/90 dark:text-amber-100/85"
                data-testid="dangerous-command-rule-description"
            >
                {approval.description}
            </p>
            <div className="mt-2">
                <span className={LABEL_CLASS}>Command</span>
                <code className={COMMAND_CLASS} data-testid="dangerous-command-full-command">
                    {approval.command}
                </code>
            </div>
            {showSegment && (
                <div className="mt-2">
                    <span className={LABEL_CLASS}>Matched segment</span>
                    <code className={COMMAND_CLASS} data-testid="dangerous-command-matched-segment">
                        {approval.matchedSegment}
                    </code>
                </div>
            )}
        </div>
    );
}
