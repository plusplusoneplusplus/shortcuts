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

export function typeLabel(type: string): string {
    const map: Record<string, string> = {
        'code-review': 'Code Review',
        'code-review-group': 'CR Group',
        'pipeline-execution': 'Pipeline',
        'pipeline-item': 'Pipeline Item',
        'clarification': 'Clarification',
        'discovery': 'Discovery'
    };
    return map[type] || type || '';
}
