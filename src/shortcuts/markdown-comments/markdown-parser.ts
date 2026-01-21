/**
 * Markdown parsing utilities for the Review Editor View
 * These functions are used for syntax highlighting and code block detection
 */

/**
 * Interface for a parsed code block
 */
export interface CodeBlock {
    /** Programming language identifier */
    language: string;
    /** Starting line number (1-based) */
    startLine: number;
    /** Ending line number (1-based) */
    endLine: number;
    /** Code content without the fence markers */
    code: string;
    /** Unique identifier for the block */
    id: string;
    /** Whether this is a mermaid diagram */
    isMermaid: boolean;
}

/**
 * Interface for markdown line highlighting result
 */
export interface MarkdownHighlightResult {
    /** The HTML-formatted line */
    html: string;
    /** Whether we're inside a code block after this line */
    inCodeBlock: boolean;
    /** Current code block language if inside a block */
    codeBlockLang: string | null;
    /** Whether this line is a code fence start */
    isCodeFenceStart?: boolean;
    /** Whether this line is a code fence end */
    isCodeFenceEnd?: boolean;
}

/**
 * Escape HTML entities in a string
 */
export function escapeHtml(text: string): string {
    const div = { textContent: '' };
    div.textContent = text;
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Parse code blocks from markdown content
 */
export function parseCodeBlocks(content: string): CodeBlock[] {
    const lines = content.split('\n');
    const blocks: CodeBlock[] = [];
    let inBlock = false;
    let currentBlock: Partial<CodeBlock> = {};
    let codeLines: string[] = [];

    lines.forEach((line, index) => {
        // Allow any amount of leading whitespace before the fence.
        // CommonMark spec only allows 0-3 spaces, but we're lenient here to handle
        // non-standard markdown (e.g., deeply indented code blocks in documents).
        const fenceMatch = line.match(/^[ \t]*```(\w*)/);

        if (fenceMatch && !inBlock) {
            inBlock = true;
            currentBlock = {
                language: fenceMatch[1] || 'plaintext',
                startLine: index + 1,
                isMermaid: fenceMatch[1] === 'mermaid'
            };
            codeLines = [];
        } else if (line.match(/^[ \t]*```/) && inBlock) {
            inBlock = false;
            currentBlock.endLine = index + 1;
            currentBlock.code = codeLines.join('\n');
            currentBlock.id = `codeblock-${currentBlock.startLine}`;
            blocks.push(currentBlock as CodeBlock);
            currentBlock = {};
        } else if (inBlock) {
            codeLines.push(line);
        }
    });

    return blocks;
}

/**
 * Check if content contains mermaid blocks
 */
export function hasMermaidBlocks(content: string): boolean {
    return /```mermaid[\s\S]*?```/.test(content);
}

/**
 * Parse mermaid blocks from content
 */
export function parseMermaidBlocks(content: string): CodeBlock[] {
    return parseCodeBlocks(content).filter(block => block.isMermaid);
}

/**
 * Detect markdown heading level from a line
 * Returns 0 if not a heading, 1-6 for heading levels
 */
export function detectHeadingLevel(line: string): number {
    const match = line.match(/^(#{1,6})\s+/);
    return match ? match[1].length : 0;
}

/**
 * Check if a line is a blockquote
 */
export function isBlockquote(line: string): boolean {
    return /^>\s*/.test(line);
}

/**
 * Check if a line is an unordered list item
 */
export function isUnorderedListItem(line: string): boolean {
    return /^\s*[-*+]\s+/.test(line);
}

/**
 * Check if a line is an ordered list item
 */
export function isOrderedListItem(line: string): boolean {
    return /^\s*\d+\.\s+/.test(line);
}

/**
 * Check if a line is a horizontal rule
 */
export function isHorizontalRule(line: string): boolean {
    return /^(---+|\*\*\*+|___+)\s*$/.test(line);
}

/**
 * Check if a line is a task list item (checkbox)
 */
export function isTaskListItem(line: string): { isTask: boolean; checked: boolean } {
    const match = line.match(/^\s*[-*+]\s+\[([ xX])\]/);
    if (match) {
        return {
            isTask: true,
            checked: match[1].toLowerCase() === 'x'
        };
    }
    return { isTask: false, checked: false };
}

/**
 * Extract link information from markdown link syntax
 */
export function extractLinks(text: string): Array<{ text: string; url: string; start: number; end: number }> {
    const links: Array<{ text: string; url: string; start: number; end: number }> = [];
    const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        links.push({
            text: match[1],
            url: match[2],
            start: match.index,
            end: match.index + match[0].length
        });
    }

    return links;
}

/**
 * Extract inline code spans from text
 */
export function extractInlineCode(text: string): Array<{ code: string; start: number; end: number }> {
    const codeSpans: Array<{ code: string; start: number; end: number }> = [];
    const regex = /`([^`]+)`/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        codeSpans.push({
            code: match[1],
            start: match.index,
            end: match.index + match[0].length
        });
    }

    return codeSpans;
}

/**
 * Check if a line starts a code fence
 */
export function isCodeFenceStart(line: string): { isFence: boolean; language: string } {
    // Allow any amount of leading whitespace before the fence.
    // CommonMark spec only allows 0-3 spaces, but we're lenient here to handle
    // non-standard markdown (e.g., deeply indented code blocks in documents).
    const match = line.match(/^[ \t]*```(\w*)\s*$/);
    if (match) {
        return {
            isFence: true,
            language: match[1] || 'plaintext'
        };
    }
    return { isFence: false, language: '' };
}

/**
 * Check if a line ends a code fence
 */
export function isCodeFenceEnd(line: string): boolean {
    // Allow any amount of leading whitespace before the fence.
    // CommonMark spec only allows 0-3 spaces, but we're lenient here to handle
    // non-standard markdown (e.g., deeply indented code blocks in documents).
    return /^[ \t]*```\s*$/.test(line);
}

/**
 * Detect emphasis markers in text (bold, italic, strikethrough)
 */
export function detectEmphasis(text: string): {
    bold: Array<{ text: string; start: number; end: number }>;
    italic: Array<{ text: string; start: number; end: number }>;
    strikethrough: Array<{ text: string; start: number; end: number }>;
} {
    const result = {
        bold: [] as Array<{ text: string; start: number; end: number }>,
        italic: [] as Array<{ text: string; start: number; end: number }>,
        strikethrough: [] as Array<{ text: string; start: number; end: number }>
    };

    // Bold (**text** or __text__)
    const boldRegex = /(\*\*|__)([^*_]+)\1/g;
    let match;
    while ((match = boldRegex.exec(text)) !== null) {
        result.bold.push({
            text: match[2],
            start: match.index,
            end: match.index + match[0].length
        });
    }

    // Italic (*text* or _text_) - need to avoid bold markers
    const italicRegex = /(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_)/g;
    while ((match = italicRegex.exec(text)) !== null) {
        result.italic.push({
            text: match[1] || match[2],
            start: match.index,
            end: match.index + match[0].length
        });
    }

    // Strikethrough ~~text~~
    const strikeRegex = /~~([^~]+)~~/g;
    while ((match = strikeRegex.exec(text)) !== null) {
        result.strikethrough.push({
            text: match[1],
            start: match.index,
            end: match.index + match[0].length
        });
    }

    return result;
}

/**
 * Parse a table row into cells
 */
export function parseTableRow(line: string): string[] {
    // Remove leading/trailing pipes and split
    const trimmed = line.replace(/^\|/, '').replace(/\|$/, '');
    return trimmed.split('|').map(cell => cell.trim());
}

/**
 * Parse table alignments from a separator line
 */
export function parseTableAlignments(line: string): Array<'left' | 'center' | 'right'> {
    const cells = parseTableRow(line);
    return cells.map(cell => {
        const left = cell.startsWith(':');
        const right = cell.endsWith(':');
        if (left && right) return 'center';
        if (right) return 'right';
        return 'left';
    });
}

/**
 * Check if a line could be a table separator
 */
export function isTableSeparator(line: string): boolean {
    return /^\|?[\s\-:|]+\|[\s\-:|]*$/.test(line);
}

/**
 * Check if a line could be a table row
 */
export function isTableRow(line: string): boolean {
    return line.includes('|');
}

/**
 * Parse a markdown table and return structured data
 */
export function parseTable(lines: string[], startIndex: number): {
    headers: string[];
    rows: string[][];
    alignments: Array<'left' | 'center' | 'right'>;
    endIndex: number;
} | null {
    if (startIndex >= lines.length) return null;

    const headerLine = lines[startIndex];
    if (!headerLine.includes('|')) return null;

    const separatorLine = lines[startIndex + 1];
    if (!separatorLine || !isTableSeparator(separatorLine)) return null;

    const headers = parseTableRow(headerLine);
    const alignments = parseTableAlignments(separatorLine);
    const rows: string[][] = [];

    let i = startIndex + 2;
    while (i < lines.length && lines[i].includes('|')) {
        rows.push(parseTableRow(lines[i]));
        i++;
    }

    return {
        headers,
        rows,
        alignments,
        endIndex: i - 1
    };
}

/**
 * Extract image information from markdown image syntax
 */
export function extractImages(text: string): Array<{ alt: string; url: string; start: number; end: number }> {
    const images: Array<{ alt: string; url: string; start: number; end: number }> = [];
    const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        images.push({
            alt: match[1],
            url: match[2],
            start: match.index,
            end: match.index + match[0].length
        });
    }

    return images;
}

/**
 * Check if an image URL is an external URL (http/https)
 */
export function isExternalImageUrl(url: string): boolean {
    return /^https?:\/\//i.test(url);
}

/**
 * Check if an image URL is a data URL
 */
export function isDataUrl(url: string): boolean {
    return /^data:/i.test(url);
}

/**
 * Detect the type of markdown element a line represents
 */
export type MarkdownLineType =
    | 'heading'
    | 'blockquote'
    | 'unordered-list'
    | 'ordered-list'
    | 'task-list'
    | 'horizontal-rule'
    | 'code-fence-start'
    | 'code-fence-end'
    | 'table-row'
    | 'paragraph'
    | 'empty';

export function detectLineType(line: string, inCodeBlock: boolean): MarkdownLineType {
    if (inCodeBlock) {
        if (isCodeFenceEnd(line)) return 'code-fence-end';
        return 'paragraph'; // Inside code block, treat as plain text
    }

    if (line.trim() === '') return 'empty';

    const fenceCheck = isCodeFenceStart(line);
    if (fenceCheck.isFence) return 'code-fence-start';

    if (isHorizontalRule(line)) return 'horizontal-rule';

    if (detectHeadingLevel(line) > 0) return 'heading';

    if (isBlockquote(line)) return 'blockquote';

    const taskCheck = isTaskListItem(line);
    if (taskCheck.isTask) return 'task-list';

    if (isUnorderedListItem(line)) return 'unordered-list';
    if (isOrderedListItem(line)) return 'ordered-list';

    if (line.includes('|')) return 'table-row';

    return 'paragraph';
}

/**
 * Get the language display name for a code block
 */
export function getLanguageDisplayName(language: string): string {
    const displayNames: Record<string, string> = {
        'js': 'JavaScript',
        'javascript': 'JavaScript',
        'ts': 'TypeScript',
        'typescript': 'TypeScript',
        'py': 'Python',
        'python': 'Python',
        'rb': 'Ruby',
        'ruby': 'Ruby',
        'java': 'Java',
        'cs': 'C#',
        'csharp': 'C#',
        'cpp': 'C++',
        'c': 'C',
        'go': 'Go',
        'rust': 'Rust',
        'rs': 'Rust',
        'swift': 'Swift',
        'kotlin': 'Kotlin',
        'kt': 'Kotlin',
        'php': 'PHP',
        'sql': 'SQL',
        'html': 'HTML',
        'css': 'CSS',
        'scss': 'SCSS',
        'sass': 'Sass',
        'less': 'Less',
        'json': 'JSON',
        'yaml': 'YAML',
        'yml': 'YAML',
        'xml': 'XML',
        'md': 'Markdown',
        'markdown': 'Markdown',
        'bash': 'Bash',
        'sh': 'Shell',
        'shell': 'Shell',
        'powershell': 'PowerShell',
        'ps1': 'PowerShell',
        'dockerfile': 'Dockerfile',
        'docker': 'Dockerfile',
        'plaintext': 'Plain Text',
        'text': 'Plain Text',
        'mermaid': 'Mermaid Diagram'
    };

    return displayNames[language.toLowerCase()] || language.toUpperCase();
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
