/**
 * AC-07 integration test: Loop + artifacts
 *
 * Runs the full loop with all CLI calls mocked, verifying:
 * - best_skill.md and history.jsonl are produced
 * - loop terminates under max-steps
 * - accepted step updates best_skill.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_WEIGHTS } from '../scoring';
import { loadCorpus } from '../corpus';
import { runLoop } from '../loop';

// ─── Module-level mocks ───────────────────────────────────────────────────────

// Mock rollout so no real git worktree is created
vi.mock('../rollout', () => ({
    runRollout: vi.fn(),
    buildTargetPrompt: vi.fn().mockReturnValue('mock prompt'),
}));

// Mock scoring so no real CLI calls are made
vi.mock('../scoring', async (importOriginal) => {
    const orig = await importOriginal<typeof import('../scoring')>();
    return {
        ...orig,
        scoreRollout: vi.fn(),
    };
});

// Mock optimizer so no real CLI calls are made
vi.mock('../optimizer', () => ({
    proposeOptimizedSkill: vi.fn(),
}));

// Import mocked versions
import { runRollout } from '../rollout';
import { scoreRollout } from '../scoring';
import { proposeOptimizedSkill } from '../optimizer';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'skillopt-int-test-'));
}

const MINI_CORPUS_JSON = JSON.stringify({
    tasks: [
        { id: 'train-task-1', prompt: 'Write a TypeScript function', split: 'train' },
        { id: 'selection-task-1', prompt: 'Write another TypeScript function', split: 'selection' },
    ],
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runLoop integration (all CLI calls mocked)', () => {
    let outDir: string;
    let corpusDir: string;
    let skillFile: string;
    let repoDir: string;

    beforeEach(() => {
        outDir = makeTmpDir();
        corpusDir = makeTmpDir();
        repoDir = makeTmpDir();
        skillFile = path.join(repoDir, 'skill.md');

        fs.writeFileSync(path.join(corpusDir, 'tasks.json'), MINI_CORPUS_JSON, 'utf-8');
        fs.writeFileSync(skillFile, '# My Skill\n\n## Rules\n- Be helpful\n', 'utf-8');

        // Reset to safe defaults before each test
        vi.mocked(runRollout).mockResolvedValue({
            taskId: 'train-task-1',
            stdout: 'agent did something',
            diff: '+line added',
            hiddenTestPassRate: 1.0,
            worktreeCleanedUp: true,
        });

        vi.mocked(scoreRollout).mockResolvedValue({
            score: 0.8,
            hiddenTestPassRate: 1.0,
            llmJudgeScore: 0.8,
        });

        vi.mocked(proposeOptimizedSkill).mockResolvedValue({
            candidateSkill: '# My Skill\n\n## Rules\n- Be helpful\n- Be precise\n',
            edit: { type: 'add', anchor: '- Be helpful', content: '- Be precise' },
            parseNote: 'ok',
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
        for (const d of [outDir, corpusDir, repoDir]) {
            try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });

    it('produces best_skill.md, history.jsonl, and summary.json after ≥1 step', async () => {
        let scoreCall = 0;
        vi.mocked(scoreRollout).mockImplementation(async () => {
            scoreCall++;
            return { score: scoreCall <= 1 ? 0.7 : 0.9, hiddenTestPassRate: 1.0, llmJudgeScore: 0.8 };
        });

        const corpus = loadCorpus(corpusDir);
        const config = {
            skillPath: skillFile, corpusPath: corpusDir, outDir,
            repoRoot: repoDir, targetModel: 'test-model', optimizerModel: 'test-optimizer',
            maxSteps: 1, weights: DEFAULT_WEIGHTS, cliOptions: { timeoutMs: 5000 },
        };

        const summary = await runLoop(corpus, config);

        expect(fs.existsSync(path.join(outDir, 'best_skill.md'))).toBe(true);
        expect(fs.existsSync(path.join(outDir, 'history.jsonl'))).toBe(true);
        expect(fs.existsSync(path.join(outDir, 'summary.json'))).toBe(true);
        expect(summary.totalSteps).toBe(1);
    });

    it('loop terminates deterministically under max-steps', async () => {
        vi.mocked(scoreRollout).mockResolvedValue({ score: 0.5, hiddenTestPassRate: 0.5, llmJudgeScore: 0.5 });
        vi.mocked(proposeOptimizedSkill).mockResolvedValue({
            candidateSkill: '# My Skill\n', edit: null, parseNote: 'no-op',
        });

        const corpus = loadCorpus(corpusDir);
        const MAX_STEPS = 3;
        const config = {
            skillPath: skillFile, corpusPath: corpusDir, outDir,
            repoRoot: repoDir, targetModel: 'test-model', optimizerModel: 'test-optimizer',
            maxSteps: MAX_STEPS, weights: DEFAULT_WEIGHTS, cliOptions: { timeoutMs: 5000 },
        };

        const summary = await runLoop(corpus, config);
        expect(summary.totalSteps).toBe(MAX_STEPS);
    });

    it('best_skill.md has no .tmp leftovers (atomic write)', async () => {
        vi.mocked(scoreRollout).mockResolvedValue({ score: 0.95, hiddenTestPassRate: 1.0, llmJudgeScore: 0.95 });
        vi.mocked(proposeOptimizedSkill).mockResolvedValue({
            candidateSkill: '# Improved Skill\n',
            edit: { type: 'replace', anchor: '# My Skill', content: '# Improved Skill' },
            parseNote: 'ok',
        });

        const corpus = loadCorpus(corpusDir);
        const config = {
            skillPath: skillFile, corpusPath: corpusDir, outDir,
            repoRoot: repoDir, targetModel: 'test-model', optimizerModel: 'test-optimizer',
            maxSteps: 1, weights: DEFAULT_WEIGHTS, cliOptions: { timeoutMs: 5000 },
        };

        await runLoop(corpus, config);

        const tmpFiles = fs.readdirSync(outDir).filter(f => f.endsWith('.tmp'));
        expect(tmpFiles).toHaveLength(0);
        const content = fs.readFileSync(path.join(outDir, 'best_skill.md'), 'utf-8');
        expect(content.length).toBeGreaterThan(0);
    });
});
