/**
 * Detection primitives for the initial-reconcile sync phase.
 *
 * When a user points an existing notebook at a remote that already has content,
 * the steady-state flow is wrong twice over: it mirror-deletes every remote file
 * missing locally, and `git pull` refuses to merge the two unrelated histories.
 * The engine instead runs a one-time union merge. This module answers the two
 * questions that phase depends on — "has reconcile already run for this
 * workspace?" and "are we in the situation that needs it?" — and nothing else;
 * the merge itself lives in the engine.
 *
 * The marker is deliberately stored inside the sync repo's `.git` directory: it
 * is per-workspace state about the mirror, not note content, so it must never be
 * committed or pushed to the shared remote.
 *
 * It also holds the union-merge planner: given the two trees as bytes, it decides
 * what happens to every path without touching disk or git, so the rules that
 * decide whether a note is combined or parked as a binary variant are testable on
 * their own — and the apply layer that writes a plan back out to a directory.
 *
 * Nothing here runs git. The engine reads the two trees, hands them over, and
 * owns the tag/commit/push around the result.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Marker filename, resolved inside the sync repo's `.git` directory. */
export const RECONCILE_MARKER_NAME = 'coc-reconciled.json';

/** Current marker schema version. Bump when the shape changes incompatibly. */
export const RECONCILE_MARKER_VERSION = 1;

/**
 * Records that a workspace's local notes and its remote share history. Its
 * presence is both the "skip reconcile" signal and the baseline that
 * steady-state mirror-deletes are guarded behind — without it, a deletion can't
 * be distinguished from a note the local tree has simply never seen.
 *
 * The initial reconcile writes it once its merge lands. A normal sync writes it
 * too when its push lands without ever needing a merge (the remote was empty, so
 * the first push is itself the shared history) — either way, from here on the
 * two sides have a common ancestor and the steady-state flow is correct.
 */
export interface ReconcileMarker {
    /** Schema version of this marker. */
    version: number;
    /** SHA of the commit the two sides' shared history was established at. */
    mergedCommit: string;
    /** ISO timestamp of when that happened. */
    reconciledAt: string;
}

/** Absolute path of the reconcile marker for a given sync repo. */
export function reconcileMarkerPath(syncRepoDir: string): string {
    return path.join(syncRepoDir, '.git', RECONCILE_MARKER_NAME);
}

/**
 * Read the reconcile marker, or null when reconcile has not (verifiably) run.
 *
 * A missing, unreadable, malformed, or wrong-shaped marker all collapse to null
 * on purpose. Null is the safe direction in both places the marker is consumed:
 * deletions stay suppressed, and reconcile re-runs — which is harmless, because
 * the union merge is idempotent.
 */
export async function readReconcileMarker(syncRepoDir: string): Promise<ReconcileMarker | null> {
    let raw: string;
    try {
        raw = await fs.promises.readFile(reconcileMarkerPath(syncRepoDir), 'utf8');
    } catch {
        return null; // absent or unreadable — reconcile has not run
    }

    try {
        const parsed = JSON.parse(raw) as Partial<ReconcileMarker>;
        if (
            typeof parsed?.version !== 'number' ||
            typeof parsed?.mergedCommit !== 'string' || !parsed.mergedCommit ||
            typeof parsed?.reconciledAt !== 'string' || !parsed.reconciledAt
        ) {
            return null; // shape we can't trust as a baseline
        }
        return { version: parsed.version, mergedCommit: parsed.mergedCommit, reconciledAt: parsed.reconciledAt };
    } catch {
        return null; // truncated/corrupt JSON
    }
}

/**
 * Persist the reconcile marker. Written via a temp file + rename so a crash
 * mid-write can't leave a half-written marker behind.
 */
export async function writeReconcileMarker(syncRepoDir: string, marker: ReconcileMarker): Promise<void> {
    const target = reconcileMarkerPath(syncRepoDir);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    await fs.promises.writeFile(tmp, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
    await fs.promises.rename(tmp, target);
}

/**
 * Whether a failed `git pull` is git declining to merge two unrelated histories.
 *
 * This is the self-healing path: a repo already left in the unrelated state by
 * an earlier version (or a manual `git init`) has no marker to detect, so the
 * pull failure itself is what routes it into reconcile.
 */
export function isUnrelatedHistoriesError(message: string): boolean {
    return /refusing to merge unrelated histories/i.test(message);
}

/**
 * Whether the engine should enter the reconcile phase instead of the normal
 * copy/stage/push flow.
 *
 * All three conditions are required. A marker means reconcile already ran; an
 * empty local tree has nothing to contribute to a union merge (and is exactly
 * the case where the old mirror-delete would have wiped the remote); an empty
 * remote has nothing to reconcile against, so the normal flow's first push is
 * already correct.
 */
export function shouldReconcile(opts: {
    markerPresent: boolean;
    localTreeNonEmpty: boolean;
    remoteHasCommits: boolean;
}): boolean {
    return !opts.markerPresent && opts.localTreeNonEmpty && opts.remoteHasCommits;
}

/**
 * Whether `dir` holds at least one syncable file at any depth.
 *
 * The ignore set is passed in rather than imported from the engine so this
 * module stays a leaf of the import graph (the engine imports it, not the other
 * way round). Directories that contain only ignored names — or nothing at all —
 * don't count: an empty `.git`-only tree is not a notebook worth merging.
 */
export async function isNotesTreeNonEmpty(dir: string, ignore?: ReadonlySet<string>): Promise<boolean> {
    let entries: fs.Dirent[];
    try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
        return false; // missing or unreadable — nothing to sync
    }

    for (const entry of entries) {
        if (ignore?.has(entry.name)) continue;
        if (entry.isDirectory()) {
            if (await isNotesTreeNonEmpty(path.join(dir, entry.name), ignore)) return true;
        } else {
            return true;
        }
    }
    return false;
}

// ── Union merge planning ─────────────────────────────────────────────────────

/**
 * What the union merge does with a single path.
 *
 * There is deliberately no "deleted" outcome: on first contact a path present on
 * only one side is always kept, because the two sides have no shared history to
 * tell an intentional delete apart from a note this side has simply never seen.
 */
export type MergeOutcome =
    /** Present on both sides, byte-identical — nothing to do. */
    | 'identical'
    /** Local only — added to the merged tree. */
    | 'addedFromLocal'
    /** Remote only — preserved as-is. */
    | 'keptFromRemote'
    /** Present on both sides with differing text — hand to the conflict resolver. */
    | 'combined'
    /** Present on both sides, differing, and not safely decodable — keep both. */
    | 'keptBothBinary';

/** The union merge's decision for one path. */
export interface MergeEntry {
    /** Repo-relative POSIX path. */
    path: string;
    outcome: MergeOutcome;
    /** Only for `kept-both-binary`: where the local version is parked. */
    localVariantPath?: string;
}

/** The full decision set for a reconcile, plus the numbers the report needs. */
export interface MergePlan {
    /** Every path from either side, sorted, each with its outcome. */
    entries: MergeEntry[];
    /** How many paths landed in each outcome. */
    counts: Record<MergeOutcome, number>;
    /** Paths needing conflict resolution, for the status report and commit body. */
    combined: string[];
    /** Paths where both binaries were kept and a human should take a look. */
    flagged: string[];
}

/**
 * Whether a buffer can be treated as text for conflict resolution.
 *
 * Conservative on purpose: the conflict resolver works on strings, so anything
 * that would survive decoding only by mangling bytes (invalid UTF-8) or that
 * carries a NUL — the usual "this is binary" tell, and something no note has —
 * must take the keep-both path instead of being silently corrupted.
 */
export function isDecodableText(buf: Buffer): boolean {
    if (buf.includes(0)) return false;
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(buf);
        return true;
    } catch {
        return false; // invalid UTF-8 — decoding would corrupt it
    }
}

/**
 * Where a binary collision's local version is parked: `<name>.local<ext>`, next
 * to the remote version that keeps the original path.
 *
 * `taken` guards the (unlikely but destructive) case where that name is already
 * a real note on either side; a numbered variant is ugly, but overwriting
 * someone's file to make room for a backup would defeat the point.
 */
export function localVariantPath(filePath: string, taken?: ReadonlySet<string>): string {
    const ext = path.posix.extname(filePath);
    const stem = filePath.slice(0, filePath.length - ext.length);
    let candidate = `${stem}.local${ext}`;
    for (let n = 2; taken?.has(candidate); n++) {
        candidate = `${stem}.local-${n}${ext}`;
    }
    return candidate;
}

/**
 * Decide what the union merge does with every path across the two trees.
 *
 * Pure: it reads bytes and returns decisions, so the engine can be tested for
 * "does it apply a plan correctly" separately from "is the plan right". Paths
 * are keyed POSIX-style and the entry list is sorted, so a given pair of trees
 * always produces the same plan — which is what makes a crashed reconcile safe
 * to re-run.
 */
export function planUnionMerge(
    local: ReadonlyMap<string, Buffer>,
    remote: ReadonlyMap<string, Buffer>,
): MergePlan {
    const counts: Record<MergeOutcome, number> = {
        identical: 0,
        addedFromLocal: 0,
        keptFromRemote: 0,
        combined: 0,
        keptBothBinary: 0,
    };
    const entries: MergeEntry[] = [];
    const combined: string[] = [];
    const flagged: string[] = [];

    // Variant names must dodge every real path, plus the ones already handed out.
    const taken = new Set<string>([...local.keys(), ...remote.keys()]);
    const allPaths = [...taken].sort();

    for (const filePath of allPaths) {
        const localBuf = local.get(filePath);
        const remoteBuf = remote.get(filePath);

        let entry: MergeEntry;
        if (localBuf && !remoteBuf) {
            entry = { path: filePath, outcome: 'addedFromLocal' };
        } else if (!localBuf && remoteBuf) {
            entry = { path: filePath, outcome: 'keptFromRemote' };
        } else if (localBuf!.equals(remoteBuf!)) {
            entry = { path: filePath, outcome: 'identical' };
        } else if (isDecodableText(localBuf!) && isDecodableText(remoteBuf!)) {
            entry = { path: filePath, outcome: 'combined' };
            combined.push(filePath);
        } else {
            const variant = localVariantPath(filePath, taken);
            taken.add(variant);
            entry = { path: filePath, outcome: 'keptBothBinary', localVariantPath: variant };
            flagged.push(filePath);
        }

        entries.push(entry);
        counts[entry.outcome]++;
    }

    return { entries, counts, combined, flagged };
}

/**
 * The message for the single squashed commit the reconcile pushes.
 *
 * The body enumerates every automatically-resolved path, so the resolution is
 * auditable from `git log` alone — the user never sees a conflict marker, which
 * makes the commit the only durable record of what was decided for them.
 *
 * `localCount`/`remoteCount` are the sizes of the two source trees rather than
 * anything derived from the plan: they say what went in, while the plan's counts
 * say what came out.
 */
export function reconcileCommitMessage(opts: {
    localCount: number;
    remoteCount: number;
    plan: MergePlan;
}): string {
    const { localCount, remoteCount, plan } = opts;
    const subject =
        `Initial sync: merged ${localCount} local + ${remoteCount} remote notes ` +
        `(${plan.combined.length} combined by AI)`;

    const sections: string[] = [];
    if (plan.combined.length > 0) {
        sections.push(['Combined by AI:', ...plan.combined.map(p => `- ${p}`)].join('\n'));
    }
    if (plan.flagged.length > 0) {
        const variantFor = new Map(
            plan.entries.filter(e => e.localVariantPath).map(e => [e.path, e.localVariantPath!]),
        );
        sections.push([
            'Kept both versions (binary — review recommended):',
            ...plan.flagged.map(p => `- ${p} (local copy kept at ${variantFor.get(p)})`),
        ].join('\n'));
    }

    if (sections.length === 0) return subject;
    return `${subject}\n\n${sections.join('\n\n')}`;
}

// ── Applying a plan ──────────────────────────────────────────────────────────

/** Conflict-marker label for the side that came from this device. */
export const LOCAL_CONFLICT_LABEL = 'local (this device)';

/** Conflict-marker label for the side that was already on the remote. */
export const REMOTE_CONFLICT_LABEL = 'remote';

/**
 * Read every syncable file under `dir` into memory, keyed by POSIX-style path
 * relative to `dir`.
 *
 * Paths are normalized to forward slashes so a plan made on Windows and one made
 * on Linux key the same note the same way — the keys end up in the report and the
 * commit body, and both sides of a sync have to agree on them.
 *
 * Like the emptiness walk, the ignore set is a parameter so this module stays a
 * leaf of the import graph. A missing directory reads as an empty tree, which is
 * the honest answer for a notebook that has never been written to.
 */
export async function scanTreeToMap(
    dir: string,
    ignore?: ReadonlySet<string>,
): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>();
    await scanInto(dir, '', ignore, out);
    return out;
}

async function scanInto(
    dir: string,
    prefix: string,
    ignore: ReadonlySet<string> | undefined,
    out: Map<string, Buffer>,
): Promise<void> {
    let entries: fs.Dirent[];
    try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
        return; // missing or unreadable — an empty tree
    }

    for (const entry of entries) {
        if (ignore?.has(entry.name)) continue;
        const abs = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            await scanInto(abs, rel, ignore, out);
        } else if (entry.isFile()) {
            out.set(rel, await fs.promises.readFile(abs));
        }
        // Symlinks and other non-regular entries are skipped: notes are files.
    }
}

/**
 * Wrap two versions of a text file in git's add/add conflict markers.
 *
 * The reconcile has no common ancestor to hand `git merge-file`, so the blob is
 * synthesized instead. The shape has to match what the existing resolvers expect:
 * `resolveConflictWithAI` documents "ours" as this machine and "theirs" as the
 * other one, and `resolveConflictSimple` splits on the same three markers — so
 * local is always ours and remote is always theirs.
 *
 * Trailing newlines are trimmed off each side before the markers go on, so a file
 * that ends with a newline doesn't contribute a blank line to the merged result.
 */
export function buildConflictBlob(localText: string, remoteText: string): string {
    const ours = localText.replace(/\n+$/, '');
    const theirs = remoteText.replace(/\n+$/, '');
    return [
        `<<<<<<< ${LOCAL_CONFLICT_LABEL}`,
        ours,
        '=======',
        theirs,
        `>>>>>>> ${REMOTE_CONFLICT_LABEL}`,
        '',
    ].join('\n');
}

/** Resolves an add/add conflict blob into final file content. Must not throw. */
export type ConflictResolver = (filePath: string, conflictBlob: string) => Promise<string>;

export interface ApplyMergePlanOptions {
    /** Directory the merged tree is written into (the sync repo working tree). */
    destDir: string;
    plan: MergePlan;
    local: ReadonlyMap<string, Buffer>;
    remote: ReadonlyMap<string, Buffer>;
    /** Called once per `combined` path; the engine wires AI → simple fallback. */
    resolveText: ConflictResolver;
}

export interface ApplyMergePlanResult {
    /** Paths actually written, sorted. Excludes files already correct on disk. */
    written: string[];
}

/**
 * Write a plan's merged tree into `destDir`.
 *
 * Every entry is materialized, including the ones sourced from the remote: the
 * caller may have read the remote side out of git rather than off disk, so
 * assuming `destDir` already holds it would silently skip real writes. Files
 * whose bytes already match are left alone, which keeps mtimes stable so the
 * engine's `git add -A` doesn't re-hash the whole notebook.
 *
 * Nothing is deleted — that is the union-merge rule, restated where it would be
 * easiest to break — so re-applying a plan to an already-merged tree writes
 * nothing and changes nothing.
 */
export async function applyMergePlan(opts: ApplyMergePlanOptions): Promise<ApplyMergePlanResult> {
    const { destDir, plan, local, remote, resolveText } = opts;
    const written: string[] = [];

    for (const entry of plan.entries) {
        switch (entry.outcome) {
            case 'identical':
            case 'keptFromRemote':
                if (await writeIfChanged(destDir, entry.path, remote.get(entry.path)!)) {
                    written.push(entry.path);
                }
                break;

            case 'addedFromLocal':
                if (await writeIfChanged(destDir, entry.path, local.get(entry.path)!)) {
                    written.push(entry.path);
                }
                break;

            case 'combined': {
                const blob = buildConflictBlob(
                    local.get(entry.path)!.toString('utf8'),
                    remote.get(entry.path)!.toString('utf8'),
                );
                const resolved = await resolveText(entry.path, blob);
                if (await writeIfChanged(destDir, entry.path, Buffer.from(resolved, 'utf8'))) {
                    written.push(entry.path);
                }
                break;
            }

            case 'keptBothBinary': {
                // Remote keeps the original path; the local bytes are parked next
                // to it. Both survive — a binary is never merged or dropped.
                if (await writeIfChanged(destDir, entry.path, remote.get(entry.path)!)) {
                    written.push(entry.path);
                }
                if (await writeIfChanged(destDir, entry.localVariantPath!, local.get(entry.path)!)) {
                    written.push(entry.localVariantPath!);
                }
                break;
            }
        }
    }

    written.sort();
    return { written };
}

/** Write `content` at `relPath` under `destDir` unless the bytes already match. */
async function writeIfChanged(destDir: string, relPath: string, content: Buffer): Promise<boolean> {
    const target = path.join(destDir, ...relPath.split('/'));
    try {
        if ((await fs.promises.readFile(target)).equals(content)) return false;
    } catch {
        // Absent or unreadable — fall through and write it.
    }
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, content);
    return true;
}
