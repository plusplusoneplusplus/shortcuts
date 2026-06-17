import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { formatDuration } from '../../../utils/format';
import { isQueueProcessId, toTaskId } from '../../../utils/queue-process-id';
import { useBreakpoint } from '../../../hooks/ui/useBreakpoint';
import { BottomSheet } from '../../../ui/BottomSheet';
import { Dialog } from '../../../ui/Dialog';
import { getRalphContext } from '../../../../../../tasks/task-types';
import type { ClientTokenUsage } from '../../../types/dashboard';

const RALPH_FIELD_TRUNCATE = 200;

interface ClientConversationCostEstimate {
    actualUsdCost?: number;
    estimatedUsdCost?: number;
    displayedUsdCost?: number;
    displayedUsdCostSource?: ClientTokenUsage['displayedUsdCostSource'];
    costBreakdown?: {
        inputUsd: number;
        cachedInputUsd: number;
        cacheWriteUsd: number;
        outputUsd: number;
    };
    pricingSource?: string;
    unpricedTurnCount?: number;
    pricingUnavailable?: boolean;
}

function truncate(value: string, max: number): string {
    if (value.length <= max) return value;
    return value.slice(0, max - 1) + '…';
}

export interface MetaRow {
    label: string;
    value: string;
    breakAll?: boolean;
    mono?: boolean;
    link?: string;
}

const SUMMARY_ROW_LABELS = new Set([
    'Type',
    'Status',
    'Mode',
    'Agent Provider',
    'Model',
]);

const TIME_ROW_LABELS = new Set(['Started', 'Ended', 'Duration']);
const WORKSPACE_ROW_LABELS = new Set(['Working Directory', 'Workspace', 'Turns']);
const RALPH_STATUS_ROW_LABELS = new Set(['Ralph · Phase', 'Ralph · Session ID', 'Ralph · Iteration']);

function toStringValue(value: unknown): string | null {
    if (value == null) return null;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return null;
}

function formatTimestamp(value: unknown): string | null {
    const raw = toStringValue(value);
    if (!raw) return null;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString();
}

function formatInteger(value: number): string {
    return Math.max(0, value).toLocaleString();
}

const REASONING_EFFORT_DEFAULT = 'Default';

function formatReasoningEffort(value: unknown): string {
    const raw = toStringValue(value);
    if (!raw) return REASONING_EFFORT_DEFAULT;
    switch (raw.toLowerCase()) {
        case 'low':
            return 'Low';
        case 'medium':
            return 'Medium';
        case 'high':
            return 'High';
        case 'xhigh':
            return 'X High';
        default:
            return raw
                .split(/[\s_-]+/)
                .filter(Boolean)
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ') || REASONING_EFFORT_DEFAULT;
    }
}

function formatUsdCost(usd: number): string {
    if (usd >= 0.01) return '$' + usd.toFixed(2);
    return '$' + usd.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function finiteUsd(value: number | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function describeUsdCostSource(source: ClientTokenUsage['displayedUsdCostSource']): string {
    if (source === 'native') return 'native reported';
    if (source === 'estimated') return 'pricing estimate';
    if (source === 'mixed') return 'mixed native/estimate';
    return 'unknown source';
}

function getHttpUrl(value: string | undefined): string | null {
    if (!value) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return url.href;
    } catch {
        return null;
    }
}

function pluralizeTurns(count: number): string {
    return `${count.toLocaleString()} ${count === 1 ? 'turn' : 'turns'}`;
}

function readTokenUsage(value: unknown): ClientTokenUsage | null {
    if (!value || typeof value !== 'object') return null;
    const usage = value as Partial<ClientTokenUsage>;
    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    const cacheReadTokens = usage.cacheReadTokens ?? 0;
    const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
    const totalTokens = usage.totalTokens ?? inputTokens + outputTokens;
    if (inputTokens <= 0 && outputTokens <= 0 && cacheReadTokens <= 0 && cacheWriteTokens <= 0 && totalTokens <= 0) {
        return null;
    }
    return {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens,
        turnCount: usage.turnCount ?? 0,
        cost: usage.cost,
        actualUsdCost: usage.actualUsdCost,
        estimatedUsdCost: usage.estimatedUsdCost,
        displayedUsdCost: usage.displayedUsdCost,
        displayedUsdCostSource: usage.displayedUsdCostSource,
        costBreakdown: usage.costBreakdown,
        pricingSource: usage.pricingSource,
        pricingUnavailable: usage.pricingUnavailable,
        duration: usage.duration,
        tokenLimit: usage.tokenLimit,
        currentTokens: usage.currentTokens,
        systemTokens: usage.systemTokens,
        toolDefinitionsTokens: usage.toolDefinitionsTokens,
        conversationTokens: usage.conversationTokens,
    };
}

function readCostEstimate(value: unknown): ClientConversationCostEstimate | null {
    if (!value || typeof value !== 'object') return null;
    return value as ClientConversationCostEstimate;
}

function resolveDisplayedUsdCost(
    usage: ClientTokenUsage,
    estimate: ClientConversationCostEstimate | null
): { usd: number; source: ClientTokenUsage['displayedUsdCostSource'] } | null {
    const estimateDisplayedUsd = finiteUsd(estimate?.displayedUsdCost);
    if (estimateDisplayedUsd !== undefined) {
        return {
            usd: estimateDisplayedUsd,
            source: estimate?.displayedUsdCostSource
                ?? (finiteUsd(estimate?.actualUsdCost) !== undefined ? 'native' : 'estimated'),
        };
    }

    const usageDisplayedUsd = finiteUsd(usage.displayedUsdCost);
    if (usageDisplayedUsd !== undefined) {
        return {
            usd: usageDisplayedUsd,
            source: usage.displayedUsdCostSource
                ?? (finiteUsd(usage.actualUsdCost) !== undefined ? 'native' : 'estimated'),
        };
    }

    const estimateActualUsd = finiteUsd(estimate?.actualUsdCost);
    if (estimateActualUsd !== undefined) {
        return { usd: estimateActualUsd, source: 'native' };
    }

    const usageActualUsd = finiteUsd(usage.actualUsdCost);
    if (usageActualUsd !== undefined) {
        return { usd: usageActualUsd, source: 'native' };
    }

    const estimateEstimatedUsd = estimate?.pricingUnavailable
        ? undefined
        : finiteUsd(estimate?.estimatedUsdCost);
    if (estimateEstimatedUsd !== undefined) {
        return { usd: estimateEstimatedUsd, source: 'estimated' };
    }

    const usageEstimatedUsd = usage.pricingUnavailable
        ? undefined
        : finiteUsd(usage.estimatedUsdCost);
    if (usageEstimatedUsd !== undefined) {
        return { usd: usageEstimatedUsd, source: 'estimated' };
    }

    return null;
}

function parseSessionIdFromResult(result: unknown): string | null {
    if (typeof result !== 'string' || !result.trim()) return null;
    try {
        const parsed = JSON.parse(result);
        return toStringValue((parsed as any)?.sessionId);
    } catch {
        return null;
    }
}

export function getSessionIdFromProcess(process: any): string | null {
    if (!process) return null;
    return toStringValue(process.sdkSessionId)
        || toStringValue(process.sessionId)
        || parseSessionIdFromResult(process.result);
}

function getAgentNameFromProcess(process: any): string | null {
    return toStringValue(process?.metadata?.agentName)
        || toStringValue(process?.metadata?.agent)
        || toStringValue(process?.metadata?.provider)
        || toStringValue(process?.agentName)
        || toStringValue(process?.provider);
}

export function buildRows(process: any, turnsCount?: number): MetaRow[] {
    if (!process) return [];

    const rows: MetaRow[] = [];
    const push = (label: string, value: unknown, opts?: { breakAll?: boolean; mono?: boolean; link?: string }) => {
        const str = toStringValue(value);
        if (!str) return;
        rows.push({ label, value: str, breakAll: opts?.breakAll, mono: opts?.mono, link: opts?.link });
    };

    const processId = toStringValue(process.id);
    const queueTaskId = toStringValue(process?.metadata?.queueTaskId)
        || (processId && isQueueProcessId(processId) ? toTaskId(processId) : null);
    const startedAt = process.startTime || process.startedAt || process.createdAt;
    const endedAt = process.endTime || process.completedAt;
    const startedMs = startedAt ? new Date(startedAt).getTime() : NaN;
    const endedMs = endedAt ? new Date(endedAt).getTime() : NaN;
    const computedDuration = Number.isFinite(startedMs) && Number.isFinite(endedMs)
        ? Math.max(0, endedMs - startedMs)
        : undefined;
    const duration = typeof process.duration === 'number' ? process.duration : computedDuration;
    const sessionId = getSessionIdFromProcess(process);

    push('Process ID', process.id, { breakAll: true, mono: true });
    push('Queue Task ID', queueTaskId, { breakAll: true, mono: true });
    push('Type', process.type);
    push('Status', process.status);
    push('Model', process?.metadata?.model || process?.config?.model || process?.model || 'default');
    push('Mode', process?.metadata?.mode || process?.mode);
    push('Agent Provider', getAgentNameFromProcess(process));
    push('Reasoning Effort', formatReasoningEffort(process?.config?.reasoningEffort || process?.metadata?.reasoningEffort));
    push('Session ID', sessionId, { breakAll: true, mono: true, link: sessionId ? `#logs?sessionId=${encodeURIComponent(sessionId)}` : undefined });
    push('Backend', process?.metadata?.backend);
    push('Started', formatTimestamp(startedAt));
    push('Ended', formatTimestamp(endedAt));
    push('Duration', duration != null ? formatDuration(duration) : null);
    push('Working Directory', process.workingDirectory || process?.payload?.workingDirectory, { breakAll: true });
    push('Workspace', process.workspaceName || process.workspaceId || process?.metadata?.workspaceId);
    if (typeof turnsCount === 'number' && turnsCount >= 0) {
        push('Turns', turnsCount);
    }
    push('File Path', process.dataFilePath, { breakAll: true, mono: true });

    const ralph = getRalphContext(process);
    if (ralph) {
        push('Ralph · Phase', ralph.phase);
        push('Ralph · Session ID', ralph.sessionId, { breakAll: true, mono: true });
        if (typeof ralph.currentIteration === 'number') {
            push('Ralph · Iteration', ralph.currentIteration);
        }
        if (ralph.originalGoal) {
            push('Ralph · Goal', truncate(ralph.originalGoal, RALPH_FIELD_TRUNCATE), { breakAll: true });
        }
    }

    return rows;
}

function findRow(rows: MetaRow[], label: string): MetaRow | undefined {
    return rows.find(row => row.label === label);
}

export function buildSummaryItems(rows: MetaRow[]): string[] {
    const items: string[] = [];
    for (const label of ['Type', 'Status', 'Mode', 'Agent Provider', 'Model']) {
        const row = findRow(rows, label);
        if (row) items.push(row.value);
    }
    const effort = findRow(rows, 'Reasoning Effort');
    if (effort) items.push(`effort ${effort.value}`);
    return items;
}

function buildTimeRow(rows: MetaRow[]): MetaRow | null {
    const started = findRow(rows, 'Started')?.value;
    const ended = findRow(rows, 'Ended')?.value;
    const duration = findRow(rows, 'Duration')?.value;
    const parts: string[] = [];
    if (started && ended) {
        parts.push(`${started} → ${ended}`);
    } else if (started) {
        parts.push(`started ${started}`);
    } else if (ended) {
        parts.push(`ended ${ended}`);
    }
    if (duration) parts.push(duration);
    if (parts.length === 0) return null;
    return { label: 'Time', value: parts.join(' · ') };
}

function formatTurns(value: string): string {
    const count = Number(value);
    if (Number.isFinite(count)) {
        return `${value} ${count === 1 ? 'turn' : 'turns'}`;
    }
    return `${value} turns`;
}

function buildWorkspaceRow(rows: MetaRow[]): MetaRow | null {
    const workspace = findRow(rows, 'Workspace')?.value;
    const workingDirectory = findRow(rows, 'Working Directory')?.value;
    const turns = findRow(rows, 'Turns')?.value;
    const parts = [
        workspace,
        workingDirectory,
        turns ? formatTurns(turns) : undefined,
    ].filter((part): part is string => Boolean(part));
    if (parts.length === 0) return null;
    return {
        label: workspace ? 'Workspace' : 'Context',
        value: parts.join(' · '),
        breakAll: Boolean(workingDirectory),
    };
}

function buildRalphRow(rows: MetaRow[]): MetaRow | null {
    const phase = findRow(rows, 'Ralph · Phase')?.value;
    const sessionId = findRow(rows, 'Ralph · Session ID')?.value;
    const iteration = findRow(rows, 'Ralph · Iteration')?.value;
    const parts = [
        phase,
        iteration ? `iteration ${iteration}` : undefined,
        sessionId,
    ].filter((part): part is string => Boolean(part));
    if (parts.length === 0) return null;
    return {
        label: 'Ralph',
        value: parts.join(' · '),
        breakAll: Boolean(sessionId),
    };
}

function TokenUsageRows({ process }: { process: any }) {
    const [tokensExpanded, setTokensExpanded] = useState(false);
    const usage = readTokenUsage(process?.cumulativeTokenUsage);
    if (!usage) return null;

    const estimate = readCostEstimate(process?.conversationCostEstimate);
    const displayedUsd = resolveDisplayedUsdCost(usage, estimate);
    const costBreakdown = estimate?.costBreakdown ?? usage.costBreakdown;
    const unpricedTurnCount = estimate?.unpricedTurnCount ?? 0;
    const pricingSource = estimate?.pricingSource ?? usage.pricingSource;
    const pricingSourceUrl = getHttpUrl(pricingSource);
    const costSummaryParts: string[] = [];
    const estimatedUsd = estimate?.pricingUnavailable || usage.pricingUnavailable
        ? undefined
        : finiteUsd(estimate?.estimatedUsdCost) ?? finiteUsd(usage.estimatedUsdCost);

    if (displayedUsd) {
        costSummaryParts.push(`${formatUsdCost(displayedUsd.usd)} (${describeUsdCostSource(displayedUsd.source)})`);
    } else {
        costSummaryParts.push('pricing unavailable');
    }
    if (unpricedTurnCount > 0) {
        costSummaryParts.push(estimate?.pricingUnavailable || !displayedUsd
            ? `${pluralizeTurns(unpricedTurnCount)} unpriced`
            : `partial — ${pluralizeTurns(unpricedTurnCount)} unpriced`);
    }

    const costDetailParts = [
        ...(displayedUsd ? [
            `Displayed USD: ${formatUsdCost(displayedUsd.usd)} (${describeUsdCostSource(displayedUsd.source)})`,
        ] : ['Displayed USD: pricing unavailable']),
        ...(estimatedUsd !== undefined ? [
            `Pricing-table estimate: ${formatUsdCost(estimatedUsd)}`,
        ] : []),
    ];
    if (costBreakdown) {
        costDetailParts.push(
            `Input: ${formatUsdCost(costBreakdown.inputUsd)}`,
            `Cached input: ${formatUsdCost(costBreakdown.cachedInputUsd)}`,
            `Cache write: ${formatUsdCost(costBreakdown.cacheWriteUsd)}`,
            `Output: ${formatUsdCost(costBreakdown.outputUsd)}`,
        );
    }
    if (pricingSource) costDetailParts.push(`Source: ${pricingSource}`);

    return (
        <>
            <div className="contents">
                <span className="text-[#848484]">Tokens</span>
                <button
                    type="button"
                    className="text-left text-[#1e1e1e] dark:text-[#cccccc] hover:text-[#0078d4] dark:hover:text-[#3794ff] transition-colors"
                    aria-expanded={tokensExpanded}
                    title={tokensExpanded ? 'Collapse token breakdown' : 'Expand token breakdown'}
                    onClick={() => setTokensExpanded(value => !value)}
                >
                    {tokensExpanded ? (
                        <span className="break-words">
                            Input: {formatInteger(usage.inputTokens)} · Output: {formatInteger(usage.outputTokens)} · Cache read: {formatInteger(usage.cacheReadTokens)} · Cache write: {formatInteger(usage.cacheWriteTokens)} · Total: {formatInteger(usage.totalTokens)}
                        </span>
                    ) : (
                        <span>Total: {formatInteger(usage.totalTokens)}</span>
                    )}
                </button>
            </div>
            <div className="contents">
                <span className="text-[#848484]">USD cost</span>
                <span className="text-[#1e1e1e] dark:text-[#cccccc] break-words" title={costDetailParts.join(' · ') || undefined}>
                    {costSummaryParts.join(' · ')}
                    {pricingSource && (
                        <span className="text-[#848484]">
                            {' · '}
                            {pricingSourceUrl ? (
                                <a
                                    href={pricingSourceUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[#0078d4] dark:text-[#3794ff] hover:underline"
                                    title={pricingSource}
                                >
                                    Source
                                </a>
                            ) : (
                                <>Source: {pricingSource}</>
                            )}
                        </span>
                    )}
                </span>
            </div>
        </>
    );
}

export function buildCompactRows(rows: MetaRow[]): MetaRow[] {
    const compactRows: MetaRow[] = [];
    let timeAdded = false;
    let workspaceAdded = false;
    let ralphAdded = false;

    for (const row of rows) {
        if (SUMMARY_ROW_LABELS.has(row.label)) continue;

        if (TIME_ROW_LABELS.has(row.label)) {
            if (!timeAdded) {
                const timeRow = buildTimeRow(rows);
                if (timeRow) compactRows.push(timeRow);
                timeAdded = true;
            }
            continue;
        }

        if (WORKSPACE_ROW_LABELS.has(row.label)) {
            if (!workspaceAdded) {
                const workspaceRow = buildWorkspaceRow(rows);
                if (workspaceRow) compactRows.push(workspaceRow);
                workspaceAdded = true;
            }
            continue;
        }

        if (RALPH_STATUS_ROW_LABELS.has(row.label)) {
            if (!ralphAdded) {
                const ralphRow = buildRalphRow(rows);
                if (ralphRow) compactRows.push(ralphRow);
                ralphAdded = true;
            }
            continue;
        }

        if (row.label === 'Ralph · Goal') {
            compactRows.push({ ...row, label: 'Goal' });
            continue;
        }

        compactRows.push(row);
    }

    return compactRows;
}

export interface ConversationMetadataPopoverProps {
    process: any;
    turnsCount?: number;
    /** When provided, a "Resume In CLI" action button is shown at the bottom of the popover. */
    resumeSessionId?: string | null;
    resumeLaunching?: boolean;
    onLaunchInteractiveResume?: () => void;
    /** When provided, a "Fork conversation" action button is shown at the bottom of the popover. */
    onFork?: () => void;
    forking?: boolean;
    /** When provided, a fresh same-context lens chat action is shown at the bottom of the popover. */
    onStartFreshSameContext?: () => Promise<boolean> | boolean | void;
    startingFreshSameContext?: boolean;
    /**
     * Extra metadata rows appended after the standard compact rows. Used by
     * read-only surfaces (e.g. native CLI sessions) to surface fields that have
     * no built-in slot in {@link buildRows} — repository, branch, working
     * directory, host, created/updated, stored summary — without forking the
     * popover. Absent for CoC chats, which keep their existing rows unchanged.
     */
    extraRows?: MetaRow[];
}

export function ConversationMetadataPopover({ process, turnsCount, resumeSessionId, resumeLaunching, onLaunchInteractiveResume, onFork, forking, onStartFreshSameContext, startingFreshSameContext, extraRows }: ConversationMetadataPopoverProps) {
    const [open, setOpen] = useState(false);
    const [systemPromptOpen, setSystemPromptOpen] = useState(false);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const rows = useMemo(() => buildRows(process, turnsCount), [process, turnsCount]);
    const summaryItems = useMemo(() => buildSummaryItems(rows), [rows]);
    const compactRows = useMemo(() => {
        const base = buildCompactRows(rows);
        return extraRows && extraRows.length > 0 ? [...base, ...extraRows] : base;
    }, [rows, extraRows]);
    const { isMobile } = useBreakpoint();

    const handleToggle = useCallback(() => {
        if (open) {
            setOpen(false);
            return;
        }
        const el = triggerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        setMenuPos({ top: rect.bottom + 4, left: rect.right });
        setOpen(true);
    }, [open]);

    // Correct popover overflow after render
    useEffect(() => {
        if (!open || !popoverRef.current || !triggerRef.current) return;
        const popover = popoverRef.current;
        const trigger = triggerRef.current;
        const popoverRect = popover.getBoundingClientRect();
        const triggerRect = trigger.getBoundingClientRect();

        let { top, left } = menuPos;
        // Align right edge of popover with right edge of trigger
        left = triggerRect.right - popoverRect.width;
        if (left < 8) left = 8;
        if (left + popoverRect.width > window.innerWidth - 8) {
            left = window.innerWidth - popoverRect.width - 8;
        }
        if (top + popoverRect.height > window.innerHeight - 8) {
            top = triggerRect.top - popoverRect.height - 4;
        }
        if (top < 8) top = 8;
        if (top !== menuPos.top || left !== menuPos.left) {
            setMenuPos({ top, left });
        }
    }, [open, menuPos.top, menuPos.left]);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent | TouchEvent) => {
            const target = e.target as Node | null;
            if (!target) return;
            if (popoverRef.current?.contains(target)) return;
            if (triggerRef.current?.contains(target)) return;
            setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        document.addEventListener('touchstart', handler);
        return () => {
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('touchstart', handler);
        };
    }, [open]);

    // Close on Escape
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open]);

    if (rows.length === 0 && (!extraRows || extraRows.length === 0)) return null;

    const popoverContent = (
        <>
            <div className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">
                Conversation metadata
            </div>
            {summaryItems.length > 0 && (
                <div
                    className="mb-2 flex flex-wrap gap-1.5 text-[11px] leading-4"
                    aria-label="Conversation summary"
                    data-testid="conversation-metadata-summary"
                >
                    {summaryItems.map((item, index) => (
                        <span
                            key={`${index}-${item}`}
                            className="rounded-full border border-[#d6d6d6] dark:border-[#3c3c3c] bg-[#f7f7f7] dark:bg-[#1f1f1f] px-1.5 py-0.5 text-[#4f4f4f] dark:text-[#c8c8c8]"
                        >
                            {item}
                        </span>
                    ))}
                </div>
            )}
            <div className="grid grid-cols-[112px_1fr] gap-x-2.5 gap-y-1 text-xs">
                {compactRows.map((row) => (
                    <div key={row.label} className="contents">
                        <span className="text-[#848484]">{row.label}</span>
                        {row.link ? (
                            <div className={[
                                'flex flex-wrap items-baseline gap-x-1.5',
                                row.breakAll ? 'break-all' : 'break-words',
                                row.mono ? 'font-mono' : '',
                            ].join(' ')}>
                                <span className="text-[#1e1e1e] dark:text-[#cccccc]">
                                    {row.value}
                                </span>
                                <a
                                    href={row.link}
                                    className="text-[#0078d4] dark:text-[#3794ff] hover:underline text-[10px]"
                                    title="View logs for this session"
                                >
                                    🔍 logs
                                </a>
                            </div>
                        ) : (
                            <span
                                className={[
                                    'text-[#1e1e1e] dark:text-[#cccccc]',
                                    row.breakAll ? 'break-all' : 'break-words',
                                    row.mono ? 'font-mono' : '',
                                ].join(' ')}
                            >
                                {row.value}
                            </span>
                        )}
                    </div>
                ))}
                <TokenUsageRows process={process} />
                {process?.metadata?.systemPrompt && (
                    <div className="contents">
                        <span className="text-[#848484]">System</span>
                        <div className="flex flex-wrap items-baseline gap-x-1.5">
                            <span className="text-[#1e1e1e] dark:text-[#cccccc]">
                                {(process.metadata.systemPrompt as string).length.toLocaleString()} chars
                            </span>
                            <button
                                type="button"
                                className="text-[#0078d4] dark:text-[#3794ff] hover:underline text-[10px]"
                                title="View full system prompt"
                                onClick={() => { setOpen(false); setSystemPromptOpen(true); }}
                            >
                                👁 view
                            </button>
                        </div>
                    </div>
                )}
            </div>
            {(resumeSessionId && onLaunchInteractiveResume || onFork || onStartFreshSameContext) && (
                <div className="mt-3 pt-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-wrap gap-2">
                    {resumeSessionId && onLaunchInteractiveResume && (
                        <button
                            type="button"
                            disabled={resumeLaunching}
                            onClick={() => { onLaunchInteractiveResume(); setOpen(false); }}
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs text-[#0078d4] dark:text-[#3794ff] border border-[#0078d4] dark:border-[#3794ff] hover:bg-[#e8f0fb] dark:hover:bg-[#1a2a40] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <span>▶</span>
                            {resumeLaunching ? 'Launching…' : 'Resume In CLI'}
                        </button>
                    )}
                    {onStartFreshSameContext && (
                        <button
                            type="button"
                            disabled={startingFreshSameContext}
                            onClick={() => {
                                const result = onStartFreshSameContext();
                                void Promise.resolve(result).catch(error => console.error('Failed to start fresh chat:', error));
                                setOpen(false);
                            }}
                            title="Start an empty chat for this same lens context"
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs text-[#0078d4] dark:text-[#3794ff] border border-[#0078d4] dark:border-[#3794ff] hover:bg-[#e8f0fb] dark:hover:bg-[#1a2a40] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <span>＋</span>
                            New chat with same context
                        </button>
                    )}
                    {onFork && (
                        <button
                            type="button"
                            disabled={forking}
                            onClick={() => { onFork(); setOpen(false); }}
                            title="Fork this conversation into a new independent chat"
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs text-[#0078d4] dark:text-[#3794ff] border border-[#0078d4] dark:border-[#3794ff] hover:bg-[#e8f0fb] dark:hover:bg-[#1a2a40] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <span>🍴</span>
                            {forking ? 'Forking…' : 'Fork'}
                        </button>
                    )}
                </div>
            )}
        </>
    );

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                aria-label={open ? 'Hide conversation metadata' : 'Show conversation metadata'}
                title="Conversation metadata"
                className="inline-flex items-center justify-center w-[26px] h-[26px] rounded text-[12px] font-semibold italic text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] transition-colors flex-shrink-0"
                onClick={handleToggle}
            >
                i
            </button>

            {open && isMobile && (
                <BottomSheet isOpen={true} onClose={() => setOpen(false)}>
                    <div className="p-4">
                        {popoverContent}
                    </div>
                </BottomSheet>
            )}

            {open && !isMobile && ReactDOM.createPortal(
                <div
                    ref={popoverRef}
                    className="fixed z-[10003] w-[480px] max-w-[calc(100vw-16px)] rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] p-3 shadow-lg"
                    style={{ top: menuPos.top, left: menuPos.left }}
                    onMouseDown={e => e.stopPropagation()}
                >
                    {popoverContent}
                </div>,
                document.body
            )}

            <Dialog
                open={systemPromptOpen}
                onClose={() => setSystemPromptOpen(false)}
                title="System Prompt"
                className="max-w-[700px]"
            >
                <pre className="whitespace-pre-wrap break-words text-xs font-mono text-[#1e1e1e] dark:text-[#cccccc] overflow-y-auto max-h-[60vh] p-3 bg-[#f5f5f5] dark:bg-[#1e1e1e] rounded">
                    {process?.metadata?.systemPrompt as string}
                </pre>
            </Dialog>
        </>
    );
}
