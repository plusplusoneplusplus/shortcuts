/**
 * Review Markdown Renderer — browser-compatible markdown-to-HTML converter
 *
 * Ported from src/shortcuts/markdown-comments/webview-logic/markdown-renderer.ts.
 * Pure functions — no Node.js or VS Code dependencies.
 */

// ============================================================================
// HTML Escaping
// ============================================================================

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ============================================================================
// Anchor ID Generation
// ============================================================================

export function generateAnchorId(text: string): string {
    if (!text) return '';
    return text
        .toLowerCase()
        .replace(/[*_~`]/g, '')
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .trim();
}

// ============================================================================
// Inline Markdown
// ============================================================================

function resolveImagePath(src: string, apiBase: string): string {
    if (/^(https?:|data:)/.test(src)) return src;
    return `${apiBase}/review/images/${encodeURIComponent(src)}`;
}

export function applyInlineMarkdown(text: string, apiBase: string = '/api'): string {
    if (!text) return '';
    let html = escapeHtml(text);

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<span class="md-inline-code">`$1`</span>');

    // Images
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, src: string) => {
        const resolved = resolveImagePath(src, apiBase);
        const escapedAlt = alt || 'Image';
        return `<img class="md-image-preview" src="${resolved}" alt="${escapeHtml(escapedAlt)}" loading="lazy" onerror="this.style.display='none'" style="max-width:100%;max-height:400px;">`;
    });

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, linkText: string, url: string) => {
        const isAnchorLink = url.startsWith('#');
        const linkClass = isAnchorLink ? 'md-link md-anchor-link' : 'md-link';
        const target = isAnchorLink ? '' : ' target="_blank" rel="noopener"';
        return `<a class="${linkClass}" href="${escapeHtml(url)}"${target}>${linkText}</a>`;
    });

    // Bold + Italic
    html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/(?<=^|[\s(]|\&gt;)_([^_\s][^_]*[^_\s]|[^_\s])_(?=$|[\s.,;:!?)\]]|\&lt;)/g, '<em>$1</em>');

    // Strikethrough
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    return html;
}

// ============================================================================
// Source Mode Highlighting (syntax-visible, no rendering)
// ============================================================================

export function applySourceModeHighlighting(
    line: string,
    inCodeBlock: boolean
): { html: string; inCodeBlock: boolean } {
    const cleanLine = line.replace(/\r$/, '');

    if (cleanLine.match(/^[ \t]*```/)) {
        return {
            html: '<span class="src-code-fence">' + escapeHtml(cleanLine) + '</span>',
            inCodeBlock: !inCodeBlock
        };
    }

    if (inCodeBlock) {
        return { html: escapeHtml(cleanLine), inCodeBlock: true };
    }

    let html = escapeHtml(cleanLine);

    // Headings
    const headingMatch = cleanLine.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
        const level = headingMatch[1].length;
        return {
            html: `<span class="src-h${level}">${html}</span>`,
            inCodeBlock: false
        };
    }

    // Horizontal rule
    if (/^(---+|\*\*\*+|___+)\s*$/.test(cleanLine)) {
        return { html: '<span class="src-hr">' + html + '</span>', inCodeBlock: false };
    }

    // Blockquotes
    if (/^>\s*/.test(cleanLine)) {
        return { html: '<span class="src-blockquote">' + html + '</span>', inCodeBlock: false };
    }

    return { html, inCodeBlock: false };
}

// ============================================================================
// Line-by-line Markdown Rendering
// ============================================================================

export interface MarkdownLineResult {
    html: string;
    inCodeBlock: boolean;
    codeBlockLang: string | null;
    isCodeFenceStart?: boolean;
    isCodeFenceEnd?: boolean;
    anchorId?: string;
}

export function applyMarkdownHighlighting(
    line: string,
    lineNum: number,
    inCodeBlock: boolean,
    codeBlockLang: string | null,
    apiBase: string = '/api'
): MarkdownLineResult {
    const cleanLine = line.replace(/\r$/, '');

    // Inside code block — just escape
    if (inCodeBlock && !cleanLine.match(/^[ \t]*```/)) {
        return { html: escapeHtml(cleanLine), inCodeBlock: true, codeBlockLang };
    }

    // Code fence
    const codeFenceMatch = cleanLine.match(/^[ \t]*```(\w*)/);
    if (codeFenceMatch) {
        if (!inCodeBlock) {
            return {
                html: '', // will be handled by code block renderer
                inCodeBlock: true,
                codeBlockLang: codeFenceMatch[1] || 'plaintext',
                isCodeFenceStart: true
            };
        } else {
            return {
                html: '',
                inCodeBlock: false,
                codeBlockLang: null,
                isCodeFenceEnd: true
            };
        }
    }

    let html = escapeHtml(cleanLine);

    // Horizontal rule
    if (/^(---+|\*\*\*+|___+)\s*$/.test(cleanLine)) {
        return { html: '<hr class="md-hr">', inCodeBlock: false, codeBlockLang: null };
    }

    // Headings
    const headingMatch = cleanLine.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
        const level = headingMatch[1].length;
        const headingText = headingMatch[2];
        const content = applyInlineMarkdown(headingText, apiBase);
        const anchorId = generateAnchorId(headingText);
        html = `<h${level} id="${anchorId}" class="md-heading">${content}</h${level}>`;
        return { html, inCodeBlock: false, codeBlockLang: null, anchorId };
    }

    // Blockquotes
    if (/^>\s*/.test(cleanLine)) {
        const content = cleanLine.replace(/^>\s*/, '');
        html = `<blockquote class="md-blockquote">${applyInlineMarkdown(content, apiBase)}</blockquote>`;
        return { html, inCodeBlock: false, codeBlockLang: null };
    }

    // Unordered list items
    const ulMatch = cleanLine.match(/^(\s*)([-*+])\s+(.*)$/);
    if (ulMatch) {
        let content = ulMatch[3];
        const checkboxMatch = content.match(/^\[([ xX~])\]\s*(.*)$/);
        if (checkboxMatch) {
            const checkChar = checkboxMatch[1].toLowerCase();
            const checked = checkChar === 'x' ? ' checked disabled' : ' disabled';
            const inProgress = checkChar === '~' ? ' class="in-progress"' : '';
            content = `<input type="checkbox"${checked}${inProgress}> ${applyInlineMarkdown(checkboxMatch[2], apiBase)}`;
        } else {
            content = applyInlineMarkdown(content, apiBase);
        }
        html = `<li class="md-list-item">${content}</li>`;
        return { html, inCodeBlock: false, codeBlockLang: null };
    }

    // Ordered list items
    const olMatch = cleanLine.match(/^(\s*)(\d+\.)\s+(.*)$/);
    if (olMatch) {
        const content = applyInlineMarkdown(olMatch[3], apiBase);
        html = `<li class="md-list-item md-list-ordered">${content}</li>`;
        return { html, inCodeBlock: false, codeBlockLang: null };
    }

    // Regular text
    html = applyInlineMarkdown(cleanLine, apiBase);
    return { html, inCodeBlock: false, codeBlockLang: null };
}

// ============================================================================
// Full Document Rendering
// ============================================================================

interface CodeBlock {
    lang: string;
    lines: string[];
    startLine: number;
    endLine: number;
}

/**
 * Render full markdown content to HTML.
 * Returns structured HTML with line numbers and code block highlighting.
 */
export function renderMarkdownContent(
    content: string,
    apiBase: string = '/api'
): string {
    const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalizedContent.split('\n');

    let html = '';
    let inCodeBlock = false;
    let codeBlockLang: string | null = null;
    let codeBlockLines: string[] = [];
    let codeBlockStart = 0;

    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const line = lines[i];

        const result = applyMarkdownHighlighting(line, lineNum, inCodeBlock, codeBlockLang, apiBase);

        if (result.isCodeFenceStart) {
            inCodeBlock = true;
            codeBlockLang = result.codeBlockLang;
            codeBlockLines = [];
            codeBlockStart = lineNum;
            continue;
        }

        if (result.isCodeFenceEnd) {
            // Render the accumulated code block
            html += renderCodeBlockHtml(codeBlockLang || 'plaintext', codeBlockLines, codeBlockStart);
            inCodeBlock = false;
            codeBlockLang = null;
            codeBlockLines = [];
            continue;
        }

        if (inCodeBlock) {
            codeBlockLines.push(line);
            continue;
        }

        // Wrap line in a div for line tracking
        if (line.trim() === '') {
            html += `<div class="review-line" data-line="${lineNum}"><br></div>`;
        } else {
            html += `<div class="review-line" data-line="${lineNum}">${result.html}</div>`;
        }
    }

    // Handle unclosed code block
    if (inCodeBlock && codeBlockLines.length > 0) {
        html += renderCodeBlockHtml(codeBlockLang || 'plaintext', codeBlockLines, codeBlockStart);
    }

    return html;
}

/**
 * Render a code block with language label and line numbers.
 * Uses highlight.js if available in the browser.
 */
function renderCodeBlockHtml(lang: string, lines: string[], startLine: number): string {
    const code = lines.join('\n');
    const escapedCode = escapeHtml(code);
    const langLabel = lang !== 'plaintext' ? lang : '';

    // The highlight.js highlighting will be applied after DOM insertion via hljs.highlightAll()
    const header = langLabel
        ? `<div class="review-code-header"><span class="review-code-lang">${escapeHtml(langLabel)}</span><span class="review-code-lines">${lines.length} line${lines.length !== 1 ? 's' : ''}</span></div>`
        : '';

    return `<div class="review-code-block" data-start-line="${startLine}" data-end-line="${startLine + lines.length}">` +
        header +
        `<pre><code class="language-${escapeHtml(lang)}">${escapedCode}</code></pre>` +
        `</div>`;
}

/**
 * Render content in source mode — plain text with syntax highlighting markers.
 */
export function renderSourceContent(content: string): string {
    const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalizedContent.split('\n');
    let html = '';
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const line = lines[i];
        const result = applySourceModeHighlighting(line, inCodeBlock);
        inCodeBlock = result.inCodeBlock;

        const lineHtml = line.length === 0 ? '<br>' : result.html;
        html += `<div class="review-line source-mode" data-line="${lineNum}">` +
            `<span class="review-line-number">${lineNum}</span>` +
            `<span class="review-line-content">${lineHtml}</span>` +
            `</div>`;
    }

    return html;
}

// ============================================================================
// Comment Highlighting
// ============================================================================

export interface CommentHighlight {
    id: string;
    status: string;
    type?: string;
    selectedText?: string;
    comment: string;
    selection: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
        selectedText?: string;
    };
}

/**
 * Apply comment highlighting to rendered HTML.
 * Wraps commented text ranges with highlight spans.
 */
export function applyCommentHighlights(
    container: HTMLElement,
    comments: CommentHighlight[]
): void {
    if (!comments || comments.length === 0) return;

    const activeComments = comments.filter(c => c.status !== 'resolved');
    const resolvedComments = comments.filter(c => c.status === 'resolved');

    // Apply highlights: active first, then resolved (so active overlaps resolved)
    for (const comment of [...resolvedComments, ...activeComments]) {
        const sel = comment.selection;
        if (!sel) continue;

        for (let lineNum = sel.startLine; lineNum <= sel.endLine; lineNum++) {
            const lineEl = container.querySelector(`.review-line[data-line="${lineNum}"]`);
            if (!lineEl) continue;

            // Add a subtle highlight class to the entire line
            const statusClass = comment.status === 'resolved' ? 'comment-resolved' : 'comment-active';
            const typeClass = comment.type && comment.type !== 'user' ? `comment-${comment.type}` : '';
            lineEl.classList.add('has-comment', statusClass);
            if (typeClass) lineEl.classList.add(typeClass);
        }
    }
}
