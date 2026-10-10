/** Wire conversion for Rust-owned patch processing. */
import { loadNativeGit, type NativeGitPatchFile } from '@plusplusoneplusplus/coc-native';
import type { DiffContent, DiffFileEntry, DiffSource, DiffSummary, GetFileDiffOptions, IDiffProvider } from './types';

interface ParsedDiff {
    files: DiffFileEntry[];
    contentByPath: Map<string, DiffContent>;
}

/** Shared public operations; loaders retain transport and per-file rendering semantics. */
export function createPatchDiffProvider(
    source: DiffSource,
    load: (file?: string, options?: GetFileDiffOptions) => Promise<ParsedDiff & { content: DiffContent; summary: DiffSummary }>,
): IDiffProvider {
    return {
        source,
        async listFiles() { return (await load()).files; },
        async getFileDiff(file, options) { return (await load(file, options)).content; },
        async getFullDiff() { return (await load()).content; },
        async prefetchAll() { return (await load()).contentByPath; },
        async getSummary() { return (await load()).summary; },
    };
}

/** Worker-backed parsing for asynchronous patch consumers. */
export async function parseFullDiffAsync(fullDiff: string): Promise<ParsedDiff> {
    return nativePatchToDiff(await loadNativeGit().parseGitPatch(fullDiff));
}

/** Native entry-array conversion shared by supplied and local patch consumers. */
export function nativePatchToDiff(entries: NativeGitPatchFile[]): ParsedDiff {
    const contentByPath = new Map<string, DiffContent>();
    const files: DiffFileEntry[] = entries.map(({ raw, totalLines, ...metadata }) => {
        contentByPath.set(metadata.path, { raw, totalLines, truncated: false });
        return metadata;
    });
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, contentByPath };
}
