/**
 * Shared utilities for building Ask AI context payloads.
 *
 * These helpers are pure and reused by both webview-side message construction
 * and extension-side fallback handling.
 */

type AICommandMode = 'comment' | 'interactive' | 'background' | 'queued';

interface AskAIContextLike {
    selectedText: string;
    startLine: number;
    endLine: number;
    surroundingLines: string;
    nearestHeading: string | null;
    allHeadings: string[];
    instructionType: string;
    customInstruction?: string;
    mode: AICommandMode;
    promptFilePath?: string;
    skillName?: string;
}

interface HeadingInfo {
    line: number;
    text: string;
}

function normalizeLineEndings(content: string): string {
    return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function parseHeadings(lines: string[]): HeadingInfo[] {
    const headings: HeadingInfo[] = [];
    for (let i = 0; i < lines.length; i++) {
        const headingMatch = lines[i].match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            headings.push({
                line: i + 1,
                text: headingMatch[2].trim()
            });
        }
    }
    return headings;
}

/**
 * Extract document context around a selected range.
 *
 * @param content - Full markdown content
 * @param startLine - 1-based start line
 * @param endLine - 1-based end line
 * @param selectedText - Selected text in the range
 * @param contextRadius - Number of surrounding lines before/after selection
 */
export function extractDocumentContext(
    content: string,
    startLine: number,
    endLine: number,
    selectedText: string,
    contextRadius: number = 5
): Pick<AskAIContextLike, 'selectedText' | 'startLine' | 'endLine' | 'surroundingLines' | 'nearestHeading' | 'allHeadings'> {
    const normalizedContent = normalizeLineEndings(content);
    const lines = normalizedContent.split('\n');
    const lineCount = Math.max(lines.length, 1);

    const safeStartLine = Math.min(Math.max(startLine, 1), lineCount);
    const safeEndLine = Math.min(Math.max(endLine, safeStartLine), lineCount);

    const headings = parseHeadings(lines);
    const allHeadings = headings.map(h => h.text);

    let nearestHeading: string | null = null;
    for (const heading of headings) {
        if (heading.line <= safeStartLine) {
            nearestHeading = heading.text;
        } else {
            break;
        }
    }

    const contextStartIndex = Math.max(0, safeStartLine - 1 - contextRadius);
    const contextEndIndexExclusive = Math.min(lines.length, safeEndLine + contextRadius);
    const surroundingLines: string[] = [];

    for (let i = contextStartIndex; i < contextEndIndexExclusive; i++) {
        const lineNumber = i + 1;
        if (lineNumber >= safeStartLine && lineNumber <= safeEndLine) {
            continue;
        }
        surroundingLines.push(lines[i]);
    }

    return {
        selectedText,
        startLine: safeStartLine,
        endLine: safeEndLine,
        surroundingLines: surroundingLines.join('\n'),
        nearestHeading,
        allHeadings
    };
}

/**
 * Build Ask AI context using the full document as selection.
 *
 * This is used by toolbar actions that should not require user text selection.
 */
export function buildFullDocumentAskAIContext(
    content: string,
    instructionType: string,
    mode: AICommandMode = 'interactive'
): AskAIContextLike {
    const normalizedContent = normalizeLineEndings(content);
    const totalLines = Math.max(normalizedContent.split('\n').length, 1);
    const baseContext = extractDocumentContext(normalizedContent, 1, totalLines, normalizedContent);

    return {
        ...baseContext,
        instructionType,
        mode
    };
}

/**
 * Ensure Ask AI context has a usable selection payload.
 *
 * If selected text is missing/empty, this falls back to full document context
 * while preserving command metadata fields.
 */
export function normalizeAskAIContextForDocument<T extends AskAIContextLike>(
    context: T,
    documentContent: string
): T {
    if (context.selectedText.trim().length > 0) {
        return context;
    }

    const fallback = buildFullDocumentAskAIContext(documentContent, context.instructionType, context.mode);
    return {
        ...context,
        ...fallback
    } as T;
}
