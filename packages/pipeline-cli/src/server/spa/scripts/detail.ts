/**
 * Detail panel script: process detail rendering, inline markdown.
 */
export function getDetailScript(): string {
    return `
        // ================================================================
        // Detail Panel
        // ================================================================

        function renderDetail(id) {
            var process = appState.processes.find(function(p) { return p.id === id; });
            if (!process) { clearDetail(); return; }

            var emptyEl = document.getElementById('detail-empty');
            var contentEl = document.getElementById('detail-content');
            if (emptyEl) emptyEl.classList.add('hidden');
            if (!contentEl) return;
            contentEl.classList.remove('hidden');

            var duration = '';
            if (process.startTime) {
                var start = new Date(process.startTime).getTime();
                var end = process.endTime ? new Date(process.endTime).getTime() : Date.now();
                duration = formatDuration(end - start);
            }

            var html = '<div class="detail-header">' +
                '<h1>' + escapeHtmlClient(process.promptPreview || process.id || 'Process') + '</h1>' +
                '<span class="status-badge ' + (process.status || 'queued') + '">' +
                    statusIcon(process.status) + ' ' + statusLabel(process.status) +
                    (duration ? ' \\u00B7 ' + duration : '') +
                '</span>' +
            '</div>';

            // Metadata grid
            html += '<div class="meta-grid">';
            html += '<div class="meta-item"><label>Type</label><span>' + escapeHtmlClient(typeLabel(process.type)) + '</span></div>';
            if (process.workspaceId) {
                html += '<div class="meta-item"><label>Workspace</label><span>' + escapeHtmlClient(process.workspaceId) + '</span></div>';
            }
            if (process.metadata && process.metadata.backend) {
                html += '<div class="meta-item"><label>Backend</label><span>' + escapeHtmlClient(process.metadata.backend) + '</span></div>';
            }
            if (process.startTime) {
                html += '<div class="meta-item"><label>Started</label><span>' + new Date(process.startTime).toLocaleString() + '</span></div>';
            }
            if (process.endTime) {
                html += '<div class="meta-item"><label>Ended</label><span>' + new Date(process.endTime).toLocaleString() + '</span></div>';
            }
            html += '</div>';

            // Error section
            if (process.error) {
                html += '<div class="error-alert">' + escapeHtmlClient(process.error) + '</div>';
            }

            // Child process summary for group types
            var isGroup = process.type === 'code-review-group' || process.type === 'pipeline-execution';
            if (isGroup) {
                var children = appState.processes.filter(function(p) { return p.parentProcessId === id; });
                if (children.length > 0) {
                    html += '<div class="child-summary"><h2>Sub-processes (' + children.length + ')</h2>';
                    html += '<table class="child-table"><thead><tr><th>Status</th><th>Title</th><th>Type</th><th>Time</th></tr></thead><tbody>';
                    children.forEach(function(c) {
                        html += '<tr onclick="navigateToProcess(\\'' + escapeHtmlClient(c.id) + '\\')">' +
                            '<td>' + statusIcon(c.status) + '</td>' +
                            '<td>' + escapeHtmlClient((c.promptPreview || c.id || '').substring(0, 50)) + '</td>' +
                            '<td>' + escapeHtmlClient(typeLabel(c.type)) + '</td>' +
                            '<td>' + formatRelativeTime(c.startTime) + '</td></tr>';
                    });
                    html += '</tbody></table></div>';
                }
            }

            // Result section
            if (process.result) {
                html += '<div class="result-section"><h2>Result</h2>' +
                    '<div class="result-body">' + renderMarkdown(process.result) + '</div></div>';
            }

            if (process.structuredResult) {
                html += '<div class="result-section"><h2>Structured Result</h2>' +
                    '<div class="result-body"><pre><code>' +
                    escapeHtmlClient(JSON.stringify(process.structuredResult, null, 2)) +
                    '</code></pre></div></div>';
            }

            // Prompt section (collapsible)
            if (process.fullPrompt) {
                html += '<details class="prompt-section"><summary>Prompt</summary>' +
                    '<div class="prompt-body">' + escapeHtmlClient(process.fullPrompt) + '</div></details>';
            }

            // Action buttons
            html += '<div class="action-buttons">';
            if (process.result) {
                html += '<button class="action-btn" onclick="copyToClipboard(appState.processes.find(function(p){return p.id===\\'' +
                    escapeHtmlClient(id) + '\\'}).result||\\'\\')">' +
                    '\\u{1F4CB} Copy Result</button>';
            }
            html += '<button class="action-btn" onclick="copyToClipboard(location.origin+\\'/process/' +
                escapeHtmlClient(id) + '\\')">' +
                '\\u{1F517} Copy Link</button>';
            html += '</div>';

            contentEl.innerHTML = html;
        }

        function clearDetail() {
            var emptyEl = document.getElementById('detail-empty');
            var contentEl = document.getElementById('detail-content');
            if (emptyEl) emptyEl.classList.remove('hidden');
            if (contentEl) { contentEl.classList.add('hidden'); contentEl.innerHTML = ''; }
        }

        // ================================================================
        // Lightweight Markdown Renderer
        // ================================================================

        function renderMarkdown(text) {
            if (!text) return '';
            var lines = text.split('\\n');
            var html = '';
            var inCodeBlock = false;
            var codeLang = '';
            var codeContent = '';
            var inList = false;
            var listType = '';
            var inBlockquote = false;

            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];

                // Fenced code blocks
                if (line.match(/^\`\`\`/)) {
                    if (inCodeBlock) {
                        html += '<pre><code' + (codeLang ? ' class="language-' + codeLang + '"' : '') + '>' +
                            escapeHtmlClient(codeContent) + '</code></pre>';
                        inCodeBlock = false;
                        codeContent = '';
                        codeLang = '';
                    } else {
                        if (inList) { html += '</' + listType + '>'; inList = false; }
                        if (inBlockquote) { html += '</blockquote>'; inBlockquote = false; }
                        inCodeBlock = true;
                        codeLang = line.replace(/^\`\`\`/, '').trim();
                    }
                    continue;
                }
                if (inCodeBlock) {
                    codeContent += (codeContent ? '\\n' : '') + line;
                    continue;
                }

                // Horizontal rule
                if (line.match(/^---+$/)) {
                    if (inList) { html += '</' + listType + '>'; inList = false; }
                    if (inBlockquote) { html += '</blockquote>'; inBlockquote = false; }
                    html += '<hr>';
                    continue;
                }

                // Headers
                var headerMatch = line.match(/^(#{1,4})\\s+(.+)$/);
                if (headerMatch) {
                    if (inList) { html += '</' + listType + '>'; inList = false; }
                    if (inBlockquote) { html += '</blockquote>'; inBlockquote = false; }
                    var level = headerMatch[1].length;
                    html += '<h' + level + '>' + inlineFormat(headerMatch[2]) + '</h' + level + '>';
                    continue;
                }

                // Blockquote
                if (line.match(/^>\\s?/)) {
                    if (inList) { html += '</' + listType + '>'; inList = false; }
                    if (!inBlockquote) { html += '<blockquote>'; inBlockquote = true; }
                    html += inlineFormat(line.replace(/^>\\s?/, '')) + '<br>';
                    continue;
                } else if (inBlockquote) {
                    html += '</blockquote>';
                    inBlockquote = false;
                }

                // Unordered list
                if (line.match(/^[\\-\\*]\\s+/)) {
                    if (inList && listType !== 'ul') { html += '</' + listType + '>'; inList = false; }
                    if (!inList) { html += '<ul>'; inList = true; listType = 'ul'; }
                    html += '<li>' + inlineFormat(line.replace(/^[\\-\\*]\\s+/, '')) + '</li>';
                    continue;
                }

                // Ordered list
                var olMatch = line.match(/^\\d+\\.\\s+(.+)$/);
                if (olMatch) {
                    if (inList && listType !== 'ol') { html += '</' + listType + '>'; inList = false; }
                    if (!inList) { html += '<ol>'; inList = true; listType = 'ol'; }
                    html += '<li>' + inlineFormat(olMatch[1]) + '</li>';
                    continue;
                }

                // End list if line doesn't match
                if (inList) { html += '</' + listType + '>'; inList = false; }

                // Blank line = paragraph break
                if (line.trim() === '') {
                    html += '<br>';
                    continue;
                }

                // Normal paragraph text
                html += '<p>' + inlineFormat(line) + '</p>';
            }

            // Close any open blocks
            if (inCodeBlock) {
                html += '<pre><code>' + escapeHtmlClient(codeContent) + '</code></pre>';
            }
            if (inList) html += '</' + listType + '>';
            if (inBlockquote) html += '</blockquote>';

            return html;
        }

        function inlineFormat(text) {
            // Inline code (before other formatting)
            text = text.replace(/\`([^\`]+)\`/g, function(m, c) {
                return '<code>' + escapeHtmlClient(c) + '</code>';
            });
            // Bold
            text = text.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
            // Italic
            text = text.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
            // Links
            text = text.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
            return text;
        }
`;
}
