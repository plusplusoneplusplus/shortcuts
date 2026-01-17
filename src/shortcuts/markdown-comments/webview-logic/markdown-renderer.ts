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
    /** Anchor ID for headings (used for ToC navigation) */
    anchorId?: string;
}

/**
 * Generate a URL-safe anchor ID from heading text.
 * This follows GitHub-style anchor generation:
 * - Lowercase all text
 * - Remove all punctuation except hyphens and spaces
 * - Replace spaces with hyphens
 * - Collapse multiple hyphens into one
 * 
 * Works consistently across Windows, macOS, and Linux.
 * 
 * @param text - The heading text to convert
 * @returns A URL-safe anchor ID
 */
export function generateAnchorId(text: string): string {
    if (!text) return '';
    
    return text
        // Convert to lowercase
        .toLowerCase()
        // Remove any markdown formatting markers (e.g., **, *, ~~, etc.)
        .replace(/[*_~`]/g, '')
        // Remove all characters except alphanumeric, spaces, hyphens, and unicode letters/numbers
        // This regex uses unicode-aware matching for international text support
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        // Replace spaces with hyphens
        .replace(/\s+/g, '-')
        // Collapse multiple hyphens into one
        .replace(/-+/g, '-')
        // Remove leading/trailing hyphens
        .replace(/^-|-$/g, '')
        .trim();
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
 * Apply source mode syntax highlighting to a line.
 * This provides visual highlighting for markdown syntax without rendering.
 * Code blocks (```) are NOT highlighted - they are displayed as plain text.
 * 
 * @param line - The line content
 * @param inCodeBlock - Whether currently inside a code block
 * @returns Object with highlighted HTML and code block state
 */
export function applySourceModeHighlighting(
    line: string,
    inCodeBlock: boolean
): { html: string; inCodeBlock: boolean } {
    // Strip trailing \r from Windows line endings
    const cleanLine = line.replace(/\r$/, '');
    
    // Check for code fence (```)
    if (cleanLine.match(/^```/)) {
        // Toggle code block state, but don't highlight the fence itself
        return {
            html: '<span class="src-code-fence">' + escapeHtml(cleanLine) + '</span>',
            inCodeBlock: !inCodeBlock
        };
    }
    
    // If inside a code block, just escape and return (no highlighting)
    if (inCodeBlock) {
        return {
            html: escapeHtml(cleanLine),
            inCodeBlock: true
        };
    }
    
    let html = escapeHtml(cleanLine);
    
    // Headings (# to ######)
    const headingMatch = cleanLine.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
        const level = headingMatch[1].length;
        const hashes = escapeHtml(headingMatch[1]);
        const content = applySourceModeInlineHighlighting(headingMatch[2]);
        return {
            html: `<span class="src-h${level}"><span class="src-hash">${hashes}</span> ${content}</span>`,
            inCodeBlock: false
        };
    }
    
    // Horizontal rule
    if (/^(---+|\*\*\*+|___+)\s*$/.test(cleanLine)) {
        return {
            html: '<span class="src-hr">' + html + '</span>',
            inCodeBlock: false
        };
    }
    
    // Blockquotes
    if (/^>\s*/.test(cleanLine)) {
        const content = cleanLine.replace(/^>\s*/, '');
        html = '<span class="src-blockquote"><span class="src-blockquote-marker">&gt;</span> ' +
            applySourceModeInlineHighlighting(content) + '</span>';
        return { html, inCodeBlock: false };
    }
    
    // Unordered list items
    const ulMatch = cleanLine.match(/^(\s*)([-*+])\s+(.*)$/);
    if (ulMatch) {
        const indent = ulMatch[1];
        const marker = ulMatch[2];
        let content = ulMatch[3];
        
        // Check for checkbox (supports [ ], [x], [X], [~] for unchecked, checked, in-progress)
        const checkboxMatch = content.match(/^\[([ xX~])\]\s*(.*)$/);
        if (checkboxMatch) {
            const checkChar = checkboxMatch[1].toLowerCase();
            const state = checkChar === 'x' ? 'checked' : checkChar === '~' ? 'in-progress' : 'unchecked';
            const checkboxClass = state === 'checked' 
                ? 'src-checkbox src-checkbox-checked src-checkbox-clickable'
                : state === 'in-progress'
                    ? 'src-checkbox src-checkbox-in-progress src-checkbox-clickable'
                    : 'src-checkbox src-checkbox-clickable';
            const checkbox = state === 'checked' ? '[x]' : state === 'in-progress' ? '[~]' : '[ ]';
            // Add data attributes for click handling in source mode
            // Note: lineNum is not available in source mode highlighting, so we use a placeholder
            // The actual line number will be determined from the parent element's data-line attribute
            content = `<span class="${checkboxClass}" data-state="${state}">${checkbox}</span> ` + applySourceModeInlineHighlighting(checkboxMatch[2]);
        } else {
            content = applySourceModeInlineHighlighting(content);
        }
        
        html = `<span class="src-list-item">${escapeHtml(indent)}<span class="src-list-marker">${escapeHtml(marker)}</span> ${content}</span>`;
        return { html, inCodeBlock: false };
    }
    
    // Ordered list items
    const olMatch = cleanLine.match(/^(\s*)(\d+\.)\s+(.*)$/);
    if (olMatch) {
        const indent = olMatch[1];
        const marker = olMatch[2];
        const content = applySourceModeInlineHighlighting(olMatch[3]);
        html = `<span class="src-list-item">${escapeHtml(indent)}<span class="src-list-marker">${escapeHtml(marker)}</span> ${content}</span>`;
        return { html, inCodeBlock: false };
    }
    
    // Apply inline highlighting for regular lines
    html = applySourceModeInlineHighlighting(cleanLine);
    
    return { html, inCodeBlock: false };
}

/**
 * Apply inline markdown syntax highlighting for source mode.
 * Highlights bold, italic, code, links, images, and strikethrough markers.
 * 
 * @param text - The text to highlight
 * @returns HTML with syntax highlighting
 */
export function applySourceModeInlineHighlighting(text: string): string {
    if (!text) return '';
    
    let html = escapeHtml(text);
    
    // Inline code (must be before bold/italic to avoid conflicts)
    // Show the backticks with highlighting
    html = html.replace(/`([^`]+)`/g, '<span class="src-inline-code">`$1`</span>');
    
    // Images ![alt](url)
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, 
        '<span class="src-image">![$1]($2)</span>');
    
    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, 
        '<span class="src-link"><span class="src-link-text">[$1]</span><span class="src-link-url">($2)</span></span>');
    
    // Bold + Italic (***text*** or ___text___)
    html = html.replace(/\*\*\*([^*]+)\*\*\*/g, 
        '<span class="src-bold-italic"><span class="src-marker">***</span>$1<span class="src-marker">***</span></span>');
    html = html.replace(/___([^_]+)___/g, 
        '<span class="src-bold-italic"><span class="src-marker">___</span>$1<span class="src-marker">___</span></span>');
    
    // Bold (**text** or __text__)
    html = html.replace(/\*\*([^*]+)\*\*/g, 
        '<span class="src-bold"><span class="src-marker">**</span>$1<span class="src-marker">**</span></span>');
    html = html.replace(/__([^_]+)__/g, 
        '<span class="src-bold"><span class="src-marker">__</span>$1<span class="src-marker">__</span></span>');
    
    // Italic (*text* or _text_) - careful not to match inside bold
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, 
        '<span class="src-italic"><span class="src-marker">*</span>$1<span class="src-marker">*</span></span>');
    // For underscore italics, require word boundaries
    html = html.replace(/(?<=^|[\s(]|\&gt;)_([^_\s][^_]*[^_\s]|[^_\s])_(?=$|[\s.,;:!?)\]]|\&lt;)/g, 
        '<span class="src-italic"><span class="src-marker">_</span>$1<span class="src-marker">_</span></span>');
    
    // Strikethrough ~~text~~
    html = html.replace(/~~([^~]+)~~/g, 
        '<span class="src-strike"><span class="src-marker">~~</span>$1<span class="src-marker">~~</span></span>');
    
    return html;
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
    // Add special class for anchor links (starting with #) to enable ToC navigation
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
        const isAnchorLink = url.startsWith('#');
        const linkClass = isAnchorLink ? 'md-link md-anchor-link' : 'md-link';
        const dataAttr = isAnchorLink ? ` data-anchor="${escapeHtml(url.substring(1))}"` : '';
        return `<span class="${linkClass}"${dataAttr}><span class="md-link-text">[${text}]</span><span class="md-link-url">(${url})</span></span>`;
    });
    
    // Bold + Italic (***text*** or ___text___)
    html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<span class="md-bold-italic"><span class="md-marker">***</span>$1<span class="md-marker">***</span></span>');
    html = html.replace(/___([^_]+)___/g, '<span class="md-bold-italic"><span class="md-marker">___</span>$1<span class="md-marker">___</span></span>');
    
    // Bold (**text** or __text__)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<span class="md-bold"><span class="md-marker">**</span>$1<span class="md-marker">**</span></span>');
    html = html.replace(/__([^_]+)__/g, '<span class="md-bold"><span class="md-marker">__</span>$1<span class="md-marker">__</span></span>');
    
    // Italic (*text* or _text_) - careful not to match inside bold
    // Use negative lookbehind/lookahead (note: these work in modern browsers and Node.js)
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<span class="md-italic"><span class="md-marker">*</span>$1<span class="md-marker">*</span></span>');
    // For underscore italics, require word boundaries to avoid matching paths like folder_name/file.ts
    // The underscore must be preceded by whitespace/start and followed by non-underscore, non-word chars
    // This matches standard markdown behavior where _word_ works but not mid_word_text
    html = html.replace(/(?<=^|[\s(]|\&gt;)_([^_\s][^_]*[^_\s]|[^_\s])_(?=$|[\s.,;:!?)\]]|\&lt;)/g, '<span class="md-italic"><span class="md-marker">_</span>$1<span class="md-marker">_</span></span>');
    
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
    // Strip trailing \r from Windows line endings (CRLF)
    // When content is split by \n, the \r remains at the end of each line
    const cleanLine = line.replace(/\r$/, '');

    // If we're inside a code block, don't apply markdown highlighting
    if (inCodeBlock && !cleanLine.startsWith('```')) {
        return {
            html: escapeHtml(cleanLine),
            inCodeBlock: true,
            codeBlockLang
        };
    }

    // Check for code fence start/end
    const codeFenceMatch = cleanLine.match(/^```(\w*)/);
    if (codeFenceMatch) {
        if (!inCodeBlock) {
            // Starting a code block
            const lang = codeFenceMatch[1] || 'plaintext';
            return {
                html: '<span class="md-code-fence">' + escapeHtml(cleanLine) + '</span>',
                inCodeBlock: true,
                codeBlockLang: lang,
                isCodeFenceStart: true
            };
        } else {
            // Ending a code block
            return {
                html: '<span class="md-code-fence">' + escapeHtml(cleanLine) + '</span>',
                inCodeBlock: false,
                codeBlockLang: null,
                isCodeFenceEnd: true
            };
        }
    }

    let html = escapeHtml(cleanLine);

    // Horizontal rule (must check before headings)
    if (/^(---+|\*\*\*+|___+)\s*$/.test(cleanLine)) {
        return {
            html: '<span class="md-hr">' + html + '</span>',
            inCodeBlock: false,
            codeBlockLang: null
        };
    }
    
    // Headings
    const headingMatch = cleanLine.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
        const level = headingMatch[1].length;
        const hashes = escapeHtml(headingMatch[1]);
        const headingText = headingMatch[2];
        const content = applyInlineMarkdown(headingText);
        const anchorId = generateAnchorId(headingText);
        html = `<span class="md-h${level}" data-anchor-id="${anchorId}"><span class="md-hash">${hashes}</span> ${content}</span>`;
        return { html, inCodeBlock: false, codeBlockLang: null, anchorId };
    }

    // Blockquotes
    if (/^>\s*/.test(cleanLine)) {
        const content = cleanLine.replace(/^>\s*/, '');
        html = '<span class="md-blockquote"><span class="md-blockquote-marker">&gt;</span> ' +
            applyInlineMarkdown(content) + '</span>';
        return { html, inCodeBlock: false, codeBlockLang: null };
    }

    // Unordered list items
    const ulMatch = cleanLine.match(/^(\s*)([-*+])\s+(.*)$/);
    if (ulMatch) {
        const indent = ulMatch[1];
        const marker = ulMatch[2];
        let content = ulMatch[3];

        // Check for checkbox (supports [ ], [x], [X], [~] for unchecked, checked, in-progress)
        const checkboxMatch = content.match(/^\[([ xX~])\]\s*(.*)$/);
        if (checkboxMatch) {
            const checkChar = checkboxMatch[1].toLowerCase();
            const state = checkChar === 'x' ? 'checked' : checkChar === '~' ? 'in-progress' : 'unchecked';
            const checkboxClass = state === 'checked'
                ? 'md-checkbox md-checkbox-checked md-checkbox-clickable'
                : state === 'in-progress'
                    ? 'md-checkbox md-checkbox-in-progress md-checkbox-clickable'
                    : 'md-checkbox md-checkbox-clickable';
            const checkbox = state === 'checked' ? '[x]' : state === 'in-progress' ? '[~]' : '[ ]';
            // Add data attributes for click handling: line number and current state
            content = `<span class="${checkboxClass}" data-line="${lineNum}" data-state="${state}">${checkbox}</span> ` + applyInlineMarkdown(checkboxMatch[2]);
        } else {
            content = applyInlineMarkdown(content);
        }

        html = `<span class="md-list-item">${indent}<span class="md-list-marker">${escapeHtml(marker)}</span> ${content}</span>`;
        return { html, inCodeBlock: false, codeBlockLang: null };
    }

    // Ordered list items
    const olMatch = cleanLine.match(/^(\s*)(\d+\.)\s+(.*)$/);
    if (olMatch) {
        const indent = olMatch[1];
        const marker = olMatch[2];
        const content = applyInlineMarkdown(olMatch[3]);
        html = `<span class="md-list-item">${indent}<span class="md-list-marker">${escapeHtml(marker)}</span> ${content}</span>`;
        return { html, inCodeBlock: false, codeBlockLang: null };
    }

    // Apply inline markdown (bold, italic, code, links, etc.)
    html = applyInlineMarkdown(cleanLine);

    return { html, inCodeBlock: false, codeBlockLang: null };
}

