#!/usr/bin/env npx tsx
/**
 * AC-08: SkillOpt CLI entrypoint.
 *
 * Usage:
 *   npx tsx scripts/skillopt/skillopt.ts [options]
 *
 * Required:
 *   --skill <path>         Path to the skill document to optimize (e.g. .github/skills/impl/SKILL.md)
 *   --corpus <path>        Path to the task corpus directory or tasks.json file
 *   --out <path>           Output directory for artifacts (best_skill.md, history.jsonl, summary.json)
 *
 * Optional:
 *   --target-model <m>     Copilot model for the target agent (default: "claude-sonnet-4.6")
 *   --optimizer-model <m>  Copilot model for the optimizer (default: same as --target-model)
 *   --max-steps <n>        Maximum optimization steps (default: 10)
 *   --w1 <weight>          Weight for hidden-test pass rate (default: 0.7)
 *   --w2 <weight>          Weight for LLM-judge score (default: 0.3)
 *   --timeout-ms <ms>      Per-CLI-call timeout in milliseconds (default: 300000)
 *   --help                 Show this help message and exit
 *
 * Prerequisites:
 *   - `copilot` must be on PATH and authenticated (`copilot auth login`).
 *   - Run from the repository root (or pass --corpus with an absolute path).
 *
 * Example:
 *   npx tsx scripts/skillopt/skillopt.ts \
 *     --skill .github/skills/impl/SKILL.md \
 *     --corpus scripts/skillopt/corpus \
 *     --out ./_skillopt_run \
 *     --max-steps 1
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { parseArgs } from 'util';
import { loadCorpus } from './corpus';
import { LoopConfig, runLoop } from './loop';
import { DEFAULT_WEIGHTS } from './scoring';

// ─── Help ─────────────────────────────────────────────────────────────────────

const HELP = `
SkillOpt — optimize a CoC skill document via RL-style loops with the Copilot CLI.

Usage:
  npx tsx scripts/skillopt/skillopt.ts [options]

Required:
  --skill <path>         Skill document to optimize (e.g. .github/skills/impl/SKILL.md)
  --corpus <path>        Task corpus directory or tasks.json file
  --out <path>           Output directory for artifacts

Optional:
  --target-model <m>     Copilot model for target agent  (default: claude-sonnet-4.6)
  --optimizer-model <m>  Copilot model for optimizer     (default: same as --target-model)
  --max-steps <n>        Max optimization steps          (default: 10)
  --w1 <weight>          Hidden-test weight              (default: 0.7)
  --w2 <weight>          LLM-judge weight                (default: 0.3)
  --timeout-ms <ms>      Per-CLI-call timeout ms         (default: 300000)
  --help                 Show this help and exit

Prerequisites:
  - copilot CLI must be on PATH and authenticated (copilot auth login)
  - Run from the repository root

Example:
  npx tsx scripts/skillopt/skillopt.ts \\
    --skill .github/skills/impl/SKILL.md \\
    --corpus scripts/skillopt/corpus \\
    --out ./_skillopt_run \\
    --max-steps 1
`.trim();

// ─── Parse args ───────────────────────────────────────────────────────────────

function parseCliArgs() {
    let parsed: ReturnType<typeof parseArgs>;
    try {
        parsed = parseArgs({
            options: {
                skill: { type: 'string' },
                corpus: { type: 'string' },
                out: { type: 'string' },
                'target-model': { type: 'string' },
                'optimizer-model': { type: 'string' },
                'max-steps': { type: 'string' },
                w1: { type: 'string' },
                w2: { type: 'string' },
                'timeout-ms': { type: 'string' },
                help: { type: 'boolean', short: 'h' },
            },
            strict: false,
            allowPositionals: false,
        });
    } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        console.error('Run with --help for usage.');
        process.exit(1);
    }
    return parsed;
}

// ─── Copilot pre-flight check ─────────────────────────────────────────────────

function checkCopilotOnPath(): void {
    try {
        execSync('copilot --version', { stdio: 'pipe', timeout: 10_000 });
    } catch (err) {
        const isEnoent = (err as NodeJS.ErrnoException).code === 'ENOENT' ||
            (err as NodeJS.ErrnoException).code === 'ENOEXEC';
        if (isEnoent) {
            console.error('Error: copilot binary not found on PATH.');
            console.error('Install the GitHub Copilot CLI: https://docs.github.com/en/copilot/github-copilot-in-the-cli');
            console.error('Then authenticate: copilot auth login');
        } else {
            console.error(`Error: failed to run copilot --version: ${(err as Error).message}`);
        }
        process.exit(1);
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const { values } = parseCliArgs();

    if (values.help) {
        console.log(HELP);
        process.exit(0);
    }

    // Required args
    if (!values.skill || !values.corpus || !values.out) {
        console.error('Error: --skill, --corpus, and --out are required.');
        console.error('Run with --help for usage.');
        process.exit(1);
    }

    const skillPath = path.resolve(values.skill as string);
    const corpusPath = path.resolve(values.corpus as string);
    const outDir = path.resolve(values.out as string);

    if (!fs.existsSync(skillPath)) {
        console.error(`Error: skill file not found: ${skillPath}`);
        process.exit(1);
    }

    // Pre-flight: copilot on PATH
    checkCopilotOnPath();

    // Load corpus
    let corpus;
    try {
        corpus = loadCorpus(corpusPath);
    } catch (err) {
        console.error(`Error loading corpus: ${(err as Error).message}`);
        process.exit(1);
    }

    // Model / step config
    const targetModel = (values['target-model'] as string | undefined) ?? 'claude-sonnet-4.6';
    const optimizerModel = (values['optimizer-model'] as string | undefined) ?? targetModel;
    const maxSteps = parseInt((values['max-steps'] as string | undefined) ?? '10', 10);
    const w1 = parseFloat((values.w1 as string | undefined) ?? String(DEFAULT_WEIGHTS.hiddenTestWeight));
    const w2 = parseFloat((values.w2 as string | undefined) ?? String(DEFAULT_WEIGHTS.llmJudgeWeight));
    const timeoutMs = parseInt((values['timeout-ms'] as string | undefined) ?? '300000', 10);

    if (isNaN(maxSteps) || maxSteps < 1) {
        console.error('Error: --max-steps must be a positive integer');
        process.exit(1);
    }
    if (isNaN(w1) || isNaN(w2) || w1 < 0 || w2 < 0) {
        console.error('Error: --w1 and --w2 must be non-negative numbers');
        process.exit(1);
    }

    const repoRoot = path.resolve('.');

    const config: LoopConfig = {
        skillPath,
        corpusPath,
        outDir,
        repoRoot,
        targetModel,
        optimizerModel,
        maxSteps,
        weights: { hiddenTestWeight: w1, llmJudgeWeight: w2 },
        cliOptions: { timeoutMs },
    };

    console.log('[skillopt] SkillOpt starting');
    console.log(`[skillopt]   skill:          ${skillPath}`);
    console.log(`[skillopt]   corpus:         ${corpusPath} (${corpus.trainTasks.length} train, ${corpus.selectionTasks.length} selection)`);
    console.log(`[skillopt]   out:            ${outDir}`);
    console.log(`[skillopt]   target-model:   ${targetModel}`);
    console.log(`[skillopt]   optimizer-model: ${optimizerModel}`);
    console.log(`[skillopt]   max-steps:      ${maxSteps}`);
    console.log(`[skillopt]   weights:        w1=${w1} w2=${w2}`);

    try {
        const summary = await runLoop(corpus, config);
        console.log(`\n[skillopt] Final score: ${summary.finalScore.toFixed(4)} (accepted ${summary.acceptedSteps}/${summary.totalSteps} steps)`);
        console.log(`[skillopt] Artifacts written to: ${outDir}`);
    } catch (err) {
        console.error(`\n[skillopt] Fatal error: ${(err as Error).message}`);
        process.exit(1);
    }
}

main();
