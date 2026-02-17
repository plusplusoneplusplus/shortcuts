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
    skill: '\u{1F3AF}',  // 🎯
    task: '\u{1F916}',   // 🤖
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

function buildBashArgsHTML(args: any): string {
    if (!args || typeof args !== 'object') return '';
    let html = '';
    // Show description as a readable label if present
    if (args.description) {
        html += '<div class="tool-call-section">' +
            '<div class="tool-call-section-label">Description</div>' +
            '<div class="tool-call-description">' + escapeHtmlClient(String(args.description)) + '</div>' +
            '</div>';
    }
    // Show command in a bash-highlighted code block
    if (args.command) {
        html += '<div class="tool-call-section">' +
            '<div class="tool-call-section-label">Command</div>' +
            '<pre><code class="language-bash">' + highlightBash('$ ' + String(args.command)) + '</code></pre>' +
            '</div>';
    }
    // Show remaining args (excluding command/description) as JSON if any
    const rest: Record<string, any> = {};
    for (const key of Object.keys(args)) {
        if (key !== 'command' && key !== 'description') {
            rest[key] = args[key];
        }
    }
    if (Object.keys(rest).length > 0) {
        const restStr = JSON.stringify(rest, null, 2);
        html += '<div class="tool-call-section">' +
            '<div class="tool-call-section-label">Options</div>' +
            '<pre><code class="language-json">' + highlightJSON(restStr) + '</code></pre>' +
            '</div>';
    }
    return html;
}

function buildArgsHTML(args: any, toolName?: string): string {
    if (toolName === 'bash') return buildBashArgsHTML(args);
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

/* ── Tool summary extraction ─────────────────────────────── */

/**
 * Convert an absolute path to a short relative-looking path.
 * Strips common home-dir and project prefixes so
 * `/Users/foo/Documents/Projects/bar/src/file.ts` becomes `bar/src/file.ts`.
 */
function shortenPath(p: string): string {
    if (!p) return '';
    // Strip /Users/<user>/Documents/Projects/ or /home/<user>/
    const shortened = p
        .replace(/^\/Users\/[^/]+\/Documents\/Projects\//, '')
        .replace(/^\/Users\/[^/]+\//, '~/')
        .replace(/^\/home\/[^/]+\//, '~/');
    return shortened;
}

/**
 * Extract a one-line summary string from tool args for display in the header.
 * Returns empty string if no meaningful summary can be produced.
 */
function getToolSummary(toolName: string, args: any): string {
    if (!args || typeof args !== 'object') return '';

    switch (toolName) {
        case 'grep': {
            const parts: string[] = [];
            if (args.pattern) parts.push('/' + args.pattern + '/');
            if (args.path) parts.push(shortenPath(args.path));
            else if (args.glob) parts.push(args.glob);
            return parts.join(' in ');
        }
        case 'view': {
            let p = '';
            if (args.path) p = shortenPath(args.path);
            else if (args.filePath) p = shortenPath(args.filePath);
            if (p && args.view_range && Array.isArray(args.view_range) && args.view_range.length >= 2) {
                p += ' L' + args.view_range[0] + '-L' + args.view_range[1];
            }
            return p;
        }
        case 'edit': {
            if (args.path) return shortenPath(args.path);
            if (args.filePath) return shortenPath(args.filePath);
            return '';
        }
        case 'create': {
            if (args.path) return shortenPath(args.path);
            if (args.filePath) return shortenPath(args.filePath);
            return '';
        }
        case 'bash': {
            if (args.command) {
                const cmd = String(args.command).trim();
                return cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd;
            }
            return '';
        }
        case 'glob': {
            const parts: string[] = [];
            if (args.pattern) parts.push(args.pattern);
            else if (args.glob_pattern) parts.push(args.glob_pattern);
            if (args.path) parts.push('in ' + shortenPath(args.path));
            return parts.join(' ');
        }
        case 'skill': {
            if (args.name) return args.name;
            if (args.skill_name) return args.skill_name;
            return '';
        }
        case 'task': {
            const parts: string[] = [];
            if (args.agent_type) parts.push('[' + args.agent_type + ']');
            if (args.description) parts.push(args.description);
            else if (args.prompt) {
                const prompt = String(args.prompt).trim();
                parts.push(prompt.length > 60 ? prompt.slice(0, 57) + '...' : prompt);
            }
            return parts.join(' ');
        }
        default: {
            // Generic: show first string arg that looks like a path or pattern
            for (const key of ['path', 'filePath', 'file', 'pattern', 'query', 'command', 'url']) {
                if (typeof args[key] === 'string' && args[key]) {
                    const val = args[key];
                    if (val.startsWith('/')) return shortenPath(val);
                    return val.length > 60 ? val.slice(0, 57) + '...' : val;
                }
            }
            return '';
        }
    }
}

/* ── Grouping ─────────────────────────────────────────────── */

/** Tools eligible for grouping when they target the same file. */
const GROUPABLE_TOOLS = new Set(['view', 'grep', 'edit']);

/**
 * Return a grouping key for consecutive tool calls.
 * Calls with the same key are collapsed into one group card.
 * Returns empty string for non-groupable tools.
 */
function getToolGroupKey(tc: ClientToolCall): string {
    if (!GROUPABLE_TOOLS.has(tc.toolName)) return '';
    const args = tc.args;
    if (!args || typeof args !== 'object') return '';
    const filePath = args.path || args.filePath || '';
    if (!filePath) return '';
    return tc.toolName + ':' + filePath;
}

/**
 * Extract a short label for an individual item inside a group.
 * For view: "L1-L100"; for grep: "/pattern/"; for edit: line info.
 */
function getGroupItemLabel(tc: ClientToolCall): string {
    const args = tc.args;
    if (!args) return '';
    if (tc.toolName === 'view') {
        if (args.view_range && Array.isArray(args.view_range) && args.view_range.length >= 2) {
            return 'L' + args.view_range[0] + '-L' + args.view_range[1];
        }
        return 'full file';
    }
    if (tc.toolName === 'grep') {
        return args.pattern ? '/' + args.pattern + '/' : '';
    }
    if (tc.toolName === 'edit') {
        if (args.old_str || args.old_string) {
            const snippet = String(args.old_str || args.old_string).trim();
            return snippet.length > 40 ? snippet.slice(0, 37) + '...' : snippet;
        }
        return '';
    }
    return '';
}

/** Render a grouped tool call card containing multiple sub-items. */
function renderGroupHTML(calls: ClientToolCall[]): string {
    const first = calls[0];
    const icon = TOOL_ICONS[first.toolName] || DEFAULT_TOOL_ICON;
    const filePath = first.args?.path || first.args?.filePath || '';
    const shortPath = shortenPath(filePath);

    // Aggregate status: running if any running, failed if any failed, else completed
    let groupStatus = 'completed';
    for (const c of calls) {
        if (c.status === 'running') { groupStatus = 'running'; break; }
        if (c.status === 'failed') groupStatus = 'failed';
    }
    const sIcon = STATUS_ICONS[groupStatus] || '';

    // Total duration: first start to last end
    let totalDuration = '';
    const starts = calls.filter(c => c.startTime).map(c => new Date(c.startTime!).getTime());
    const ends = calls.filter(c => c.endTime).map(c => new Date(c.endTime!).getTime());
    if (starts.length > 0) {
        const start = Math.min(...starts);
        const end = ends.length > 0 ? Math.max(...ends) : Date.now();
        const ms = end - start;
        totalDuration = ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's';
    }

    // Build sub-item labels
    const labels: string[] = [];
    for (const c of calls) {
        labels.push(getGroupItemLabel(c));
    }
    const rangesSummary = labels.filter(Boolean).join(', ');

    let html = '<div class="tool-call-card tool-call-group" data-status="' + groupStatus + '">';

    // Group header
    html += '<div class="tool-call-header">';
    html += '<span class="tool-call-icon">' + icon + '</span>';
    html += '<span class="tool-call-name">' + escapeHtmlClient(first.toolName) + '</span>';
    html += '<span class="tool-call-group-count">' + calls.length + '\u00D7</span>';
    html += '<span class="tool-call-summary">' + escapeHtmlClient(shortPath);
    if (rangesSummary) {
        html += ' <span class="tool-call-ranges">' + escapeHtmlClient(rangesSummary) + '</span>';
    }
    html += '</span>';
    html += '<span class="tool-call-status ' + groupStatus + '">' + sIcon + ' ' + groupStatus + '</span>';
    if (totalDuration) {
        html += '<span class="tool-call-duration">' + totalDuration + '</span>';
    }
    html += '<button class="tool-call-toggle" aria-label="Expand tool details">\u25BC</button>';
    html += '</div>';

    // Group body: individual cards inside
    html += '<div class="tool-call-body collapsed">';
    for (const c of calls) {
        const label = getGroupItemLabel(c);
        const dur = formatToolDuration(c.startTime, c.endTime);
        const si = STATUS_ICONS[c.status] || '';

        html += '<div class="tool-call-group-item" data-tool-id="' + escapeHtmlClient(c.id) + '">';
        html += '<div class="tool-call-group-item-header">';
        html += '<span class="tool-call-group-item-label">' + escapeHtmlClient(label || first.toolName) + '</span>';
        html += '<span class="tool-call-status ' + c.status + '">' + si + '</span>';
        if (dur) html += '<span class="tool-call-duration">' + dur + '</span>';
        html += '</div>';

        // Expandable detail for each sub-item
        html += '<details class="tool-call-group-item-detail">';
        html += '<summary>Details</summary>';
        html += buildArgsHTML(c.args, c.toolName);
        html += buildResultHTML(c.result, c.toolName);
        html += '</details>';

        html += '</div>';
    }
    html += '</div>';

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

    // Header — tool name + inline summary
    const summary = getToolSummary(tc.toolName, tc.args);
    html += '<div class="tool-call-header">';
    html += '<span class="tool-call-icon">' + icon + '</span>';
    html += '<span class="tool-call-name">' + escapeHtmlClient(tc.toolName) + '</span>';
    if (summary) {
        html += '<span class="tool-call-summary">' + escapeHtmlClient(summary) + '</span>';
    }
    html += '<span class="tool-call-status ' + tc.status + '">' + statusIcon + ' ' + tc.status + '</span>';
    if (duration) {
        html += '<span class="tool-call-duration">' + duration + '</span>';
    }
    html += '<button class="tool-call-toggle" aria-label="Expand tool details">\u25BC</button>';
    html += '</div>';

    // Body (collapsed by default)
    html += '<div class="tool-call-body collapsed">';
    html += buildArgsHTML(tc.args, tc.toolName);
    html += buildResultHTML(tc.result, tc.toolName);
    html += '</div>';

    html += '</div>';
    return html;
}

/**
 * Render an array of tool calls with grouping support.
 * Consecutive calls of the same type targeting the same file are collapsed
 * into a single group card. Non-groupable or singleton calls render normally.
 */
export function renderToolCallsHTML(toolCalls: Array<ClientToolCall | any>): string {
    if (!toolCalls || toolCalls.length === 0) return '';

    const normalized = toolCalls.map(normalizeToolCall);
    let html = '';
    let i = 0;

    while (i < normalized.length) {
        const tc = normalized[i];
        const key = getToolGroupKey(tc);

        if (!key) {
            // Non-groupable: render individually
            html += renderToolCallHTML(tc);
            i++;
            continue;
        }

        // Collect consecutive calls with the same group key
        const group: ClientToolCall[] = [tc];
        let j = i + 1;
        while (j < normalized.length && getToolGroupKey(normalized[j]) === key) {
            group.push(normalized[j]);
            j++;
        }

        if (group.length === 1) {
            // Only one in the group — render normally
            html += renderToolCallHTML(tc);
        } else {
            html += renderGroupHTML(group);
        }
        i = j;
    }

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
