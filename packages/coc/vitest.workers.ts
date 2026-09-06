/**
 * Per-OS concurrency ceiling for the CoC vitest suites.
 *
 * The cap exists for one reason only: memory, not CPU. The SPA project runs
 * jsdom plus @excalidraw/excalidraw, and each fork holds a full jsdom document
 * tree alive for the duration of a file. On the `macos-latest` runner (arm,
 * 3 cores / ~7 GB) three concurrent forks peak at roughly 14 GB and the run
 * dies with an OOM, so darwin stays pinned at 2.
 *
 * Everything else has real headroom and was only being throttled by a limit it
 * never needed. `ubuntu-latest` is 4 cores / 16 GB, so it gets one fork per
 * core. `windows-latest` is also 4 cores / 16 GB, but Windows pays noticeably
 * more per fork — the Node process image is larger and there is no
 * copy-on-write fork to amortise it — so it sits one below the core count to
 * keep a margin under the same 16 GB.
 *
 * Kept as a shared module rather than an inline expression because both this
 * package's config and the repo-root config run the same excalidraw + jsdom
 * files and therefore must agree on the ceiling.
 */
export function resolveMaxWorkers(platform: NodeJS.Platform = process.platform): number {
    if (platform === 'darwin') {
        return 2;
    }
    if (platform === 'win32') {
        return 3;
    }
    return 4;
}
