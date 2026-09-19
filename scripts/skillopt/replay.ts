/**
 * Replay runner for the skillopt dataset.
 *
 * For each task that has a seedRef (baseline commit):
 *   1. Create a git worktree at the seedRef.
 *   2. Run `claude -p "<prompt>"` inside the worktree.
 *   3. Stage all changes, create a commit, capture the SHA.
 *   4. Write results (task id, candidate commit, reference commit, diff stat) to a JSONL file.
 *   5. Clean up the worktree.
 *
 * Usage:
 *   npx tsx scripts/skillopt/replay.ts [options]
 *
 *   --corpus <path>     Task corpus JSON file (default: scripts/skillopt/corpus/replay-tasks.json)
 *   --out <path>        Output directory for results (default: _skillopt_replay)
 *   --task <id>         Run only this task (repeatable). Omit to run all seeded tasks.
 *   --model <model>     Claude model to use (default: claude-sonnet-4-6)
 *   --timeout-ms <ms>   Per-task timeout (default: 600000 = 10 min)
 *   --skill <path>      Optional skill document to inject as system prompt context
 *   --dangerously-skip-permissions  Pass --dangerously-skip-permissions to claude
 *   --help / -h         Show help and exit
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawn } from 'child_process';
import { loadCorpus, Task } from './corpus';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReplayResult {
    taskId: string;
    seedRef: string;
    referenceResultRef?: string;
    candidateCommit?: string;
    diffStat: string;
    exitCode: number;
    durationMs: number;
    error?: string;
}

interface ReplayOptions {
    corpusPath: string;
    outDir: string;
    taskIds: string[];
    model: string;
    timeoutMs: number;
    skillPath?: string;
    dangerouslySkipPermissions: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function git(args: string[], cwd: string): string {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

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

function spawnClaude(
    prompt: string,
    cwd: string,
    model: string,
    timeoutMs: number,
    dangerouslySkipPermissions: boolean,
): Promise<{ stdout: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
        const args = [
            '-p', prompt,
            '--model', model,
            '--output-format', 'text',
            '--no-color',
        ];
        if (dangerouslySkipPermissions) {
            args.push('--dangerously-skip-permissions');
        }

        const proc = spawn('claude', args, { cwd, env: { ...process.env } });
        let output = '';
        let timer: ReturnType<typeof setTimeout> | undefined;

        if (timeoutMs > 0) {
            timer = setTimeout(() => {
                try { proc.kill('SIGTERM'); } catch { /* ignore */ }
                setTimeout(() => {
                    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
                }, 5_000);
                reject(new Error(`claude timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        }

        proc.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
        proc.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString(); });

        proc.on('error', (err: NodeJS.ErrnoException) => {
            if (timer) clearTimeout(timer);
            reject(err);
        });

        proc.on('close', (code: number | null) => {
            if (timer) clearTimeout(timer);
            resolve({ stdout: output, exitCode: code ?? -1 });
        });
    });
}

// ─── Core replay ──────────────────────────────────────────────────────────────

async function replayTask(
    task: Task,
    repoRoot: string,
    opts: ReplayOptions,
): Promise<ReplayResult> {
    const seedRef = task.seedRef!;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `skillopt-replay-${task.id}-`));
    let worktreeAdded = false;
    const start = Date.now();

    try {
        git(['worktree', 'add', '--detach', tmpDir, seedRef], repoRoot);
        worktreeAdded = true;

        let prompt = task.prompt;
        if (opts.skillPath) {
            const skillContent = fs.readFileSync(opts.skillPath, 'utf-8');
            prompt = [
                '<!-- SKILL CONTEXT: follow the guidance below when implementing -->',
                skillContent.trim(),
                '<!-- END SKILL CONTEXT -->',
                '',
                task.prompt,
            ].join('\n');
        }

        console.log(`  Running claude -p for task "${task.id}" (model: ${opts.model})...`);
        const { stdout, exitCode } = await spawnClaude(
            prompt,
            tmpDir,
            opts.model,
            opts.timeoutMs,
            opts.dangerouslySkipPermissions,
        );

        // Save raw stdout
        const stdoutPath = path.join(opts.outDir, `${task.id}.stdout.txt`);
        fs.writeFileSync(stdoutPath, stdout, 'utf-8');

        // Stage all changes, create a commit, capture SHA
        let candidateCommit: string | undefined;
        let diffStat = '';

        try {
            git(['add', '-A'], tmpDir);
            const status = git(['status', '--porcelain'], tmpDir);
            if (status.length > 0) {
                git(
                    ['commit', '-m', `skillopt replay: ${task.id}`, '--author', 'skillopt <skillopt@local>'],
                    tmpDir,
                );
                candidateCommit = git(['rev-parse', 'HEAD'], tmpDir);
                diffStat = git(['diff', '--stat', seedRef, 'HEAD'], tmpDir);
            } else {
                diffStat = '(no changes)';
            }
        } catch (e) {
            diffStat = `(commit failed: ${(e as Error).message})`;
        }

        return {
            taskId: task.id,
            seedRef,
            referenceResultRef: task.referenceResultRef,
            candidateCommit,
            diffStat,
            exitCode,
            durationMs: Date.now() - start,
        };
    } catch (e) {
        return {
            taskId: task.id,
            seedRef,
            referenceResultRef: task.referenceResultRef,
            diffStat: '',
            exitCode: -1,
            durationMs: Date.now() - start,
            error: (e as Error).message,
        };
    } finally {
        if (worktreeAdded) {
            removeWorktree(tmpDir, repoRoot);
        } else {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function printHelp(): void {
    console.log(`
skillopt replay — replay dataset tasks with claude -p and capture result commits

Usage:
  npx tsx scripts/skillopt/replay.ts [options]

Options:
  --corpus <path>         Task corpus JSON file                  (default: scripts/skillopt/corpus/replay-tasks.json)
  --out <path>            Output directory for results           (default: _skillopt_replay)
  --task <id>             Run only this task (repeatable)
  --model <model>         Claude model                           (default: claude-sonnet-4-6)
  --timeout-ms <ms>       Per-task timeout                       (default: 600000)
  --skill <path>          Skill document to inject as context
  --dangerously-skip-permissions  Pass flag to claude CLI
  --help / -h             Show help
`);
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const opts: ReplayOptions = {
        corpusPath: 'scripts/skillopt/corpus/replay-tasks.json',
        outDir: '_skillopt_replay',
        taskIds: [],
        model: 'claude-sonnet-4-6',
        timeoutMs: 600_000,
        dangerouslySkipPermissions: false,
    };

    for (let i = 0; i < argv.length; i++) {
        switch (argv[i]) {
            case '--corpus':      opts.corpusPath = argv[++i]; break;
            case '--out':         opts.outDir = argv[++i]; break;
            case '--task':        opts.taskIds.push(argv[++i]); break;
            case '--model':       opts.model = argv[++i]; break;
            case '--timeout-ms':  opts.timeoutMs = Number(argv[++i]); break;
            case '--skill':       opts.skillPath = argv[++i]; break;
            case '--dangerously-skip-permissions':
                opts.dangerouslySkipPermissions = true;
                break;
            case '-h':
            case '--help':
                printHelp();
                process.exit(0);
            default:
                console.error(`Unknown option: ${argv[i]}`);
                printHelp();
                process.exit(1);
        }
    }

    const repoRoot = git(['rev-parse', '--show-toplevel'], process.cwd());
    const corpus = loadCorpus(path.resolve(repoRoot, opts.corpusPath));

    // Filter to seeded tasks only; optionally filter by --task ids
    let tasks = corpus.tasks.filter(t => t.seedRef);
    if (opts.taskIds.length > 0) {
        const requested = new Set(opts.taskIds);
        const missing = opts.taskIds.filter(id => !tasks.find(t => t.id === id));
        if (missing.length > 0) {
            console.error(`Unknown or non-seeded task ids: ${missing.join(', ')}`);
            process.exit(1);
        }
        tasks = tasks.filter(t => requested.has(t.id));
    }

    if (tasks.length === 0) {
        console.error('No seeded tasks to replay.');
        process.exit(1);
    }

    fs.mkdirSync(opts.outDir, { recursive: true });

    const resultsPath = path.join(opts.outDir, 'results.jsonl');
    const summaryPath = path.join(opts.outDir, 'summary.json');

    console.log(`Replaying ${tasks.length} task(s) with model ${opts.model}`);
    console.log(`Output → ${path.resolve(opts.outDir)}\n`);

    const results: ReplayResult[] = [];

    for (const task of tasks) {
        console.log(`[${results.length + 1}/${tasks.length}] ${task.id} (seed: ${task.seedRef!.slice(0, 10)})`);
        const result = await replayTask(task, repoRoot, opts);
        results.push(result);

        fs.appendFileSync(resultsPath, JSON.stringify(result) + '\n', 'utf-8');

        if (result.error) {
            console.log(`  ERROR: ${result.error} (${result.durationMs}ms)\n`);
        } else {
            console.log(`  commit: ${result.candidateCommit ?? '(none)'}`);
            console.log(`  ref:    ${result.referenceResultRef ?? '(none)'}`);
            console.log(`  time:   ${result.durationMs}ms`);
            console.log(`  stat:\n${result.diffStat.split('\n').map(l => '    ' + l).join('\n')}\n`);
        }
    }

    const summary = {
        model: opts.model,
        totalTasks: tasks.length,
        succeeded: results.filter(r => !r.error && r.candidateCommit).length,
        failed: results.filter(r => r.error).length,
        noChanges: results.filter(r => !r.error && !r.candidateCommit).length,
        totalDurationMs: results.reduce((s, r) => s + r.durationMs, 0),
        results,
    };
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf-8');

    console.log('─'.repeat(60));
    console.log(`Done. ${summary.succeeded}/${summary.totalTasks} tasks produced commits.`);
    console.log(`Results: ${path.resolve(resultsPath)}`);
    console.log(`Summary: ${path.resolve(summaryPath)}`);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
