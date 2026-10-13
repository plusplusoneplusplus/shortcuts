import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const skillDir = path.resolve(__dirname, '../../../../.github/skills/submit-commits-as-pr');
// Windows checkouts may convert to CRLF; multi-line assertions expect LF.
const content = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');

describe('submit-commits-as-pr skill', () => {
    it('has valid discovery metadata and a bounded body', () => {
        const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content);
        expect(match).not.toBeNull();
        const metadata = yaml.load(match![1]) as { name: string; description: string };
        expect(metadata.name).toBe(path.basename(skillDir));
        expect(metadata.name.length).toBeLessThanOrEqual(64);
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

    it('uses confirmed native automation for full auto without duplicate AI polling', () => {
        const prose = content.replace(/\s+/g, ' ');
        for (const instruction of [
            '"full auto", "monitor until merged", and generic PR monitoring as requests for native automation, not AI polling',
            'autoFix.requested', 'autoFix.enabled', 'autoFix.scope', 'autoFix.triggerId', 'autoFix.warning',
            'enabled is true, scope is `ci-and-conflicts`, a trigger ID is returned, and the PR is bound to the owner conversation',
            'Do not create an AI cron when native auto-fix is active',
            'report the PR URL and current pending status, then end the submission turn',
            'submission chat or its Sentinel parent',
            'disarms on merged or closed PRs without firing a wake',
        ]) expect(prose).toContain(instruction);
        expect(content).not.toContain('## Monitor mode');
    });

    it('keeps failures visible and polling and repair authorization explicit', () => {
        const prose = content.replace(/\s+/g, ' ');
        for (const instruction of [
            'Ordinary submission, auto-merge, and generic monitoring requests grant no repair authority',
            'autoFix: true` only when the user authorizes both CI and conflict repairs',
            'native automation is disabled or unavailable, binding fails, or auto-merge or auto-fix enablement warns/fails',
            'report the specific limitation and actual PR status',
            'Never silently fall back to AI cron',
            'Do not resubmit to repair automation or binding',
            'Separately explicit user requests for AI polling/cron remain supported',
            'owning workspace, PR, authorized checks/fixes, and a stop condition when merged or closed',
        ]) expect(prose).toContain(instruction);
    });

    it('preserves authorized defaults, conflicts, ownership and retry boundaries', () => {
        for (const instruction of [
            'autoMerge: true', 'autoMerge: false', 'Invoking this skill authorizes',
            'mergeMethod', 'draft', 'NEVER resolve cherry-pick',
            "Never switch the active worktree's branch", 'bound: false',
            'Before any retry, check local/remote submission branches',
            'never blindly rerun', 'writable CoC context', 'requested repository',
        ]) expect(content).toContain(instruction);
    });
});
