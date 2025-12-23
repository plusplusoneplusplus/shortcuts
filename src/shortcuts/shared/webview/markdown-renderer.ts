/**
 * Shared Markdown Renderer for Comment Bubbles
 * 
 * Provides markdown rendering functionality for displaying comments
 * in both the review editor and git diff views.
 * 
 * Supports: headings, bold, italic, strikethrough, code, code blocks,
 * links, blockquotes, and lists.
 */

import { escapeHtml } from './base-panel-manager';

/**
 * Render inline markdown elements (bold, italic, code, links, etc.)
 * 
 * @param text - The text to process
 * @returns HTML string with rendered inline elements
 */
export function renderInlineMarkdown(text: string): string {
    if (!text) return '';
    
    let html = escapeHtml(text);
    
    // Inline code (must be before bold/italic to avoid conflicts)
    html = html.replace(/`([^`]+)`/g, '<code class="comment-inline-code">$1</code>');
    
    // Bold + Italic (***text*** or ___text___)
    html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
    
    // Bold (**text** or __text__)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    
    // Italic (*text* or _text_) - careful not to match inside bold
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');
    
    // Strikethrough (~~text~~)
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    
    // Links [text](url) - make clickable
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="comment-link" target="_blank" rel="noopener">$1</a>');
    
    return html;
}

/**
 * Render markdown content to HTML for display in comment bubbles.
 * Supports: headings, bold, italic, strikethrough, code, code blocks,
 * links, blockquotes, and lists.
 * 
 * @param markdown - The raw markdown text
 * @returns HTML string with rendered markdown
 */
export function renderCommentMarkdown(markdown: string): string {
    if (!markdown) return '';
    
    const lines = markdown.split('\n');
    const htmlLines: string[] = [];
    let inCodeBlock = false;
    let codeBlockLang = '';
    let codeBlockContent: string[] = [];
    let inList = false;
    let listType: 'ul' | 'ol' = 'ul';
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Handle code blocks
        if (line.startsWith('```')) {
            if (!inCodeBlock) {
                // Start code block
                inCodeBlock = true;
                codeBlockLang = line.slice(3).trim();
                codeBlockContent = [];
            } else {
                // End code block
                inCodeBlock = false;
                const langClass = codeBlockLang ? ` class="language-${escapeHtml(codeBlockLang)}"` : '';
                htmlLines.push(`<pre class="comment-code-block"><code${langClass}>${escapeHtml(codeBlockContent.join('\n'))}</code></pre>`);
                codeBlockContent = [];
                codeBlockLang = '';
            }
            continue;
        }
        
        if (inCodeBlock) {
            codeBlockContent.push(line);
            continue;
        }
        
        // Check for list items
        const ulMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
        const olMatch = line.match(/^(\s*)(\d+\.)\s+(.*)$/);
        
        if (ulMatch || olMatch) {
            if (!inList) {
                inList = true;
                listType = ulMatch ? 'ul' : 'ol';
                htmlLines.push(`<${listType} class="comment-list">`);
            }
            const content = ulMatch ? ulMatch[3] : olMatch![3];
            htmlLines.push(`<li>${renderInlineMarkdown(content)}</li>`);
            
            // Check if next line is not a list item to close the list
            const nextLine = lines[i + 1];
            if (!nextLine || (!nextLine.match(/^(\s*)([-*+])\s+/) && !nextLine.match(/^(\s*)(\d+\.)\s+/))) {
                htmlLines.push(`</${listType}>`);
                inList = false;
            }
            continue;
        }
        
        // Close any open list if we hit a non-list line
        if (inList) {
            htmlLines.push(`</${listType}>`);
            inList = false;
        }
        
        // Empty line
        if (line.trim() === '') {
            htmlLines.push('<br>');
            continue;
        }
        
        // Headings (# to ######)
        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const content = renderInlineMarkdown(headingMatch[2]);
            htmlLines.push(`<h${level} class="comment-heading comment-h${level}">${content}</h${level}>`);
            continue;
        }
        
        // Blockquotes (>)
        if (line.startsWith('>')) {
            const content = line.replace(/^>\s*/, '');
            htmlLines.push(`<blockquote class="comment-blockquote">${renderInlineMarkdown(content)}</blockquote>`);
            continue;
        }
        
        // Horizontal rule
        if (/^(---+|\*\*\*+|___+)\s*$/.test(line)) {
            htmlLines.push('<hr class="comment-hr">');
            continue;
        }
        
        // Regular paragraph
        htmlLines.push(`<p class="comment-paragraph">${renderInlineMarkdown(line)}</p>`);
    }
    
    // Close any unclosed code block
    if (inCodeBlock && codeBlockContent.length > 0) {
        htmlLines.push(`<pre class="comment-code-block"><code>${escapeHtml(codeBlockContent.join('\n'))}</code></pre>`);
    }
    
    // Close any unclosed list
    if (inList) {
        htmlLines.push(`</${listType}>`);
    }
    
    return htmlLines.join('');
}

