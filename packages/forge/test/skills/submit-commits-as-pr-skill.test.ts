import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const skillDir = path.resolve(__dirname, '../../../../.github/skills/submit-commits-as-pr');
// Normalize Windows line endings for the body line count.
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

    it('does not ship retired script-based submission helpers', () => {
        for (const filename of ['submit_commits_as_pr.py', 'test_resolve_commits.py', 'test_worktree_workflow.py']) {
            expect(fs.existsSync(path.join(skillDir, 'scripts', filename))).toBe(false);
        }
    });
});
