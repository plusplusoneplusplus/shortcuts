import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const skillDir = path.resolve(__dirname, '../../../../.github/skills/submit-commits-as-pr');
const content = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');

describe('submit-commits-as-pr skill', () => {
    it('has valid discovery metadata and a bounded body', () => {
        const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content);
        expect(match).not.toBeNull();
        const metadata = yaml.load(match![1]) as { name: string; description: string };
        expect(metadata.name).toBe(path.basename(skillDir));
        expect(metadata.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        expect(metadata.description.length).toBeGreaterThan(0);
        expect(metadata.description.length).toBeLessThanOrEqual(1024);
        expect(match![2].split('\n').length).toBeLessThan(500);
    });

    it('requires tool submission with exact nonempty commits and no script fallback', () => {
        expect(content).toContain("Use CoC's `create_pull_request` tool exclusively");
        expect(content).toContain('ALWAYS pass nonempty `commits`');
        expect(content).toContain('origin/<base>..HEAD');
        expect(content).toContain('never replace\n   it with the outgoing range');
        expect(content).toContain('oldest first');
        expect(content).not.toMatch(/submit_commits_as_pr|--gh-arg|--no-auto-merge|SUBMIT_PR_VERBOSE/);
        for (const filename of ['submit_commits_as_pr.py', 'test_resolve_commits.py', 'test_worktree_workflow.py']) {
            expect(fs.existsSync(path.join(skillDir, 'scripts', filename))).toBe(false);
        }
    });

    it('preserves authorized defaults, conflicts, ownership and retry boundaries', () => {
        for (const instruction of [
            'autoMerge: true', 'autoMerge: false', 'Invoking this skill authorizes',
            'mergeMethod', 'draft', 'NEVER resolve cherry-pick',
            "Never switch the active worktree's branch", 'bound: false',
            'Before any retry, check local/remote submission branches',
            'never blindly rerun', 'writable CoC context', 'requested repository',
            'only when the user explicitly asks to monitor the PR',
        ]) expect(content).toContain(instruction);
    });
});
