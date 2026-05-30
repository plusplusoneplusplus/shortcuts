/**
 * AC-03: Isolated rollout.
 *
 * For one (task, skill) pair:
 *   1. Create a fresh git worktree from HEAD.
 *   2. Inject the current skill into .github/skills/active-skill.md.
 *   3. Run the Copilot CLI (AC-01) with the task prompt (+ visible tests, NO hidden tests).
 *   4. Run hidden tests in the worktree before cleanup → hiddenTestPassRate.
 *   5. Capture the git diff.
 *   6. Clean up the worktree in a `finally` block (always).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, execSync } from 'child_process';
import { runCopilotCli, CliError, CopilotCliOptions } from './cli-driver';
import { Task } from './corpus';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RolloutResult {
    taskId: string;
    /** Full stdout from the Copilot CLI run. */
    stdout: string;
    /** `git diff HEAD` captured in the worktree. */
    diff: string;
    /** 0.0–1.0: pass rate of hidden tests run inside the worktree before cleanup. */
    hiddenTestPassRate: number;
    /** True if the worktree was successfully cleaned up. */
    worktreeCleanedUp: boolean;
}

export interface RolloutOptions extends CopilotCliOptions {
    /** Full content of the current skill document. */
    skillContent: string;
    /** Model name for the target agent. */
    model: string;
    /** Absolute path to the repository root (used for `git worktree add`). */
    repoRoot: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds the prompt shown to the target agent.
 * The skill is prepended as context; hidden tests are NEVER included.
 */
export function buildTargetPrompt(task: Task, skillContent: string): string {
    const parts: string[] = [
        '<!-- SKILL CONTEXT: follow the guidance below when implementing -->',
        skillContent.trim(),
        '<!-- END SKILL CONTEXT -->',
        '',
        task.prompt.trim(),
    ];

    if (task.visibleTests) {
        parts.push('', `Verify your work by running: \`${task.visibleTests}\``);
    }

    return parts.join('\n');
}

/**
 * Runs hidden tests (if any) in the given working directory.
 * Returns 1.0 if they pass (or if no hiddenTests command exists), 0.0 on failure.
 */
function runHiddenTests(task: Task, worktree: string): number {
    if (!task.hiddenTests) return 1.0;
    try {
        execSync(task.hiddenTests, { cwd: worktree, stdio: 'pipe', timeout: 60_000 });
        return 1.0;
    } catch {
        return 0.0;
    }
}

/** Removes a git worktree, falling back to rm on failure. */
function removeWorktree(worktreePath: string, repoRoot: string): void {
    try {
        execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
            cwd: repoRoot,
            stdio: 'pipe',
        });
    } catch {
        try {
            fs.rmSync(worktreePath, { recursive: true, force: true });
        } catch { /* best-effort */ }
    }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Runs a single rollout for the given task using the provided skill.
 * Always cleans up the git worktree (success or exception).
 */
export async function runRollout(
    task: Task,
    options: RolloutOptions
): Promise<RolloutResult> {
    const { skillContent, model, repoRoot, ...cliOptions } = options;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillopt-'));
    let worktreeAdded = false;

    try {
        execFileSync('git', ['worktree', 'add', '--detach', tmpDir, 'HEAD'], {
            cwd: repoRoot,
            stdio: 'pipe',
        });
        worktreeAdded = true;

        // Inject the skill into the worktree
        const skillDir = path.join(tmpDir, '.github', 'skills');
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'active-skill.md'), skillContent, 'utf-8');

        const prompt = buildTargetPrompt(task, skillContent);

        let stdout = '';
        let diff = '';
        let cliError: CliError | null = null;

        try {
            const result = await runCopilotCli(prompt, tmpDir, model, cliOptions);
            stdout = result.stdout;
            diff = result.diff;
        } catch (err) {
            if (err instanceof CliError) {
                // Surface the error details but continue to hidden tests / cleanup
                stdout = err.stdout;
                cliError = err;
            } else {
                throw err;
            }
        }

        // Hidden tests run here — inside the worktree, before cleanup
        const hiddenTestPassRate = runHiddenTests(task, tmpDir);

        if (cliError) {
            // Re-throw after capturing test results
            throw cliError;
        }

        return { taskId: task.id, stdout, diff, hiddenTestPassRate, worktreeCleanedUp: true };
    } finally {
        if (worktreeAdded) {
            removeWorktree(tmpDir, repoRoot);
        } else {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    }
}
