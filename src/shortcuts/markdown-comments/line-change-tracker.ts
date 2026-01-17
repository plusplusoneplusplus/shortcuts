/**
 * Line change tracking utilities for the Markdown Review Editor.
 *
 * Computes which lines changed between two versions of content,
 * used to show visual indicators when external tools (like AI) edit the file.
 */

import { diffLines, Change } from 'diff';

/**
 * Represents a change to a specific line.
 */
export interface LineChange {
    /** 1-based line number in the new content */
    line: number;
    /** Type of change: 'added' for new lines, 'modified' for changed content */
    type: 'added' | 'modified';
}

/**
 * Compute which lines changed between old and new content.
 *
 * Uses the diff library to perform line-level diffing and returns
 * an array of LineChange objects indicating which lines in the new
 * content are different from the old content.
 *
 * @param oldContent - The previous content
 * @param newContent - The new content
 * @returns Array of line changes in the new content
 */
export function computeLineChanges(oldContent: string, newContent: string): LineChange[] {
    if (oldContent === newContent) {
        return [];
    }

    const changes: LineChange[] = [];
    const diffs = diffLines(oldContent, newContent);

    let newLineNum = 1;
    let pendingRemoved = 0; // Track removed lines to detect modifications

    for (const part of diffs) {
        const lineCount = part.count || 0;

        if (part.removed) {
            // Track removed lines - if followed by added lines, those are modifications
            pendingRemoved += lineCount;
        } else if (part.added) {
            // Determine if these are modifications or pure additions
            const modificationsCount = Math.min(pendingRemoved, lineCount);
            const additionsCount = lineCount - modificationsCount;

            // First N lines are modifications (replacing removed lines)
            for (let i = 0; i < modificationsCount; i++) {
                changes.push({
                    line: newLineNum + i,
                    type: 'modified'
                });
            }

            // Remaining lines are pure additions
            for (let i = 0; i < additionsCount; i++) {
                changes.push({
                    line: newLineNum + modificationsCount + i,
                    type: 'added'
                });
            }

            newLineNum += lineCount;
            pendingRemoved = 0;
        } else {
            // Unchanged lines - reset pending removed count
            pendingRemoved = 0;
            newLineNum += lineCount;
        }
    }

    return changes;
}

/**
 * Convert LineChange array to a Map for efficient lookup.
 *
 * @param changes - Array of line changes
 * @returns Map from line number to change type
 */
export function lineChangesToMap(changes: LineChange[]): Map<number, 'added' | 'modified'> {
    const map = new Map<number, 'added' | 'modified'>();
    for (const change of changes) {
        map.set(change.line, change.type);
    }
    return map;
}
