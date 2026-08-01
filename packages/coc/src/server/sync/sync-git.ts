/**
 * Git kernel for the notes sync engine.
 *
 * Every Git command the engine runs — and every rule for interpreting Git's
 * output — lives behind {@link SyncGitRepository}. Isolating it here keeps the
 * highest-risk external dependency in one place: failure modes like unrelated
 * histories, corrupt mirrors, unreachable remotes, and unborn HEAD can be
 * exercised against this class without driving the whole sync transaction.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { SyncLogger } from './sync-types';

const execFileAsync = promisify(execFile);

/**
 * The full text of a failed git command: its message plus stdout and stderr.
 *
 * A merge conflict is reported by git on stdout ("CONFLICT …", "Automatic merge
 * failed …"), and Node's `execFile` error keeps stdout on `.stdout` rather than
 * folding it into `.message` (which carries only stderr). A catch that inspects
 * just the message therefore can't tell a conflict from any other pull failure.
 */
export function gitErrorText(err: unknown): string {
    const e = err as { message?: unknown; stdout?: unknown; stderr?: unknown };
    return [e?.message, e?.stdout, e?.stderr]
        .filter((s): s is string => typeof s === 'string')
        .join('\n');
}

/**
 * A workspace's sync mirror, exposing the exact Git operations the sync engine
 * needs. All commands run with `this.dir` as the working directory.
 */
export class SyncGitRepository {
    constructor(
        private readonly dir: string,
        private readonly logger: SyncLogger,
    ) {}

    /** Run git and return trimmed utf8 stdout. */
    private async run(args: string[]): Promise<string> {
        const { stdout } = await execFileAsync('git', args, {
            cwd: this.dir,
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024,
            timeout: 120_000,
        });
        return stdout.trim();
    }

    /**
     * Run git and hand back raw stdout.
     *
     * The text helper decodes as utf8 and trims, which would corrupt an image and
     * strip a note's trailing newline. Reading blobs out of git objects has to be
     * byte-exact, so those calls come through here instead.
     */
    private async runBuffer(args: string[]): Promise<Buffer> {
        const { stdout } = await execFileAsync('git', args, {
            cwd: this.dir,
            encoding: 'buffer',
            maxBuffer: 64 * 1024 * 1024,
            timeout: 120_000,
        });
        return stdout;
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
        } catch {
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
        } catch {
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
        } catch {
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
        } catch {
            return false; // unreachable — nothing to pull this tick
        }
        const remoteHead = remoteLine.split(/\s+/)[0]?.trim();
        if (!remoteHead) return false; // empty remote

        let localHead: string;
        try {
            localHead = await this.run(['rev-parse', 'HEAD']);
        } catch {
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
        } catch {
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
            } catch {
                return false; // Can't reach remote or empty
            }

            await this.run(['pull', '--no-rebase', 'origin', 'HEAD']);
            return false;
        } catch (err: unknown) {
            // git writes merge-conflict notices to stdout, which Node keeps on the
            // exec error's `.stdout` rather than folding into `.message` — so read
            // the full output, or every steady-state conflict reads as a hard error
            // and never reaches the resolver.
            const message = gitErrorText(err);
            if (message.includes('CONFLICT') || message.includes('Automatic merge failed')) {
                this.logger.warn('Merge conflicts detected');
                return true;
            }
            // If pull fails for non-conflict reasons (e.g. no upstream), that's OK
            if (message.includes('couldn\'t find remote ref') || message.includes('no tracking information')) {
                return false;
            }
            throw err;
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
     */
    async readTree(ref: string, ignore: ReadonlySet<string>): Promise<Map<string, Buffer>> {
        // -z keeps unusual filenames intact; git would otherwise quote them.
        const listing = await this.run(['ls-tree', '-r', '--name-only', '-z', ref]);
        const tree = new Map<string, Buffer>();
        for (const filePath of listing.split('\0')) {
            if (!filePath) continue;
            if (filePath.split('/').some(seg => ignore.has(seg))) continue;
            tree.set(filePath, await this.runBuffer(['show', `${ref}:${filePath}`]));
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
        } catch {
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
