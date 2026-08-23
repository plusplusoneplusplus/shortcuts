/* eslint-disable */
/**
 * The addon's type surface, generated from the `#[napi]` items in
 * `rust/napi/src/` by `npm run build:native`. Do not edit.
 *
 * Committed on purpose: `npm run build` is plain `tsc`, so the TypeScript
 * build must not need a Rust toolchain. CI regenerates this and fails on a
 * diff, which is what keeps it honest.
 *
 * Declarations only — this emits no runtime code. `file-index.ts` re-exports
 * these under the package's own names; the real implementations come from the
 * binary the loader resolves.
 */

/** How to build (and later refresh) an index. */
export interface BuildOptions {
  /** Include gitignored files — the `showIgnored` flag from the explorer. */
  includeIgnored?: boolean
  /** Safety cap on indexed paths. Omit for no cap. */
  maxEntries?: number
}
/** A scored path plus the positions the client highlights. */
export interface FileMatch {
  path: string
  score: number
  /**
   * Matched UTF-16 offsets within `path`, ascending — the same offsets a
   * JavaScript string index would use.
   */
  indices: Array<number>
}
/** Walk `root` in parallel and resolve with a ready-to-search index. */
export declare function buildFileIndex(root: string, options?: BuildOptions | undefined | null): Promise<FileIndex>
/** An in-memory, gitignore-aware index of one repository's file paths. */
export declare class FileIndex {
  /** Number of indexed paths. */
  len(): number
  /** True when the walk hit the configured `maxEntries` cap. */
  truncated(): boolean
  /** A window of the raw path list, in index order. */
  files(offset: number, limit: number): Array<string>
  /** Score every indexed path and resolve with the best `limit` matches. */
  search(query: string, limit: number): Promise<FileMatch[]>
  /** Re-walk the root and atomically swap in the new path list. */
  refresh(): Promise<void>
}
