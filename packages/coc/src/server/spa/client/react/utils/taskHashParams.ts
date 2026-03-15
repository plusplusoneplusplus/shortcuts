/**
 * Pure utility: parse task navigation params from a URL hash string.
 */
export function parseTaskHashParams(hash: string, wsId: string) {
    const [hashPath, queryStr] = hash.replace(/^#/, '').split('?');
    const parts = hashPath.split('/');
    if (parts[0] !== 'repos' || decodeURIComponent(parts[1] || '') !== wsId || parts[2] !== 'tasks')
        return { initialFolderPath: null, initialFilePath: null, initialViewMode: null as 'review' | 'source' | null };
    const taskParts = parts.slice(3).map(p => decodeURIComponent(p)).filter(Boolean);

    const params = new URLSearchParams(queryStr || '');
    const modeParam = params.get('mode');
    const initialViewMode: 'review' | 'source' | null = modeParam === 'source' ? 'source' : modeParam === 'review' ? 'review' : null;

    if (!taskParts.length) return { initialFolderPath: null, initialFilePath: null, initialViewMode };
    const last = taskParts[taskParts.length - 1];
    if (last.endsWith('.md')) {
        return {
            initialFolderPath: taskParts.slice(0, -1).join('/') || null,
            initialFilePath: taskParts.join('/'),
            initialViewMode,
        };
    }
    return { initialFolderPath: taskParts.join('/'), initialFilePath: null, initialViewMode };
}
