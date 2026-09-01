/**
 * Shared between the notes editor (Run Ralph button) and ChatDetail goal detection.
 */

/** Returns true if the file path ends with `goal.md` or `*.goal.md`. */
export function isGoalFile(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    const filename = normalized.split('/').pop() ?? '';
    return filename === 'goal.md' || filename.endsWith('.goal.md');
}
