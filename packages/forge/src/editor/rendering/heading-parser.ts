/**
 * Pure heading parsing for markdown content. No DOM dependencies, so it runs
 * in both Node.js tests and the browser.
 */

export interface HeadingInfo {
    /** 1-based line number */
    lineNum: number;
    /** Heading level (1-6) */
    level: number;
    /** Anchor ID for the heading (URL-safe identifier) */
    anchorId: string;
    /** Raw heading text */
    text: string;
}

import { generateAnchorId } from './markdown-renderer';
export { generateAnchorId };

/**
 * Parse ATX headings from the content, skipping anything inside fenced
 * code blocks.
 */
export function parseHeadings(content: string): HeadingInfo[] {
    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const headings: HeadingInfo[] = [];
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Track code block state - allow up to 3 spaces before fence
        if (line.match(/^[ \t]{0,3}```/)) {
            inCodeBlock = !inCodeBlock;
            continue;
        }

        // Skip lines inside code blocks
        if (inCodeBlock) {
            continue;
        }

        // Check for heading
        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const text = headingMatch[2];
            const anchorId = generateAnchorId(text);

            headings.push({
                lineNum: i + 1, // 1-based line number
                level,
                anchorId,
                text
            });
        }
    }

    return headings;
}

/**
 * Find the end line of a section (the line before the next heading of same or higher level)
 *
 * @returns The last line number of the section (inclusive)
 */
export function findSectionEndLine(
    headings: HeadingInfo[],
    headingIndex: number,
    totalLines: number
): number {
    const currentHeading = headings[headingIndex];

    // Find the next heading at the same or higher level
    for (let i = headingIndex + 1; i < headings.length; i++) {
        if (headings[i].level <= currentHeading.level) {
            // End is the line before this heading
            return headings[i].lineNum - 1;
        }
    }

    // No next heading found, section extends to end of document
    return totalLines;
}

export function buildSectionMap(content: string): Map<string, { startLine: number; endLine: number }> {
    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const totalLines = lines.length;
    const headings = parseHeadings(content);
    const sectionMap = new Map<string, { startLine: number; endLine: number }>();

    for (let i = 0; i < headings.length; i++) {
        const heading = headings[i];
        const endLine = findSectionEndLine(headings, i, totalLines);

        // Ensure unique anchor IDs by appending index if duplicate
        let anchorId = heading.anchorId;
        let suffix = 1;
        while (sectionMap.has(anchorId)) {
            anchorId = `${heading.anchorId}-${suffix}`;
            suffix++;
        }

        sectionMap.set(anchorId, {
            startLine: heading.lineNum,
            endLine
        });
    }

    return sectionMap;
}

/**
 * @returns The heading level (1-6) or 0 if not a heading
 */
export function getHeadingLevel(line: string): number {
    const match = line.match(/^(#{1,6})\s+/);
    return match ? match[1].length : 0;
}

/**
 * @returns The anchor ID or empty string if not a heading
 */
export function getHeadingAnchorId(line: string): string {
    const match = line.match(/^#{1,6}\s+(.*)$/);
    return match ? generateAnchorId(match[1]) : '';
}
