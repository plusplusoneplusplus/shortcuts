/**
 * Pure utility functions for the dashboard SPA (React).
 * Ported from the vanilla utils.ts — same implementations.
 */

export function formatDuration(ms: number | null | undefined): string {
    if (ms == null || ms < 0) return '';
    if (ms < 1000) return '< 1s';
    let s = Math.floor(ms / 1000);
    let m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    s = s % 60;
    m = m % 60;
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
}

export function formatRelativeTime(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = Date.now();
    const diff = now - d.getTime();

    // Future dates
    if (diff < 0) {
        const absMins = Math.floor(-diff / 60000);
        if (absMins < 1) return 'just now';
        if (absMins < 60) return 'in ' + absMins + 'm';
        const absHours = Math.floor(absMins / 60);
        if (absHours < 24) return 'in ' + absHours + 'h';
        return 'in ' + Math.floor(absHours / 24) + 'd';
    }

    // Past dates
    if (diff < 60000) return 'just now';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + 'm ago';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return days + 'd ago';
    return d.toLocaleDateString();
}

export function escapeHtml(str: string | null | undefined): string {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function copyToClipboard(text: string): Promise<void> {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return Promise.resolve();
}

export function statusIcon(status: string): string {
    const map: Record<string, string> = { running: '\u{1F504}', completed: '\u2705', failed: '\u274C', cancelled: '\u{1F6AB}', queued: '\u23F3' };
    return map[status] || '';
}

export function statusLabel(status: string): string {
    const map: Record<string, string> = { running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', queued: 'Queued' };
    return map[status] || status || '';
}

export function repoName(repoId: string | null | undefined): string {
    if (!repoId) return '';
    const trimmed = repoId.replace(/[/\\]+$/, '');
    const lastSep = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    return lastSep >= 0 ? trimmed.substring(lastSep + 1) : trimmed;
}

export function typeLabel(type: string): string {
    const map: Record<string, string> = {
        'code-review': 'Code Review',
        'code-review-group': 'CR Group',
        'pipeline-execution': 'Workflow',
        'pipeline-item': 'Workflow Item',
        'clarification': 'Clarification',
        'discovery': 'Discovery'
    };
    return map[type] || type || '';
}

function truncate(str: string, limit: number): string {
    if (str.length <= limit) return str;
    return str.slice(0, limit) + '…';
}

export interface ConversationTurnLike {
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: Array<{
        toolName: string;
        args: any;
        result?: string;
        error?: string;
        status: string;
    }>;
}

export interface MarkdownSection {
    heading: string;
    level: number;
    body: string;
}

/**
 * Split markdown content into sections delimited by H2/H3 headings.
 * Each section contains the heading line and all content up to the next same-or-higher-level heading.
 * Content before the first heading (preamble) is returned with heading='' and level=0.
 */
export function splitMarkdownSections(content: string): MarkdownSection[] {
    if (!content || !content.trim()) return [];

    const lines = content.split('\n');
    const sections: MarkdownSection[] = [];
    let currentHeading = '';
    let currentLevel = 0;
    let currentLines: string[] = [];

    const flush = () => {
        const body = currentLines.join('\n');
        if (currentHeading || body.trim()) {
            sections.push({ heading: currentHeading, level: currentLevel, body });
        }
    };

    for (const line of lines) {
        const match = line.match(/^(#{2,3})\s+(.+)$/);
        if (match) {
            flush();
            currentHeading = line;
            currentLevel = match[1].length;
            currentLines = [];
        } else {
            currentLines.push(line);
        }
    }
    flush();

    return sections;
}

export function formatConversationAsText(turns: ConversationTurnLike[], truncateAt = 100): string {
    if (!turns || turns.length === 0) return '';
    return turns.map(turn => {
        const lines: string[] = [`[${turn.role}]`, turn.content];
        if (turn.toolCalls && turn.toolCalls.length > 0) {
            for (const tc of turn.toolCalls) {
                const argsJson = JSON.stringify(tc.args ?? {});
                const argsStr = truncate(argsJson, truncateAt);
                if (tc.status === 'pending' || tc.status === 'running') {
                    lines.push(`[tool: ${tc.toolName}] args: ${argsStr}`);
                } else if (tc.error != null) {
                    lines.push(`[tool: ${tc.toolName}] args: ${argsStr} → error: ${truncate(tc.error, truncateAt)}`);
                } else {
                    const resultStr = tc.result != null ? truncate(tc.result, truncateAt) : '';
                    lines.push(`[tool: ${tc.toolName}] args: ${argsStr} → result: ${resultStr}`);
                }
            }
        }
        return lines.join('\n');
    }).join('\n\n');
}
