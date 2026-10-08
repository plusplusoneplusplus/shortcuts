/**
 * Native (Rust/N-API) capabilities for the CoC server.
 *
 * The addon is required, not optional: {@link loadNativeAddon} and every
 * capability accessor throw {@link NativeAddonLoadError} when a binary is
 * missing, will not load, or lacks the capability, so a packaging mistake
 * surfaces at startup instead of as a silently slower server.
 *
 * There is no opt-out. The `*Status` accessors never throw and report every one
 * of these states, which is what startup diagnostics and `/api/health` can
 * surface.
 *
 * Loading is capability-agnostic — a new capability adds a module beside
 * `repo-files` and nothing else.
 */

export {
    loadNativeAddon,
    nativeAddonStatus,
    NativeAddonLoadError,
    nativeBinaryCandidates,
    nativeBinaryName,
    nativeTriple,
    resetNativeAddonCache,
} from './loader';
export type { NativeAddon, NativeAddonStatus } from './types';
export { loadWebView2Binary, webview2BinaryCandidates, WEBVIEW2_BINARY_NAME } from './webview2';
export { readWindowsCredential } from './windows-credentials';

export { loadNativeRepoFiles, nativeRepoFilesStatus } from './repo-files';
export type {
    NativeContentMatch,
    NativeContentSearchOptions,
    NativeContentSearchResult,
    NativeFileMatch,
    NativeRankedFileMatch,
    NativeRepoBlob,
    NativeRepoFiles,
    NativeRepoFilesAddon,
    NativeRepoReplaceFile,
    NativeRepoReplaceOptions,
    NativeRepoReplaceResult,
    NativeRepoTreeEntry,
    NativeRepoTreeListing,
} from './repo-files';


export {
    loadSymbolsLspBinary,
    resetSymbolsLspCache,
    symbolsLspBinaryCandidates,
    symbolsLspBinaryName,
    symbolsLspStatus,
    SymbolsLspBinaryError,
} from './symbols-lsp';

export {
    loadNativeDangerousCommandGuard,
    nativeDangerousCommandGuardStatus,
    tryMatchDangerousCommand,
} from './dangerous-command';
export type {
    NativeDangerousCommandGuardAddon,
    NativeDangerousCommandVerdict,
} from './dangerous-command';

export { loadNativeGit, nativeGitStatus } from './git';
export type {
    NativeGitAddon,
    NativeGitBranchEntry,
    NativeGitBranchListOptions,
    NativeGitBranchPage,
    NativeGitBranchStatus,
    NativeGitCommitFile,
    NativeGitCommitFiles,
    NativeGitExecOptions,
    NativeGitLogCommit,
    NativeGitLogOptions,
    NativeGitLogPage,
    NativeGitNoIndexDiffInput,
    NativeGitPatchFile,
    NativeGitRangeBaseRef,
    NativeGitRangeDefaultBranch,
    NativeGitRangeDiffStats,
    NativeGitRangeFile,
    NativeGitRepositoryStatus,
    NativeGitStatusEntry,
    NativeGitUpstreamConfig,
} from './git';

export { loadNativeNotesIndex, nativeNotesIndexStatus } from './notes-index';
export type {
    NativeNotesIndex,
    NativeNotesIndexAddon,
    NativeNotesIndexBuildOptions,
    NativeNotesMatch,
    NativeNotesSearchResponse,
    NativeNotesSearchResult,
} from './notes-index';

export {
    isNativeNotesPathError,
    loadNativeNotesFs,
    nativeNotesFsStatus,
    NotesFsError,
    toNotesFsError,
} from './notes-fs';

export { loadNativeSqlite, NativeDatabase, nativeSqliteStatus, NativeStatement } from './sqlite';
export type {
    NativeDatabaseOptions,
    NativePragmaOptions,
    NativeRunResult,
    NativeSqliteAddon,
    NativeSqliteParameters,
    NativeSqliteRow,
    NativeSqliteValue,
} from './sqlite';
export type {
    NativeNotesContentOptions,
    NativeNotesCreatedEntry,
    NativeNotesDeleteResult,
    NativeNotesEntryOptions,
    NativeNotesFileContent,
    NativeNotesFsAddon,
    NativeNotesRenameResult,
    NativeNotesSafePathOptions,
    NativeNotesSafePathResult,
    NativeNotesTreeEntry,
    NativeNotesTreeOptions,
    NativeNotesTreeResult,
    NativeNotesWriteResult,
} from './notes-fs';
