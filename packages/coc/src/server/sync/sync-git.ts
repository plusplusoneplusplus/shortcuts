/**
 * Git kernel for the notes sync engine.
 *
 * Every Git command the engine runs — and every rule for interpreting Git's
 * output — lives behind {@link SyncGitRepository}. Isolating it here keeps the
 * highest-risk external dependency in one place: failure modes like unrelated
 * histories, corrupt mirrors, unreachable remotes, and unborn HEAD can be
 * exercised against this class without driving the whole sync transaction.
 *
 * The commands run in the native addon rather than as Node child processes. The
 * mirror is a directory this server owns under its own data dir, so it is
 * always on the host filesystem and never reaches the WSL routing `execGitAsync`
 * does for workspace repositories.
 */

import { execGitAsync } from '@plusplusoneplusplus/forge/git';
import { loadNativeGit, NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import type { SyncLogger } from './sync-types';

/** Bytes of output kept for a command whose answer is text. */
const TEXT_MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Milliseconds any one command gets. Four times the shared default, because
 * `clone`, `fetch`, `pull` and `push` here talk to a remote the user chose.
 */
const COMMAND_TIMEOUT_MS = 120_000;

/**
 * The text of a failed git command.
 *
 * The runner renders a failure as `git <args> failed: <stderr>` on `.message`,
 * so the message is where the text is — but a `catch` receives `unknown`, and a
 * rejection that is not an `Error` at all must not crash the classification.
 * Stdout and stderr are still read when they are there, so a Node `execFile`
 * rejection (which keeps its output on those properties) reads the same way.
 * What is *not* here any more is a conflict: git announces one on stdout, the
 * runner keeps only stderr, and {@link SyncGitRepository.pull} reads the index
 * instead.
 */
export function gitErrorText(err: unknown): string {
    const e = err as { message?: unknown; stdout?: unknown; stderr?: unknown };
    return [e?.message, e?.stdout, e?.stderr]
        .filter((s): s is string => typeof s === 'string')
        .join('\n');
}

/**
 * Rethrow a broken-install failure instead of reading it as git's answer.
 *
 * Every `catch` in this file turns a failed command into a routine sync
 * outcome — "the remote is unreachable", "there is nothing to pull", "this
 * mirror is unusable". A missing or stale native binary fails the same way and
 * means none of those things, and the consequences are not cosmetic:
 * {@link SyncGitRepository.isUsable} answering `false` deletes the mirror and
 * re-clones it.
 */
function rethrowIfAddonUnavailable(err: unknown): void {
    if (err instanceof NativeAddonLoadError) {
        throw err;
    }
}

/**
 * A workspace's sync mirror, exposing the exact Git operations the sync engine
 * needs. Every command addresses `this.dir` as its repository.
 */
export class SyncGitRepository {
    constructor(
        private readonly dir: string,
        private readonly logger: SyncLogger,
    ) {}

    /**
     * Run git in the mirror and return its stdout with one trailing line ending
     * removed.
     *
     * One line ending, where this used to `trim()`. Nothing here reads a value
     * that a trim would have changed — every command answers with a single
     * line, a NUL-separated listing, or nothing at all — and `git status
     * --porcelain` is better off for it, since a trim ate the leading space of
     * its first line.
     */
    private async run(args: string[]): Promise<string> {
        return execGitAsync(args, this.dir, {
            maxBuffer: TEXT_MAX_BUFFER,
            timeout: COMMAND_TIMEOUT_MS,
        });
    }

    /**
     * Whether this is a git repo the engine can actually sync with.
     *
     * `rev-parse --is-inside-work-tree` only proves a worktree is present: it still
     * succeeds on a mirror whose `refs/heads/main` names an object the repo no
     * longer holds. Such a mirror poisons every later `git fetch` — the pack
     * arrives, the connectivity check git runs across it can't resolve the ref, and
     * git reports `did not send all necessary objects`, blaming the remote for
     * local damage. `for-each-ref` is the cheap way to see it: it reads every ref
     * through to its object and fails when one is missing.
     *
     * A repo with no refs at all — a fresh clone of an empty remote, whose HEAD is
     * unborn — is healthy, and `for-each-ref` stays quiet on it, so that case is
     * never mistaken for damage and rebuilt on every tick.
     */
    async isUsable(): Promise<boolean> {
        try {
            await this.run(['rev-parse', '--is-inside-work-tree']);
            await this.run(['for-each-ref']);
            return true;
        } catch (err: unknown) {
            rethrowIfAddonUnavailable(err);
            return false;
        }
    }

    /**
     * Ensure `origin` points at `gitRemote`: update the URL when it drifted, or
     * add the remote when the repo has none.
     */
    async ensureRemote(gitRemote: string): Promise<void> {
        try {
            const currentRemote = await this.run(['remote', 'get-url', 'origin']);
            if (currentRemote !== gitRemote) {
                await this.run(['remote', 'set-url', 'origin', gitRemote]);
                this.logger.info('Updated sync repo remote URL');
            }
        } catch (err: unknown) {
            rethrowIfAddonUnavailable(err);
            await this.run(['remote', 'add', 'origin', gitRemote]);
        }
    }

    /**
     * Clone `gitRemote` into this (empty) directory.
     *
     * Cloning an empty remote succeeds and just leaves HEAD unborn, so
     * "the remote is empty" is not a failure there is anything to catch here.
     * Every other way clone fails — unreachable host, rejected key, a target that
     * isn't empty — throws and must be retried, never fall back to `git init`:
     * that builds a history the remote has never seen, which then can't merge with
     * it and wedges every later sync.
     */
    async clone(gitRemote: string): Promise<void> {
        await this.run(['clone', gitRemote, '.']);
        this.logger.info('Cloned sync repo');
    }

    /**
     * Whether the remote has any commits at all. An unreachable remote reports
     * false: there's nothing to merge, and the normal flow's push will fail and
     * back off on its own.
     */
    async hasRemoteCommits(): Promise<boolean> {
        try {
            const line = await this.run(['ls-remote', 'origin', 'HEAD']);
            return !!line.split(/\s+/)[0]?.trim();
        } catch (err: unknown) {
            rethrowIfAddonUnavailable(err);
            return false;
        }
    }

    /**
     * Whether the remote has commits the local sync repo doesn't (or vice-versa).
     * Uses `ls-remote` so an idle tick never fetches or touches the working tree.
     * Returns false when the remote is empty/unreachable — there's nothing to pull.
     */
    async hasRemoteChanges(): Promise<boolean> {
        let remoteLine: string;
        try {
            remoteLine = await this.run(['ls-remote', 'origin', 'HEAD']);
        } catch (err: unknown) {
            rethrowIfAddonUnavailable(err);
            return false; // unreachable — nothing to pull this tick
        }
        const remoteHead = remoteLine.split(/\s+/)[0]?.trim();
        if (!remoteHead) return false; // empty remote

        let localHead: string;
        try {
            localHead = await this.run(['rev-parse', 'HEAD']);
        } catch (err: unknown) {
            rethrowIfAddonUnavailable(err);
            return true; // no local commits yet but remote has some → pull
        }
        return remoteHead !== localHead;
    }

    /**
     * Stage everything except the ignored names and report whether anything is
     * actually staged. `git add -A` after a changed-files-only copy is a cheap
     * stat pass when the tree is unchanged, so an idle tick stages nothing and
     * returns false.
     *
     * The ignored names are excluded because they are ours, not notes. A remote
     * written before the lock moved out of the working tree still carries a
     * `.lock`, and staging it again would keep committing it to the user's notes
     * forever.
     */
    async stageAll(ignore: ReadonlySet<string>): Promise<boolean> {
        const excludes = [...ignore].map(name => `:(exclude)${name}`);
        await this.run(['add', '-A', '--', '.', ...excludes]);
        try {
            await this.run(['diff', '--cached', '--quiet']);
            return false; // nothing staged
        } catch (err: unknown) {
            rethrowIfAddonUnavailable(err);
            return true; // changes staged
        }
    }

    /** Commit the staged tree with `message`. */
    async commit(message: string): Promise<void> {
        await this.run(['commit', '-m', message]);
    }

    /**
     * Pull `origin/HEAD`, reporting whether the merge left conflicts.
     *
     * Returns false with nothing pulled when the remote is empty/unreachable or
     * has no matching ref. Throws for any other failure (e.g. unrelated
     * histories), so the caller can decide whether to heal or surface it.
     */
    async pull(): Promise<boolean> {
        try {
            // Check if remote has any commits first
            try {
                await this.run(['ls-remote', '--heads', 'origin']);
            } catch (err: unknown) {
                rethrowIfAddonUnavailable(err);
                return false; // Can't reach remote or empty
            }

            await this.run(['pull', '--no-rebase', 'origin', 'HEAD']);
            return false;
        } catch (err: unknown) {
            rethrowIfAddonUnavailable(err);
            // A conflicted merge is read off the index, not off git's words.
            // git announces one ("CONFLICT …", "Automatic merge failed …") on
            // *stdout*, which no runner keeps once the command has failed — and
            // those are English strings a localised git would not print anyway.
            // Unmerged index entries are the state the announcement describes,
            // and every conflicting merge leaves them.
            if (await this.hasUnmergedPaths()) {
                this.logger.warn('Merge conflicts detected');
                return true;
            }
            // If pull fails for non-conflict reasons (e.g. no upstream), that's OK
            const message = gitErrorText(err);
            if (message.includes('couldn\'t find remote ref') || message.includes('no tracking information')) {
                return false;
            }
            throw err;
        }
    }

    /**
     * Whether the index holds unmerged entries — the state a conflicted merge
     * leaves behind. Answers false when git cannot be asked at all, so a broken
     * repository surfaces as the pull failure it already is rather than as a
     * conflict nobody can resolve.
     */
    private async hasUnmergedPaths(): Promise<boolean> {
        try {
            return (await this.run(['ls-files', '--unmerged'])).length > 0;
        } catch (err: unknown) {
            rethrowIfAddonUnavailable(err);
            return false;
        }
    }

    /** Push the current HEAD to `origin`, setting upstream. Throws on failure. */
    async push(): Promise<void> {
        await this.run(['push', '-u', 'origin', 'HEAD']);
    }

    /** Push a single tag ref to `origin`. Throws on failure. */
    async pushTag(tag: string): Promise<void> {
        await this.run(['push', 'origin', `refs/tags/${tag}`]);
    }

    /** Create a lightweight tag `name` pointing at `ref`. */
    async tag(name: string, ref: string): Promise<void> {
        await this.run(['tag', name, ref]);
    }

    /** SHA of the current HEAD. */
    async headSha(): Promise<string> {
        return this.run(['rev-parse', 'HEAD']);
    }

    /**
     * Fetch `origin/HEAD` and return the fetched tip's SHA.
     *
     * The remote side must come out of git objects rather than the working tree.
     * When reconcile is reached by way of a failed pull, the tree on disk holds
     * the local mirror — reading it would merge local against itself.
     */
    async fetchHeadSha(): Promise<string> {
        await this.run(['fetch', 'origin', 'HEAD']);
        return this.run(['rev-parse', 'FETCH_HEAD']);
    }

    /**
     * Read a commit's full tree into memory, keyed the same way as a disk scan.
     * Names in `ignore` (e.g. a stray `.lock` a remote was pushed with) are never
     * note content, so they never enter the returned map.
     *
     * The blobs are read out of the object database rather than off `git show`'s
     * stdout. Stdout is text that loses one trailing line ending crossing the
     * runner, which a note cannot afford, and it is decoded as UTF-8, which an
     * attached image cannot survive. It is also what this method used to cost:
     * one child process per note, where the object read is a lookup.
     */
    async readTree(ref: string, ignore: ReadonlySet<string>): Promise<Map<string, Buffer>> {
        // -z keeps unusual filenames intact; git would otherwise quote them.
        const listing = await this.run(['ls-tree', '-r', '--name-only', '-z', ref]);
        const addon = loadNativeGit(); // once for the tree, not once per note
        const tree = new Map<string, Buffer>();
        for (const filePath of listing.split('\0')) {
            if (!filePath) continue;
            if (filePath.split('/').some(seg => ignore.has(seg))) continue;
            const bytes = await addon.gitFileBytesAtCommit(this.dir, ref, filePath);
            if (bytes === null) {
                // `ls-tree -r --name-only` listed this path a moment ago, so the
                // only way here is an entry that is not a blob — a gitlink.
                // Failing loudly beats returning nothing: the caller is
                // reconcile, and a note it cannot see reads as a deletion.
                throw new Error(`git show ${ref}:${filePath} failed: not a file`);
            }
            tree.set(filePath, bytes);
        }
        return tree;
    }

    /**
     * The branch the remote's HEAD points at, or null when it can't be read.
     * Reconcile targets the remote's default branch, so the merged commit has to
     * land on that branch rather than whatever this mirror happens to be on.
     */
    async defaultBranch(): Promise<string | null> {
        try {
            const out = await this.run(['ls-remote', '--symref', 'origin', 'HEAD']);
            return out.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m)?.[1] ?? null;
        } catch (err: unknown) {
            rethrowIfAddonUnavailable(err);
            return null; // fall back to the branch we're already on
        }
    }

    /** Point HEAD at `refs/heads/<branch>` without touching the working tree. */
    async setHeadToBranch(branch: string): Promise<void> {
        await this.run(['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
    }

    /** Move the current branch to `ref` and load its tree into the index. */
    async resetMixed(ref: string): Promise<void> {
        await this.run(['reset', '--mixed', ref]);
    }

    /** Paths git reports as conflicted after a merge (UU/AA/DU/UD). */
    async conflictedFiles(): Promise<string[]> {
        const statusOutput = await this.run(['status', '--porcelain']);
        return statusOutput
            .split('\n')
            .filter(line => line.startsWith('UU') || line.startsWith('AA') || line.startsWith('DU') || line.startsWith('UD'))
            .map(line => line.slice(3).trim());
    }

    /** Stage a single path. */
    async add(file: string): Promise<void> {
        await this.run(['add', file]);
    }

    /** Take the remote ("theirs") side of a conflicted path and stage it. */
    async checkoutTheirs(file: string): Promise<void> {
        await this.run(['checkout', '--theirs', file]);
        await this.run(['add', file]);
    }
}
