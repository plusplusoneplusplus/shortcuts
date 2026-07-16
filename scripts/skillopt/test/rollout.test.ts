/**
 * AC-03 tests: Isolated rollout
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCopilotCli } from '../cli-driver';
import { buildTargetPrompt, runRollout } from '../rollout';
import { Task } from '../corpus';

vi.mock('../cli-driver', () => ({
    runCopilotCli: vi.fn(),
    captureGitDiff: vi.fn().mockReturnValue(''),
    CliError: class CliError extends Error {
        exitCode: number;
        stdout: string;
        constructor(msg: string, code: number, out: string) {
            super(msg);
            this.exitCode = code;
            this.stdout = out;
        }
    },
}));

// ─── buildTargetPrompt tests ──────────────────────────────────────────────────

describe('buildTargetPrompt', () => {
    const task: Task = {
        id: 't1',
        prompt: 'Implement a function',
        split: 'train',
    };

    const taskWithTests: Task = {
        ...task,
        visibleTests: 'echo visible-test',
        hiddenTests: 'echo hidden-test',
    };

    it('includes skill content in the prompt', () => {
        const skill = '# My Skill\nDo things well.';
        const prompt = buildTargetPrompt(task, skill);
        expect(prompt).toContain('# My Skill');
        expect(prompt).toContain('Do things well.');
    });

    it('includes the task prompt', () => {
        const prompt = buildTargetPrompt(task, '# Skill');
        expect(prompt).toContain('Implement a function');
    });

    it('includes visible tests when present', () => {
        const prompt = buildTargetPrompt(taskWithTests, '# Skill');
        expect(prompt).toContain('echo visible-test');
    });

    it('NEVER includes hidden tests in the prompt', () => {
        const prompt = buildTargetPrompt(taskWithTests, '# Skill');
        expect(prompt).not.toContain('echo hidden-test');
    });

    it('does not include hidden tests even if visibleTests is absent', () => {
        const taskHiddenOnly: Task = {
            id: 'h1',
            prompt: 'do something',
            hiddenTests: 'secret-cmd',
            split: 'train',
        };
        const prompt = buildTargetPrompt(taskHiddenOnly, '# Skill');
        expect(prompt).not.toContain('secret-cmd');
    });
});

// ─── runRollout tests (with mocked CLI + git) ─────────────────────────────────

describe('runRollout (mocked)', () => {
    let tmpRepoDir: string;

    beforeEach(() => {
        tmpRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillopt-rollout-test-'));
        // Init a bare git repo so worktree commands can run
        try {
            const { execSync } = require('child_process');
            execSync('git init', { cwd: tmpRepoDir, stdio: 'pipe' });
            execSync('git config user.email "test@test.com"', { cwd: tmpRepoDir, stdio: 'pipe' });
            execSync('git config user.name "Test"', { cwd: tmpRepoDir, stdio: 'pipe' });
            // Create an initial commit so HEAD exists
            fs.writeFileSync(path.join(tmpRepoDir, 'README.md'), '# Test', 'utf-8');
            execSync('git add .', { cwd: tmpRepoDir, stdio: 'pipe' });
            execSync('git commit -m "init"', { cwd: tmpRepoDir, stdio: 'pipe' });
        } catch {
            // git not available or init failed — integration test will skip
        }
    });

    afterEach(() => {
        fs.rmSync(tmpRepoDir, { recursive: true, force: true });
    });

    it('buildTargetPrompt keeps primary worktree unchanged after construction', () => {
        // This test verifies that just building a prompt doesn't modify the primary tree
        const task: Task = {
            id: 'test-task',
            prompt: 'add something',
            split: 'train',
        };
        const skill = '# Skill\nDo good work.';
        const before = fs.readdirSync(tmpRepoDir).sort();
        buildTargetPrompt(task, skill);
        const after = fs.readdirSync(tmpRepoDir).sort();
        expect(after).toEqual(before);
    });

    it('worktree cleanup is attempted on rollout error (integration-style)', async () => {
        // Only run if git is available
        let gitAvailable = false;
        try {
            const { execSync } = require('child_process');
            execSync('git --version', { stdio: 'pipe' });
            gitAvailable = true;
        } catch { /* skip */ }

        if (!gitAvailable) return;

        vi.mocked(runCopilotCli).mockRejectedValue(
            Object.assign(new Error('CLI failed'), { exitCode: 1, stdout: '' })
        );
        const task: Task = {
            id: 'cleanup-test',
            prompt: 'do something',
            split: 'train',
        };

        // Collect all worktrees before
        const { execSync } = require('child_process');
        let worktreesBeforeRaw = '';
        try {
            worktreesBeforeRaw = execSync('git worktree list', { cwd: tmpRepoDir, encoding: 'utf-8', stdio: 'pipe' });
        } catch { return; } // no git

        await expect(runRollout(task, {
            skillContent: '# Skill',
            model: 'test-model',
            repoRoot: tmpRepoDir,
        })).rejects.toThrow();

        // After error, the worktree count should be back to what it was
        const worktreesAfterRaw = execSync('git worktree list', { cwd: tmpRepoDir, encoding: 'utf-8', stdio: 'pipe' });
        expect(worktreesAfterRaw.trim().split('\n').length).toBe(
            worktreesBeforeRaw.trim().split('\n').length
        );

        vi.restoreAllMocks();
    });
});
