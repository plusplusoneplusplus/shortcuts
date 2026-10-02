/**
 * LlmToolApprovalCard — the chat-side face of the per-repo LLM tool approval
 * gate.
 *
 * When a repo marks a CoC tool as "Require approval", the gate holds the call
 * and asks through the ordinary `ask_user` channel with an `llm-tool`
 * `approval` block. This card shows which tool is asking and its arguments as
 * pretty-printed JSON, verbatim (no markdown). Long argument lists fold past
 * {@link FOLD_LINE_LIMIT} lines behind an expand toggle so the options stay in
 * view. One generic renderer covers every tool.
 *
 * Read-only. Answering happens through the normal option rows in
 * `AskUserInline`.
 */

import { useState } from 'react';

interface LlmToolApproval {
    kind: 'llm-tool';
    toolName: string;
    label: string;
    argsJson: string;
    argsTruncated: boolean;
}

export interface LlmToolApprovalCardProps {
    approval: LlmToolApproval;
}

/** Args longer than this many lines are folded until the user expands them. */
export const FOLD_LINE_LIMIT = 20;

const ARGS_CLASS =
    'mt-1 block max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded border border-sky-300/70 bg-white px-2 py-1 font-mono text-[12px] leading-5 text-[#1e1e1e] dark:border-sky-500/30 dark:bg-[#1e1e1e] dark:text-[#e0e0e0]';

const LABEL_CLASS = 'text-[11px] font-semibold uppercase tracking-wide text-sky-800/80 dark:text-sky-200/80';

export function LlmToolApprovalCard({ approval }: LlmToolApprovalCardProps) {
    const [expanded, setExpanded] = useState(false);
    const lines = approval.argsJson.split('\n');
    const foldable = lines.length > FOLD_LINE_LIMIT;
    const shown = foldable && !expanded ? lines.slice(0, FOLD_LINE_LIMIT).join('\n') : approval.argsJson;
    const hiddenCount = lines.length - FOLD_LINE_LIMIT;

    return (
        <div
            className="mt-1 rounded-md border border-sky-300 bg-sky-50/80 p-2 dark:border-sky-500/30 dark:bg-sky-500/10"
            data-testid="llm-tool-approval-card"
        >
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs">🛠️</span>
                <span className="text-[12px] font-semibold text-sky-900 dark:text-sky-100" data-testid="llm-tool-approval-label">
                    {approval.label}
                </span>
                <span
                    className="rounded-full bg-sky-200/70 px-2 py-0.5 font-mono text-[11px] font-medium text-sky-900 dark:bg-sky-500/20 dark:text-sky-100"
                    data-testid="llm-tool-approval-name-chip"
                >
                    {approval.toolName}
                </span>
                <span className="text-[11px] text-sky-900/70 dark:text-sky-100/70">requires approval in this repo</span>
            </div>
            <div className="mt-2">
                <span className={LABEL_CLASS}>Arguments</span>
                <pre className={ARGS_CLASS} data-testid="llm-tool-approval-args">{shown}</pre>
                {foldable && (
                    <button
                        type="button"
                        onClick={() => setExpanded(v => !v)}
                        className="mt-1 text-[11px] text-[#0078d4] hover:underline dark:text-[#3794ff]"
                        data-testid="llm-tool-approval-args-toggle"
                    >
                        {expanded ? 'Show less' : `Show ${hiddenCount} more line${hiddenCount === 1 ? '' : 's'}`}
                    </button>
                )}
                {approval.argsTruncated && (
                    <p className="mt-1 text-[11px] text-sky-900/70 dark:text-sky-100/70" data-testid="llm-tool-approval-args-truncated">
                        Arguments were too large to show in full and have been cut short.
                    </p>
                )}
            </div>
        </div>
    );
}
