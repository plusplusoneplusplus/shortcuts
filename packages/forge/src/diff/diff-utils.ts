/** Wire conversion for Rust-owned patch processing. */
import { loadNativeGit, type NativeGitPatchFile } from '@plusplusoneplusplus/coc-native';
import type { GitChangeStatus } from '../git/types';
import type { DiffContent, DiffFileEntry } from './types';

interface ParsedDiff {
    files: DiffFileEntry[];
    contentByPath: Map<string, DiffContent>;
}

/** Worker-backed parsing for asynchronous patch consumers. */
export async function parseFullDiffAsync(fullDiff: string): Promise<ParsedDiff> {
    return nativePatchToDiff(await loadNativeGit().parseGitPatch(fullDiff));
}

/** Native entry-array conversion shared by supplied and local patch consumers. */
export function nativePatchToDiff(entries: NativeGitPatchFile[]): ParsedDiff {
    const contentByPath = new Map<string, DiffContent>();
    const files: DiffFileEntry[] = entries.map(({ raw, totalLines, status, ...metadata }) => {
        contentByPath.set(metadata.path, { raw, totalLines, truncated: false });
        return { ...metadata, status: status as GitChangeStatus };
    });
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, contentByPath };
}
