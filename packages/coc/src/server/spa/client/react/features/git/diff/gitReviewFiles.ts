import type { FileChange } from './FileTree';
import { normalizeStatus } from './FileTree';

export function reviewFileStatus(status: string) { return normalizeStatus(status).replace(/^([RC])\d+$/, '$1'); }

export type ReviewFileKind = 'all' | 'source' | 'tests' | 'docs';
export function reviewFileParts(path: string) {
    const slash = path.lastIndexOf('/');
    return { name: path.slice(slash + 1), directory: slash < 0 ? '.' : path.slice(0, slash) };
}
export function reviewFileKind(path: string): Exclude<ReviewFileKind, 'all'> {
    if (/(^|\/)(__tests__|tests?|specs?)(\/|\.)|\.(test|spec)\.[^/]+$/i.test(path)) return 'tests';
    if (/(^|\/)(docs?|notes)(\/|$)|\.(mdx?|rst|txt)$/i.test(path)) return 'docs';
    return 'source';
}
export function filterReviewFiles(files: FileChange[], query: string, kind: ReviewFileKind,
    status: string, hideViewed: boolean, viewed: ReadonlySet<string>) {
    const needle = query.trim().toLowerCase();
    return files.filter(file => (!needle || `${file.path}\n${file.oldPath ?? ''}`.toLowerCase().includes(needle))
        && (kind === 'all' || reviewFileKind(file.path) === kind)
        && (status === 'all' || reviewFileStatus(file.status) === status)
        && (!hideViewed || !viewed.has(file.path)));
}
export function groupReviewFiles(files: FileChange[]) {
    const groups = new Map<string, FileChange[]>();
    for (const file of files) {
        const { directory } = reviewFileParts(file.path);
        const group = groups.get(directory);
        if (group) group.push(file); else groups.set(directory, [file]);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([directory, entries]) => ({
        directory, files: [...entries].sort((a, b) => a.path.localeCompare(b.path)),
    }));
}
