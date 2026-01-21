/**
 * Heading parsing utilities for the markdown review editor
 *
 * This module contains pure functions for parsing headings from markdown content.
 * These functions work in both Node.js (for tests) and browser environments.
 * No DOM dependencies.
 */

/**
 * Information about a heading in the document
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

/**
 * Generate a URL-safe anchor ID from heading text.
 * This follows GitHub-style anchor generation:
 * - Lowercase all text
 * - Remove markdown formatting markers
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
        // Remove markdown formatting markers
        .replace(/[*_~`]/g, '')
        // Remove all characters except alphanumeric, spaces, hyphens, and unicode letters/numbers
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        // Replace spaces with hyphens
        .replace(/\s+/g, '-')
        // Collapse multiple hyphens
        .replace(/-+/g, '-')
        // Remove leading/trailing hyphens
        .replace(/^-|-$/g, '')
        .trim();
}

/**
 * Parse all headings from the content
 *
 * @param content - The markdown content to parse
 * @returns Array of HeadingInfo objects
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
 * @param headings - Array of all headings
 * @param headingIndex - Index of the current heading in the array
 * @param totalLines - Total number of lines in the document
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

/**
 * Build a map of heading anchor IDs to their section line ranges
 *
 * @param content - The markdown content
 * @returns Map of anchor ID to { startLine, endLine }
 */
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
 * Get the heading level from a line content
 *
 * @param line - The line content
 * @returns The heading level (1-6) or 0 if not a heading
 */
export function getHeadingLevel(line: string): number {
    const match = line.match(/^(#{1,6})\s+/);
    return match ? match[1].length : 0;
}

/**
 * Get the anchor ID from a heading line
 *
 * @param line - The line content
 * @returns The anchor ID or empty string if not a heading
 */
export function getHeadingAnchorId(line: string): string {
    const match = line.match(/^#{1,6}\s+(.*)$/);
    return match ? generateAnchorId(match[1]) : '';
}
