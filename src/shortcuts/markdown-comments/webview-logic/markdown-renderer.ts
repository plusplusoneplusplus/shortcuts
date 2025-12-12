/**
 * Markdown rendering utilities
 * 
 * This module contains pure functions for converting markdown to HTML.
 * These functions are testable in Node.js and used in the webview.
 */

/**
 * Result of applying markdown highlighting to a line
 */
export interface MarkdownLineResult {
    html: string;
    inCodeBlock: boolean;
    codeBlockLang: string | null;
    isCodeFenceStart?: boolean;
    isCodeFenceEnd?: boolean;
}

/**
 * Escape HTML entities in text
 * 
 * @param text - The text to escape
 * @returns HTML-escaped text
 */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Apply inline markdown formatting (bold, italic, code, links, images)
 * 
 * @param text - The text to format
 * @returns HTML with inline markdown rendered
 */
export function applyInlineMarkdown(text: string): string {
    if (!text) return '';
    
    let html = escapeHtml(text);
    
    // Order matters - process from most specific to least specific
    
    // Inline code (must be before bold/italic to avoid conflicts)
    html = html.replace(/`([^`]+)`/g, '<span class="md-inline-code">`$1`</span>');
    
    // Images ![alt](url) - render as actual images with preview
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
        const resolvedSrc = resolveImagePath(src);
        const escapedAlt = alt || 'Image';
        const escapedSrc = escapeHtml(src);
        return `<span class="md-image-container" data-src="${escapedSrc}">` +
            `<span class="md-image-syntax">![${escapeHtml(alt)}](${escapedSrc})</span>` +
            `<img class="md-image-preview" src="${resolvedSrc}" alt="${escapeHtml(escapedAlt)}" title="${escapeHtml(escapedAlt)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline';">` +
            `<span class="md-image-error" style="display:none;">⚠️ Image not found</span>` +
        `</span>`;
    });
    
    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, 
        '<span class="md-link"><span class="md-link-text">[$1]</span><span class="md-link-url">($2)</span></span>');
    
    // Bold + Italic (***text*** or ___text___)
    html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<span class="md-bold-italic"><span class="md-marker">***</span>$1<span class="md-marker">***</span></span>');
    html = html.replace(/___([^_]+)___/g, '<span class="md-bold-italic"><span class="md-marker">___</span>$1<span class="md-marker">___</span></span>');
    
    // Bold (**text** or __text__)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<span class="md-bold"><span class="md-marker">**</span>$1<span class="md-marker">**</span></span>');
    html = html.replace(/__([^_]+)__/g, '<span class="md-bold"><span class="md-marker">__</span>$1<span class="md-marker">__</span></span>');
    
    // Italic (*text* or _text_) - careful not to match inside bold
    // Use negative lookbehind/lookahead (note: these work in modern browsers and Node.js)
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<span class="md-italic"><span class="md-marker">*</span>$1<span class="md-marker">*</span></span>');
    html = html.replace(/(?<!_)_([^_]+)_(?!_)/g, '<span class="md-italic"><span class="md-marker">_</span>$1<span class="md-marker">_</span></span>');
    
    // Strikethrough ~~text~~
    html = html.replace(/~~([^~]+)~~/g, '<span class="md-strike"><span class="md-marker">~~</span>$1<span class="md-marker">~~</span></span>');
    
    return html;
}

/**
 * Resolve image path relative to the file or workspace
 * 
 * @param src - The image source path
 * @returns Resolved path or marker for post-processing
 */
export function resolveImagePath(src: string): string {
    // If it's already an absolute URL (http, https, data), return as is
    if (/^(https?:|data:)/.test(src)) {
        return src;
    }
    
    // For relative paths, we need to construct a proper path
    // The webview will need to convert this to a webview URI
    // For now, we'll mark it for post-processing
    return 'IMG_PATH:' + src;
}

/**
 * Apply markdown syntax highlighting to a single line
 * 
 * @param line - The line content
 * @param lineNum - The 1-based line number
 * @param inCodeBlock - Whether currently in a code block
 * @param codeBlockLang - The current code block language
 * @returns Object with rendered HTML and code block state
 */
export function applyMarkdownHighlighting(
    line: string,
    lineNum: number,
    inCodeBlock: boolean,
    codeBlockLang: string | null
): MarkdownLineResult {
    // If we're inside a code block, don't apply markdown highlighting
    if (inCodeBlock && !line.startsWith('```')) {
        return { 
            html: escapeHtml(line), 
            inCodeBlock: true, 
            codeBlockLang 
        };
    }
    
    // Check for code fence start/end
    const codeFenceMatch = line.match(/^```(\w*)/);
    if (codeFenceMatch) {
        if (!inCodeBlock) {
            // Starting a code block
            const lang = codeFenceMatch[1] || 'plaintext';
            return { 
                html: '<span class="md-code-fence">' + escapeHtml(line) + '</span>', 
                inCodeBlock: true, 
                codeBlockLang: lang,
                isCodeFenceStart: true
            };
        } else {
            // Ending a code block
            return { 
                html: '<span class="md-code-fence">' + escapeHtml(line) + '</span>', 
                inCodeBlock: false, 
                codeBlockLang: null,
                isCodeFenceEnd: true
            };
        }
    }
    
    let html = escapeHtml(line);
    
    // Horizontal rule (must check before headings)
    if (/^(---+|\*\*\*+|___+)\s*$/.test(line)) {
        return { 
            html: '<span class="md-hr">' + html + '</span>', 
            inCodeBlock: false, 
            codeBlockLang: null 
        };
    }
    
    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
        const level = headingMatch[1].length;
        const hashes = escapeHtml(headingMatch[1]);
        const content = applyInlineMarkdown(headingMatch[2]);
        html = `<span class="md-h${level}"><span class="md-hash">${hashes}</span> ${content}</span>`;
        return { html, inCodeBlock: false, codeBlockLang: null };
    }
    
    // Blockquotes
    if (/^>\s*/.test(line)) {
        const content = line.replace(/^>\s*/, '');
        html = '<span class="md-blockquote"><span class="md-blockquote-marker">&gt;</span> ' + 
               applyInlineMarkdown(content) + '</span>';
        return { html, inCodeBlock: false, codeBlockLang: null };
    }
    
    // Unordered list items
    const ulMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
    if (ulMatch) {
        const indent = ulMatch[1];
        const marker = ulMatch[2];
        let content = ulMatch[3];
        
        // Check for checkbox
        const checkboxMatch = content.match(/^\[([ xX])\]\s*(.*)$/);
        if (checkboxMatch) {
            const checked = checkboxMatch[1].toLowerCase() === 'x';
            const checkboxClass = checked ? 'md-checkbox md-checkbox-checked' : 'md-checkbox';
            const checkbox = checked ? '[x]' : '[ ]';
            content = `<span class="${checkboxClass}">${checkbox}</span> ` + applyInlineMarkdown(checkboxMatch[2]);
        } else {
            content = applyInlineMarkdown(content);
        }
        
        html = `<span class="md-list-item">${indent}<span class="md-list-marker">${escapeHtml(marker)}</span> ${content}</span>`;
        return { html, inCodeBlock: false, codeBlockLang: null };
    }
    
    // Ordered list items
    const olMatch = line.match(/^(\s*)(\d+\.)\s+(.*)$/);
    if (olMatch) {
        const indent = olMatch[1];
        const marker = olMatch[2];
        const content = applyInlineMarkdown(olMatch[3]);
        html = `<span class="md-list-item">${indent}<span class="md-list-marker">${escapeHtml(marker)}</span> ${content}</span>`;
        return { html, inCodeBlock: false, codeBlockLang: null };
    }
    
    // Apply inline markdown (bold, italic, code, links, etc.)
    html = applyInlineMarkdown(line);
    
    return { html, inCodeBlock: false, codeBlockLang: null };
}

