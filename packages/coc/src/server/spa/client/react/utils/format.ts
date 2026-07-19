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

/**
 * Copy rich HTML to the clipboard with an optional distinct plain-text flavor.
 *
 * The `text/html` flavor keeps the rendered markup (including rendered KaTeX
 * math); the `text/plain` flavor should carry the readable source. When
 * `plainText` is omitted the HTML is used for both flavors (legacy behavior).
 * Passing the original conversation/markdown text keeps math delimiters (`$…$`,
 * `\[…\]`, etc.) intact in the plain-text flavor instead of leaking HTML markup.
 */
export async function copyHtmlToClipboard(html: string, plainText?: string): Promise<void> {
    const text = plainText ?? html;
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const htmlBlob = new Blob([html], { type: 'text/html' });
        const textBlob = new Blob([text], { type: 'text/plain' });
        await navigator.clipboard.write([
            new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob }),
        ]);
        return;
    }
    // Fallback: hidden contenteditable div + execCommand
    const div = document.createElement('div');
    div.contentEditable = 'true';
    div.innerHTML = html;
    div.style.position = 'fixed';
    div.style.left = '-9999px';
    document.body.appendChild(div);
    const range = document.createRange();
    range.selectNodeContents(div);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.execCommand('copy');
    document.body.removeChild(div);
}

/** Copy a base64/data-URL image to the clipboard as PNG. Throws if unsupported. */
export async function copyImageToClipboard(dataUrl: string): Promise<void> {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        throw new Error('Clipboard image write not supported');
    }
    await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': dataUrlToPngBlob(dataUrl) }),
    ]);
}

async function dataUrlToPngBlob(dataUrl: string): Promise<Blob> {
    const blob = await (await fetch(dataUrl)).blob();
    if (blob.type === 'image/png') return blob;
    // Re-encode jpeg/webp/gif → png (only png is reliably writable).
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
    );
}

function blobToDataUri(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
        reader.readAsDataURL(blob);
    });
}

/**
 * Fetch an image `src` and return it as a base64 `data:` URI, or `null` when it
 * cannot be inlined. Same-origin proxy URLs
 * (`/api/workspaces/:id/files/image?path=…`) inline reliably; cross-origin
 * remote URLs may reject the fetch (CORS), in which case the caller keeps the
 * original URL. Never throws. A `src` that is already a `data:` URI is returned
 * unchanged.
 */
export async function imageSrcToDataUri(src: string): Promise<string | null> {
    if (!src) return null;
    if (src.startsWith('data:')) return src;
    try {
        const resp = await fetch(src);
        if (!resp.ok) return null;
        const blob = await resp.blob();
        return await blobToDataUri(blob);
    } catch {
        return null;
    }
}

/**
 * Walk a cloned selection fragment, inline every `img.chat-inline-image` as a
 * base64 `data:` URI (falling back to the resolved absolute URL when the image
 * cannot be fetched), strip app-only attributes, and return the serialized
 * HTML. This is what lets inline images survive a paste into Word / Google
 * Docs / rich email, where relative proxy URLs are dropped. The passed fragment
 * is not mutated.
 */
export async function enrichSelectionHtmlWithInlineImages(fragment: DocumentFragment): Promise<string> {
    const container = document.createElement('div');
    container.appendChild(fragment.cloneNode(true));
    const images = Array.from(container.querySelectorAll('img.chat-inline-image')) as HTMLImageElement[];
    await Promise.all(images.map(async (img) => {
        const resolved = img.currentSrc || img.src || img.getAttribute('src') || '';
        const dataUri = await imageSrcToDataUri(resolved);
        // On success inline the data-URI; on failure keep the resolved
        // (absolute) URL so external editors at least have a URL to try.
        if (dataUri || resolved) img.setAttribute('src', dataUri || resolved);
        img.removeAttribute('onerror');
        img.removeAttribute('data-local-path');
        img.removeAttribute('loading');
        img.removeAttribute('class');
    }));
    return container.innerHTML;
}

/** Serialize a document fragment to an HTML string without mutating it. */
function serializeFragment(fragment: DocumentFragment): string {
    const container = document.createElement('div');
    container.appendChild(fragment.cloneNode(true));
    return container.innerHTML;
}

/**
 * Handle a native `copy` gesture over a rendered markdown preview so a mixed
 * text+image selection keeps its inline images when pasted into an external
 * rich-text app.
 *
 * Returns `null` when the selection is empty or contains no inline image — the
 * caller must NOT `preventDefault`, leaving the browser's normal copy intact
 * (no regression for plain-text/rich copies). When it returns a Promise the
 * handler has already:
 *   1. called `preventDefault()`, and
 *   2. written a synchronous best-effort `text/html` + `text/plain` fallback to
 *      `clipboardData` (un-inlined, but guarantees the clipboard has content).
 * The returned Promise performs the async upgrade — inline each image as a
 * `data:` URI and overwrite the clipboard via `navigator.clipboard.write`. It
 * resolves on success and rejects if the async write fails; callers should
 * attach a `.catch` (e.g. to surface a toast) to avoid an unhandled rejection.
 */
export function copySelectionWithInlineImages(
    selection: Selection | null,
    clipboardData: DataTransfer | null,
    preventDefault: () => void,
): Promise<void> | null {
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < selection.rangeCount; i++) {
        fragment.appendChild(selection.getRangeAt(i).cloneContents());
    }
    if (fragment.querySelectorAll('img.chat-inline-image').length === 0) return null;

    preventDefault();

    const text = selection.toString();
    const rawHtml = serializeFragment(fragment);
    if (clipboardData) {
        clipboardData.setData('text/html', rawHtml);
        clipboardData.setData('text/plain', text);
    }

    return enrichSelectionHtmlWithInlineImages(fragment).then(async (enrichedHtml) => {
        if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return;
        await navigator.clipboard.write([
            new ClipboardItem({
                'text/html': new Blob([enrichedHtml], { type: 'text/html' }),
                'text/plain': new Blob([text], { type: 'text/plain' }),
            }),
        ]);
    });
}

export function statusIcon(status: string): string {
    const map: Record<string, string> = { running: '\u{1F504}', cancelling: '\u{1F504}', completed: '\u2705', failed: '\u274C', cancelled: '\u{1F6AB}', queued: '\u23F3' };
    return map[status] || '';
}

export function statusLabel(status: string, type?: string): string {
    if (status === 'running' && type && type !== 'chat') return 'Running';
    const map: Record<string, string> = { running: 'Thinking', cancelling: 'Cancelling…', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', queued: 'Queued' };
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
        'dream-run': 'Dream Run',
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
        toolName?: string;
        name?: string;
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

/**
 * Convert an entire conversation to a self-contained HTML string suitable for
 * pasting into rich-text editors (email, Notion, Google Docs, etc.).
 *
 * @deprecated Use `snapshotConversation()` from `snapshot-copy-utils.ts` for
 * higher-fidelity DOM-based snapshots. This function is retained as a fallback
 * for contexts where a live DOM is not available (e.g., server-side rendering).
 *
 * @param turns       The conversation turns to render.
 * @param contentToHtml  Converts a single turn's markdown content to HTML.
 *                       Callers typically pass `(c) => chatMarkdownToHtml(c, wsId)`.
 * @param truncateAt  Max characters for tool-call args/result previews.
 */
export function formatConversationAsHtml(
    turns: ConversationTurnLike[],
    contentToHtml: (content: string) => string,
    truncateAt = 200,
): string {
    if (!turns || turns.length === 0) return '';

    const roleBadge = (role: string) => {
        const bg = role === 'user' ? '#e1f0ff' : '#f0f0f0';
        const color = role === 'user' ? '#005a9e' : '#1e1e1e';
        return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;background:${bg};color:${color};">${escapeHtml(role)}</span>`;
    };

    const sections = turns.map(turn => {
        const lines: string[] = [];
        lines.push(`<div style="margin-bottom:16px;">`);
        lines.push(`  <div style="margin-bottom:4px;">${roleBadge(turn.role)}</div>`);
        const html = contentToHtml(turn.content || '');
        if (html) {
            lines.push(`  <div style="padding-left:4px;">${html}</div>`);
        }
        if (turn.toolCalls && turn.toolCalls.length > 0) {
            lines.push(`  <div style="margin-top:8px;padding-left:4px;">`);
            for (const tc of turn.toolCalls) {
                const toolName = tc.toolName || tc.name || 'unknown';
                const argsJson = JSON.stringify(tc.args ?? {});
                const argsStr = escapeHtml(truncate(argsJson, truncateAt));
                lines.push(`    <div style="margin-bottom:4px;font-family:monospace;font-size:12px;background:#f6f6f6;border:1px solid #e0e0e0;border-radius:4px;padding:6px 8px;">`);
                lines.push(`      <strong style="color:#0078d4;">${escapeHtml(toolName)}</strong>`);
                lines.push(`      <span style="color:#666;"> args: ${argsStr}</span>`);
                if (tc.status === 'pending' || tc.status === 'running') {
                    lines.push(`      <span style="color:#848484;"> (${escapeHtml(tc.status)})</span>`);
                } else if (tc.error != null) {
                    lines.push(`      <br/><span style="color:#d32f2f;">error: ${escapeHtml(truncate(tc.error, truncateAt))}</span>`);
                } else if (tc.result != null) {
                    lines.push(`      <br/><span style="color:#333;">result: ${escapeHtml(truncate(tc.result, truncateAt))}</span>`);
                }
                lines.push(`    </div>`);
            }
            lines.push(`  </div>`);
        }
        lines.push(`</div>`);
        return lines.join('\n');
    });

    return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;">\n${sections.join('\n<hr style="border:none;border-top:1px solid #e0e0e0;margin:12px 0;"/>\n')}\n</div>`;
}

export function formatConversationAsText(turns: ConversationTurnLike[], truncateAt = 100): string {
    if (!turns || turns.length === 0) return '';
    return turns.map(turn => {
        const lines: string[] = [`[${turn.role}]`, turn.content];
        if (turn.toolCalls && turn.toolCalls.length > 0) {
            for (const tc of turn.toolCalls) {
                const argsJson = JSON.stringify(tc.args ?? {});
                const argsStr = truncate(argsJson, truncateAt);
                const toolName = tc.toolName || tc.name;
                if (tc.status === 'pending' || tc.status === 'running') {
                    lines.push(`[tool: ${toolName}] args: ${argsStr}`);
                } else if (tc.error != null) {
                    lines.push(`[tool: ${toolName}] args: ${argsStr} → error: ${truncate(tc.error, truncateAt)}`);
                } else {
                    const resultStr = tc.result != null ? truncate(tc.result, truncateAt) : '';
                    lines.push(`[tool: ${toolName}] args: ${argsStr} → result: ${resultStr}`);
                }
            }
        }
        return lines.join('\n');
    }).join('\n\n');
}
