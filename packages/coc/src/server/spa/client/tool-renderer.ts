/**
 * Tool call renderer component.
 *
 * Renders individual tool calls as collapsible cards with status indicators,
 * syntax-highlighted arguments/results, and timing information.
 */

import type { ClientToolCall } from './state';
import { escapeHtmlClient } from './utils';

/* ── Icon mappings ────────────────────────────────────────── */

const TOOL_ICONS: Record<string, string> = {
    view: '\u{1F4C4}',   // 📄
    grep: '\u{1F50D}',   // 🔍
    bash: '\u{1F4BB}',   // 💻
    edit: '\u270F\uFE0F', // ✏️
    create: '\u{1F4DD}', // 📝
    glob: '\u{1F4C2}',   // 📂
};
const DEFAULT_TOOL_ICON = '\u{1F527}'; // 🔧

const STATUS_ICONS: Record<string, string> = {
    pending: '\u23F3',  // ⏳
    running: '\u2699\uFE0F',  // ⚙️
    completed: '\u2705', // ✅
    failed: '\u274C',    // ❌
};

const MAX_RESULT_LENGTH = 5000;
const TRUNCATED_LENGTH = 4900;

/* ── Duration formatting ──────────────────────────────────── */

function formatToolDuration(startTime?: string, endTime?: string): string {
    if (!startTime) return '';
    const start = new Date(startTime).getTime();
    const end = endTime ? new Date(endTime).getTime() : Date.now();
    const ms = end - start;
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
}

/* ── Syntax highlighting (simple regex) ───────────────────── */

function highlightJSON(text: string): string {
    const escaped = escapeHtmlClient(text);
    return escaped
        .replace(/"([^"\\]*(\\.[^"\\]*)*)"\s*:/g, '<span class="json-key">"$1"</span>:')
        .replace(/:\s*"([^"\\]*(\\.[^"\\]*)*)"/g, ': <span class="json-string">"$1"</span>')
        .replace(/:\s*(\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
        .replace(/:\s*(true|false|null)/g, ': <span class="json-boolean">$1</span>');
}

function highlightBash(text: string): string {
    const escaped = escapeHtmlClient(text);
    return escaped
        .replace(/^(\$\s*)(\S+)/gm, '$1<span class="bash-command">$2</span>')
        .replace(/(\s)(--?\w[\w-]*)/g, '$1<span class="bash-flag">$2</span>')
        .replace(/(\/[\w./-]+)/g, '<span class="bash-path">$1</span>');
}

function detectLanguage(toolName: string): string {
    if (toolName === 'bash') return 'bash';
    return 'text';
}

function highlightCode(text: string, language: string): string {
    if (language === 'json') return highlightJSON(text);
    if (language === 'bash') return highlightBash(text);
    return escapeHtmlClient(text);
}

/* ── Render helpers ───────────────────────────────────────── */

function formatArgsString(args: any): string {
    if (!args) return '';
    try {
        return typeof args === 'string' ? args : JSON.stringify(args, null, 2);
    } catch {
        return String(args);
    }
}

function buildArgsHTML(args: any): string {
    const argsStr = formatArgsString(args);
    if (!argsStr) return '';
    return '<div class="tool-call-section">' +
        '<div class="tool-call-section-label">Arguments</div>' +
        '<pre><code class="language-json">' + highlightJSON(argsStr) + '</code></pre>' +
        '</div>';
}

function buildResultHTML(result: string | undefined, toolName: string): string {
    if (result == null || result === '') return '';
    const lang = detectLanguage(toolName);
    const isTruncated = result.length > MAX_RESULT_LENGTH;
    const displayText = isTruncated ? result.slice(0, TRUNCATED_LENGTH) : result;
    let html = '<div class="tool-call-section">' +
        '<div class="tool-call-section-label">Result</div>' +
        '<pre><code class="language-' + lang + '">' + highlightCode(displayText, lang) + '</code></pre>';
    if (isTruncated) {
        html += '<div class="tool-call-truncated">... (output truncated)' +
            '<button class="tool-call-expand-btn">Show full output</button></div>';
    }
    html += '</div>';
    return html;
}

/* ── Public API ────────────────────────────────────────────── */

/**
 * Normalize a server-side tool call (which uses `name`) to the client-side
 * `ClientToolCall` shape (which uses `toolName`).  Accepts either format
 * and always returns a well-formed `ClientToolCall`.
 */
export function normalizeToolCall(raw: any): ClientToolCall {
    return {
        id: raw.id || '',
        toolName: raw.toolName || raw.name || 'unknown',
        args: raw.args || raw.parameters || {},
        result: raw.result,
        status: raw.status || 'pending',
        startTime: raw.startTime,
        endTime: raw.endTime,
    };
}

/**
 * Render a tool call as a collapsible card HTML string.
 * Returns the outer HTML so it can be embedded in chat bubbles.
 *
 * Accepts both server-side (`name`) and client-side (`toolName`) shapes —
 * the input is normalised before rendering.
 */
export function renderToolCallHTML(toolCall: ClientToolCall | any): string {
    const tc = normalizeToolCall(toolCall);
    const icon = TOOL_ICONS[tc.toolName] || DEFAULT_TOOL_ICON;
    const statusIcon = STATUS_ICONS[tc.status] || '';
    const duration = formatToolDuration(tc.startTime, tc.endTime);

    let html = '<div class="tool-call-card" data-tool-id="' + escapeHtmlClient(tc.id) + '" data-status="' + tc.status + '">';

    // Header
    html += '<div class="tool-call-header">';
    html += '<span class="tool-call-icon">' + icon + '</span>';
    html += '<span class="tool-call-name">' + escapeHtmlClient(tc.toolName) + '</span>';
    html += '<span class="tool-call-status ' + tc.status + '">' + statusIcon + ' ' + tc.status + '</span>';
    if (duration) {
        html += '<span class="tool-call-duration">' + duration + '</span>';
    }
    html += '<button class="tool-call-toggle" aria-label="Expand tool details">\u25BC</button>';
    html += '</div>';

    // Body (collapsed by default)
    html += '<div class="tool-call-body collapsed">';
    html += buildArgsHTML(tc.args);
    html += buildResultHTML(tc.result, tc.toolName);
    html += '</div>';

    html += '</div>';
    return html;
}

/**
 * Render a tool call and return a live DOM element with toggle behavior attached.
 */
export function renderToolCall(toolCall: ClientToolCall | any): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderToolCallHTML(toolCall);
    const card = wrapper.firstElementChild as HTMLElement;
    attachToggleBehavior(card);
    return card;
}

/**
 * Update an existing tool-call card element with new status/result data.
 * Preserves expanded/collapsed state.
 */
export function updateToolCallStatus(element: HTMLElement, toolCall: ClientToolCall | any): void {
    const tc = normalizeToolCall(toolCall);

    // Update data-status attribute
    element.setAttribute('data-status', tc.status);

    // Update status badge
    const statusEl = element.querySelector('.tool-call-status');
    if (statusEl) {
        statusEl.className = 'tool-call-status ' + tc.status;
        const statusIcon = STATUS_ICONS[tc.status] || '';
        statusEl.textContent = statusIcon + ' ' + tc.status;
    }

    // Update duration
    const durationEl = element.querySelector('.tool-call-duration');
    const duration = formatToolDuration(tc.startTime, tc.endTime);
    if (durationEl) {
        durationEl.textContent = duration;
    } else if (duration) {
        const header = element.querySelector('.tool-call-header');
        const toggle = element.querySelector('.tool-call-toggle');
        if (header && toggle) {
            const span = document.createElement('span');
            span.className = 'tool-call-duration';
            span.textContent = duration;
            header.insertBefore(span, toggle);
        }
    }

    // Update result in body (preserve collapse state)
    const body = element.querySelector('.tool-call-body');
    if (body && tc.result != null) {
        const existingResult = body.querySelector('.tool-call-section:last-child');
        const resultLabel = existingResult?.querySelector('.tool-call-section-label');
        if (resultLabel && resultLabel.textContent === 'Result') {
            // Replace existing result section
            existingResult!.outerHTML = buildResultHTML(tc.result, tc.toolName);
        } else {
            // Append new result section
            const temp = document.createElement('div');
            temp.innerHTML = buildResultHTML(tc.result, tc.toolName);
            if (temp.firstElementChild) body.appendChild(temp.firstElementChild);
        }
        // Reattach truncation expand button if present
        attachTruncationBehavior(element, tc.result);
    }
}

/* ── Toggle behavior ──────────────────────────────────────── */

function attachToggleBehavior(card: HTMLElement): void {
    const header = card.querySelector('.tool-call-header');
    const body = card.querySelector('.tool-call-body');
    const toggle = card.querySelector('.tool-call-toggle');
    if (!header || !body || !toggle) return;

    header.addEventListener('click', function () {
        const isCollapsed = body.classList.contains('collapsed');
        if (isCollapsed) {
            body.classList.remove('collapsed');
            toggle.textContent = '\u25B2'; // ▲
            toggle.setAttribute('aria-label', 'Collapse tool details');
        } else {
            body.classList.add('collapsed');
            toggle.textContent = '\u25BC'; // ▼
            toggle.setAttribute('aria-label', 'Expand tool details');
        }
    });

    // Truncation expand behavior
    const resultSection = card.querySelector('.tool-call-section:last-child');
    if (resultSection) {
        const expandBtn = resultSection.querySelector('.tool-call-expand-btn');
        if (expandBtn) {
            expandBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                // We don't have the full text on initial render; handled in attachTruncationBehavior
            });
        }
    }
}

function attachTruncationBehavior(card: HTMLElement, fullResult: string): void {
    const expandBtn = card.querySelector('.tool-call-expand-btn');
    if (!expandBtn || !fullResult || fullResult.length <= MAX_RESULT_LENGTH) return;

    const codeEl = expandBtn.closest('.tool-call-section')?.querySelector('code');
    if (!codeEl) return;

    expandBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        const lang = detectLanguage(card.querySelector('.tool-call-name')?.textContent || '');
        codeEl.innerHTML = highlightCode(fullResult, lang);
        const truncDiv = expandBtn.closest('.tool-call-truncated');
        if (truncDiv) truncDiv.remove();
    });
}

/**
 * Attach toggle behavior to all tool-call cards within a container.
 * Call after setting innerHTML that contains tool-call-card elements.
 */
export function attachToolCallToggleHandlers(container: HTMLElement): void {
    const cards = container.querySelectorAll('.tool-call-card');
    for (let i = 0; i < cards.length; i++) {
        attachToggleBehavior(cards[i] as HTMLElement);
    }
}
