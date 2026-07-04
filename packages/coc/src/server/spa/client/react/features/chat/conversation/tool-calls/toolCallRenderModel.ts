/**
 * toolCallRenderModel — the pure "kernel" behind ToolCallView.
 *
 * Given a raw tool call and a render variant, this computes everything the
 * component needs to render (normalized identity, parsed args, summary text,
 * detail-section inputs, result truncation, preview eligibility, metrics, and
 * duration/start labels) without any React or DOM dependency. Keeping it pure
 * makes tool-call display policy testable in isolation and shared verbatim by
 * the whisper-row and default-card variants.
 */

import { shortenFilePath } from '../../../../shared';
import { getApplyPatchText, parseApplyPatchFileChanges } from '../../../../utils/applyPatchParser';
import type { ToolCallVariant } from './ToolCallVariant';
import { getToolKindInfo, KIND_PILL_CLASSES, getToolMetric } from './toolKindUtils';
import type { ToolKindInfo } from './toolKindUtils';
import {
    getCodexFileChanges,
    normalizeToolForDisplay,
    summarizeCodexFileChanges,
    type CodexFileChange,
    type ToolLikeForNormalization,
} from './toolNormalization';

export const MAX_RESULT_LENGTH = 5000;
export const TRUNCATED_RESULT_LENGTH = 4900;

export type ToolMetric = ReturnType<typeof getToolMetric>;

export function formatArgs(args: any): string {
    if (!args) return '';
    if (typeof args === 'object' && !Array.isArray(args) && Object.keys(args).length === 0) return '';
    if (typeof args === 'string') {
        try { return JSON.stringify(JSON.parse(args), null, 2); } catch { return args; }
    }
    return JSON.stringify(args, null, 2);
}

export function parseArgsObject(args: any): Record<string, any> | null {
    if (!args) return null;
    if (typeof args === 'object' && !Array.isArray(args)) {
        return args as Record<string, any>;
    }
    if (typeof args === 'string') {
        try {
            const parsed = JSON.parse(args);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, any>;
            }
        } catch {
            return null;
        }
    }
    return null;
}

export function truncateSummary(value: string, maxLength = 80): string {
    return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

/** Insert thousands separators without depending on the host locale (deterministic across platforms/tests). */
export function formatCount(value: number): string {
    return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function getAskUserQuestionSummary(args: Record<string, any>): string {
    if (typeof args.question === 'string' && args.question.trim()) {
        return truncateSummary(args.question.trim());
    }
    if (Array.isArray(args.questions)) {
        const questions = args.questions
            .filter((question: unknown): question is Record<string, any> => !!question && typeof question === 'object' && !Array.isArray(question))
            .map(question => typeof question.question === 'string' ? question.question.trim() : '')
            .filter(Boolean);
        if (questions.length > 0) {
            const suffix = questions.length > 1 ? ` (+${questions.length - 1} more)` : '';
            return `${truncateSummary(questions[0], 80 - suffix.length)}${suffix}`;
        }
    }
    return '';
}

export function shortenPath(p: string): string {
    return shortenFilePath(p);
}

export function isImageDataUrl(s: string): boolean {
    return /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,/i.test(s.trim());
}

export function getToolSummary(toolName: string, args: any, rawArgs?: any): string {
    if (toolName === 'apply_patch') {
        const codexSummary = summarizeCodexFileChanges(rawArgs ?? args);
        if (codexSummary) return shortenPath(codexSummary);
        const changes = parseApplyPatchFileChanges(getApplyPatchText(rawArgs ?? args));
        if (changes.length === 1) {
            return shortenPath(changes[0].path);
        }
        return changes.length > 1 ? `${changes.length} files` : '';
    }
    if (!args || typeof args !== 'object') return '';

    switch (toolName) {
        case 'grep': {
            const parts: string[] = [];
            if (args.pattern) parts.push(`/${args.pattern}/`);
            if (args.path) parts.push(shortenPath(args.path));
            else if (args.glob) parts.push(args.glob);
            return parts.join(' in ');
        }
        case 'view': {
            let p = '';
            if (args.path) p = shortenPath(args.path);
            else if (args.filePath) p = shortenPath(args.filePath);
            if (p && args.view_range && Array.isArray(args.view_range) && args.view_range.length >= 2) {
                p += ` L${args.view_range[0]}-L${args.view_range[1]}`;
            }
            return p;
        }
        case 'edit':
        case 'create': {
            if (args.path) return shortenPath(args.path);
            if (args.filePath) return shortenPath(args.filePath);
            return '';
        }
        case 'bash':
        case 'shell':
        case 'powershell': {
            if (typeof args.command === 'string' && args.command.trim()) {
                const cmd = args.command.trim();
                return cmd.length > 80 ? `${cmd.slice(0, 77)}...` : cmd;
            }
            return '';
        }
        case 'glob': {
            const parts: string[] = [];
            if (args.pattern) parts.push(args.pattern);
            else if (args.glob_pattern) parts.push(args.glob_pattern);
            if (args.path) parts.push(`in ${shortenPath(args.path)}`);
            return parts.join(' ');
        }
        case 'sql': {
            if (typeof args.description === 'string' && args.description.trim()) {
                return args.description.trim();
            }
            if (typeof args.query === 'string' && args.query.trim()) {
                const q = args.query.trim();
                return q.length > 80 ? `${q.slice(0, 77)}...` : q;
            }
            return '';
        }
        case 'skill': {
            if (args.name) return args.name;
            if (args.skill_name) return args.skill_name;
            if (args.skill) return args.skill;
            return '';
        }
        case 'task': {
            const parts: string[] = [];
            if (args.agent_type) parts.push(`[${args.agent_type}]`);
            if (args.description) parts.push(args.description);
            else if (typeof args.prompt === 'string' && args.prompt.trim()) {
                const prompt = args.prompt.trim();
                parts.push(prompt.length > 60 ? `${prompt.slice(0, 57)}...` : prompt);
            }
            return parts.join(' ');
        }
        case 'read_agent': {
            const agentId = args.agent_id ? String(args.agent_id) : '';
            const wait = args.wait ? ' (wait)' : '';
            return agentId ? `Agent ${agentId}${wait}` : '';
        }
        case 'task_complete': {
            if (typeof args.summary === 'string' && args.summary.trim()) {
                const s = args.summary.trim();
                return s.length > 80 ? `${s.slice(0, 77)}...` : s;
            }
            return 'Task completed';
        }
        case 'suggest_follow_ups': {
            if (Array.isArray(args.suggestions)) {
                return args.suggestions.slice(0, 3).join(' · ');
            }
            return '';
        }
        case 'ask_user': {
            return getAskUserQuestionSummary(args) || 'Ask user';
        }
        default: {
            for (const key of ['path', 'filePath', 'file', 'pattern', 'query', 'command', 'url']) {
                if (typeof args[key] === 'string' && args[key]) {
                    const val = args[key];
                    if (val.startsWith('/')) return shortenPath(val);
                    return val.length > 60 ? `${val.slice(0, 57)}...` : val;
                }
            }
            return '';
        }
    }
}

export function formatStartTime(startTime?: string): string {
    if (!startTime) return '';
    const d = new Date(startTime);
    if (isNaN(d.getTime())) return '';
    const MM = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    let hh = d.getHours();
    const ampm = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12 || 12;
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${MM}/${dd} ${hh}:${mm} ${ampm}`;
}

export function formatDuration(startTime?: string, endTime?: string): string {
    if (!startTime) return '';
    const start = new Date(startTime).getTime();
    const end = endTime ? new Date(endTime).getTime() : Date.now();
    const ms = end - start;
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

export function statusIndicator(status?: string): string {
    switch (status) {
        case 'running': return '🔄';
        case 'completed': return '✅';
        case 'failed': return '❌';
        default: return '⏳';
    }
}

/** Raw tool call shape accepted by the render model. */
export interface ToolCallModelInput extends ToolLikeForNormalization {
    id?: string;
    startTime?: string;
    endTime?: string;
}

/**
 * Fully-derived view of a tool call, independent of variant-specific chrome.
 * Every field here is a pure function of the input tool call (plus the variant,
 * which only gates the whisper-row `metric`).
 */
export interface ToolCallRenderModel {
    /** Stable identifier used for the `data-tool-id` attribute. */
    id: string;
    /** Normalized, canonical tool name ('unknown' when absent). */
    name: string;
    status?: string;
    error?: string;
    isRunning: boolean;
    isTaskComplete: boolean;
    isShellLike: boolean;
    isSql: boolean;
    /** Parsed args as a plain object, or null when args are absent/non-object. */
    argsObj: Record<string, any> | null;
    /** Pretty-printed args JSON for the generic "Arguments" section. */
    argsText: string;
    /** One-line summary shown next to the tool name / in the row path column. */
    summary: string;
    /** True when the summary is a clickable file path (adds file-path-link chrome). */
    summaryIsPath: boolean;
    /** The full path backing a path summary (empty string otherwise). */
    summaryFullPath: string;
    duration: string;
    startTimeLabel: string;
    /** True when there is any expandable detail (args, result, or error). */
    hasDetails: boolean;
    resultText: string;
    isResultTruncated: boolean;
    /** Result text clamped to the inline display cap. */
    visibleResult: string;
    /** Result text used for the hover popover (apply_patch prefers the patch body). */
    popoverResultText: string;
    applyPatchText: string;
    codexFileChanges: CodexFileChange[];
    bashDescription: string;
    bashCommand: string;
    bashOptionsText: string;
    sqlDescription: string;
    sqlQuery: string;
    sqlOptionsText: string;
    /** Markdown source rendered for a task_complete card. */
    taskCompleteSummary: string;
    /** True when hovering the header should show a result popover. */
    hasHoverResult: boolean;
    kindInfo: ToolKindInfo;
    kindPillClass: string;
    /** Whisper-row metric (lines/hits/files/diff); null for the card variant. */
    metric: ToolMetric;
    /** Row path text with an 'error' fallback, used by the whisper-row variant. */
    rowSummary: string;
}

/** Pull the JSON-stringifiable extra options out of a shell/sql args object. */
function extractOptionsText(argsObj: Record<string, any> | null, omit: string[]): string {
    if (!argsObj || typeof argsObj !== 'object') return '';
    const options = Object.fromEntries(
        Object.entries(argsObj).filter(([key]) => !omit.includes(key)),
    );
    return Object.keys(options).length > 0 ? JSON.stringify(options, null, 2) : '';
}

/**
 * Compute the complete render model for a tool call.
 *
 * @param toolCall Raw tool call (unnormalized name/args allowed).
 * @param variant  'whisper-row' additionally computes the compact `metric`.
 */
export function buildToolCallRenderModel(
    toolCall: ToolCallModelInput,
    variant: ToolCallVariant,
): ToolCallRenderModel {
    const normalized = normalizeToolForDisplay(toolCall);
    const name = normalized.toolName || 'unknown';
    const argsObj = parseArgsObject(normalized.args);
    const argsText = formatArgs(normalized.args);
    const error = normalized.error;

    const isTaskComplete = name === 'task_complete';
    const isShellLike = name === 'bash' || name === 'shell' || name === 'powershell';
    const isSql = name === 'sql';

    const applyPatchText = name === 'apply_patch' ? getApplyPatchText(normalized.args) : '';
    const codexFileChanges = name === 'apply_patch' ? getCodexFileChanges(normalized.args) : [];

    const summary = getToolSummary(name, argsObj, normalized.args);
    const summaryIsPath = !!summary
        && ['view', 'edit', 'create', 'glob', 'grep'].includes(name)
        && !!(argsObj && (argsObj.path || argsObj.filePath));
    const summaryFullPath = summaryIsPath && argsObj ? String(argsObj.path || argsObj.filePath) : '';

    const resultText = typeof normalized.result === 'string' ? normalized.result : '';
    const isResultTruncated = resultText.length > MAX_RESULT_LENGTH;
    const visibleResult = isResultTruncated
        ? `${resultText.slice(0, TRUNCATED_RESULT_LENGTH)}\n... (output truncated — showing ${formatCount(TRUNCATED_RESULT_LENGTH)} of ${formatCount(resultText.length)} chars)`
        : resultText;
    const popoverResultText = name === 'apply_patch' && applyPatchText ? applyPatchText : resultText;

    const hasDetails = !!(argsText || resultText || error);

    const bashDescription = isShellLike && argsObj?.description ? String(argsObj.description) : '';
    const bashCommand = isShellLike && argsObj?.command ? String(argsObj.command) : '';
    const bashOptionsText = isShellLike ? extractOptionsText(argsObj, ['description', 'command']) : '';

    const sqlDescription = isSql && argsObj?.description ? String(argsObj.description) : '';
    const sqlQuery = isSql && argsObj?.query ? String(argsObj.query) : '';
    const sqlOptionsText = isSql ? extractOptionsText(argsObj, ['description', 'query']) : '';

    const taskCompleteSummary = isTaskComplete
        ? (resultText || (argsObj && typeof argsObj.summary === 'string' ? argsObj.summary : ''))
        : '';

    const hasHoverResult = (
        name === 'task' || name === 'read_agent' || name === 'view' || isShellLike || isSql
        || name === 'glob' || name === 'grep' || name === 'create' || name === 'edit' || name === 'apply_patch'
    ) && !!popoverResultText;

    const kindInfo = getToolKindInfo(name);
    const kindPillClass = KIND_PILL_CLASSES[kindInfo.cls];
    const metric = variant === 'whisper-row'
        ? getToolMetric(name, argsObj, resultText, error)
        : null;
    const rowSummary = summary || (error ? 'error' : '');

    return {
        id: normalized.id || normalized.toolName || 'unknown',
        name,
        status: normalized.status,
        error,
        isRunning: normalized.status === 'running',
        isTaskComplete,
        isShellLike,
        isSql,
        argsObj,
        argsText,
        summary,
        summaryIsPath,
        summaryFullPath,
        duration: formatDuration(normalized.startTime, normalized.endTime),
        startTimeLabel: formatStartTime(normalized.startTime),
        hasDetails,
        resultText,
        isResultTruncated,
        visibleResult,
        popoverResultText,
        applyPatchText,
        codexFileChanges,
        bashDescription,
        bashCommand,
        bashOptionsText,
        sqlDescription,
        sqlQuery,
        sqlOptionsText,
        taskCompleteSummary,
        hasHoverResult,
        kindInfo,
        kindPillClass,
        metric,
        rowSummary,
    };
}
