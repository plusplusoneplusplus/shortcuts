/**
 * Unit tests for the display-only shell-command semantic classifier.
 *
 * Covers direct / interpreter-wrapped / path-qualified forms, quoting,
 * pipelines and same-family chains, mutation counterexamples, false positives
 * where a family word only appears in an argument, and safe fallback to Shell.
 */

import { describe, it, expect } from 'vitest';
import { classifyShellCommand } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/shellCommandClassifier';

describe('classifyShellCommand — Search', () => {
    it('classifies a direct rg command', () => {
        const info = classifyShellCommand('rg foo src');
        expect(info?.family).toBe('search');
        expect(info?.label).toBe('Search');
        expect(info?.cls).toBe('grep');
        expect(info?.metricKind).toBe('hits');
        expect(info?.summary).toBe('foo in src');
    });

    it('classifies grep and shows the pattern without a path', () => {
        const info = classifyShellCommand('grep -rn "kusto|plugin"');
        expect(info?.family).toBe('search');
        expect(info?.summary).toBe('kusto|plugin');
    });

    it('unwraps a /bin/zsh -lc wrapper', () => {
        const info = classifyShellCommand("/bin/zsh -lc 'rg \"foo bar\" src'");
        expect(info?.family).toBe('search');
        expect(info?.summary).toBe('foo bar in src');
    });

    it('classifies a path-qualified executable', () => {
        const info = classifyShellCommand('/usr/bin/rg needle');
        expect(info?.family).toBe('search');
        expect(info?.summary).toBe('needle');
    });

    it('uses the -e pattern argument', () => {
        const info = classifyShellCommand('grep -e mypattern file.txt');
        expect(info?.family).toBe('search');
        expect(info?.summary).toBe('mypattern in file.txt');
    });

    it('skips value-taking flags when finding the pattern', () => {
        const info = classifyShellCommand('rg -C 3 target packages');
        expect(info?.family).toBe('search');
        expect(info?.summary).toBe('target in packages');
    });

    it('allows an rg | head presentation pipeline', () => {
        const info = classifyShellCommand('rg foo src | head -n 20');
        expect(info?.family).toBe('search');
        expect(info?.summary).toBe('foo in src');
    });
});

describe('classifyShellCommand — Read', () => {
    it('classifies cat', () => {
        const info = classifyShellCommand('cat src/index.ts');
        expect(info?.family).toBe('read');
        expect(info?.label).toBe('Read');
        expect(info?.cls).toBe('read');
        expect(info?.metricKind).toBe('lines');
        expect(info?.summary).toBe('src/index.ts');
    });

    it('classifies read-only sed -n with a line range', () => {
        const info = classifyShellCommand("sed -n '1,240p' .github/skills/coc-knowledge/SKILL.md");
        expect(info?.family).toBe('read');
        expect(info?.summary).toBe('.github/skills/coc-knowledge/SKILL.md, lines 1–240');
    });

    it('classifies head with -n value flag', () => {
        const info = classifyShellCommand('head -n 50 file.log');
        expect(info?.family).toBe('read');
        expect(info?.summary).toBe('file.log');
    });

    it('allows nl file | sed -n', () => {
        const info = classifyShellCommand("nl file.ts | sed -n '10,20p'");
        expect(info?.family).toBe('read');
        expect(info?.summary).toBe('file.ts');
    });

    it('does NOT treat cat -n as a value flag (still reads the file)', () => {
        const info = classifyShellCommand('cat -n file.ts');
        expect(info?.family).toBe('read');
        expect(info?.summary).toBe('file.ts');
    });
});

describe('classifyShellCommand — Files', () => {
    it('classifies rg --files as Files, not Search', () => {
        const info = classifyShellCommand('rg --files packages/coc');
        expect(info?.family).toBe('files');
        expect(info?.label).toBe('Files');
        expect(info?.cls).toBe('glob');
        expect(info?.metricKind).toBe('files');
        expect(info?.summary).toBe('packages/coc');
    });

    it('classifies a safe find', () => {
        const info = classifyShellCommand("find packages/coc -name '*.ts'");
        expect(info?.family).toBe('files');
        expect(info?.summary).toBe('*.ts in packages/coc');
    });

    it('classifies ls', () => {
        const info = classifyShellCommand('ls -la src');
        expect(info?.family).toBe('files');
        expect(info?.summary).toBe('src');
    });
});

describe('classifyShellCommand — Git', () => {
    it('classifies git status', () => {
        const info = classifyShellCommand('git status');
        expect(info?.family).toBe('git');
        expect(info?.label).toBe('Git');
        expect(info?.cls).toBe('shell');
        expect(info?.summary).toBe('status');
    });

    it('classifies git log with args', () => {
        const info = classifyShellCommand('git log --oneline -10');
        expect(info?.family).toBe('git');
        expect(info?.summary).toBe('log --oneline -10');
    });

    it('classifies a same-family git chain', () => {
        const info = classifyShellCommand('git status && git log');
        expect(info?.family).toBe('git');
    });

    it('allows git show ... | sed -n', () => {
        const info = classifyShellCommand("git show HEAD:file.ts | sed -n '1,50p'");
        expect(info?.family).toBe('git');
        expect(info?.summary).toBe('show HEAD:file.ts');
    });

    it('skips git -C global option to find the subcommand', () => {
        const info = classifyShellCommand('git -C /repo diff');
        expect(info?.family).toBe('git');
        expect(info?.summary).toBe('diff');
    });
});

describe('classifyShellCommand — Shell fallback (null)', () => {
    it('returns null for a mixed chain', () => {
        expect(classifyShellCommand('git status && npm test')).toBeNull();
    });

    it('returns null for builds/tests/unknown commands', () => {
        expect(classifyShellCommand('npm run build')).toBeNull();
        expect(classifyShellCommand('make')).toBeNull();
    });

    it('returns null for sed -i (in-place write)', () => {
        expect(classifyShellCommand("sed -i 's/a/b/' file")).toBeNull();
    });

    it('returns null for combined sed -ni (in-place)', () => {
        expect(classifyShellCommand("sed -ni 's/a/b/' file")).toBeNull();
    });

    it('returns null for output redirection', () => {
        expect(classifyShellCommand('cat file > out.txt')).toBeNull();
        expect(classifyShellCommand('rg foo 2> err.log')).toBeNull();
    });

    it('returns null for tee in a pipeline', () => {
        expect(classifyShellCommand('cat file | tee copy.txt')).toBeNull();
    });

    it('returns null for a heredoc', () => {
        expect(classifyShellCommand('cat <<EOF')).toBeNull();
    });

    it('returns null for find -delete / -exec / -ok', () => {
        expect(classifyShellCommand('find . -name "*.tmp" -delete')).toBeNull();
        expect(classifyShellCommand('find . -exec rm {} ;')).toBeNull();
        expect(classifyShellCommand('find . -ok rm {} ;')).toBeNull();
    });

    it('returns null for fd --exec', () => {
        expect(classifyShellCommand('fd -e ts --exec wc -l')).toBeNull();
    });

    it('returns null for command substitution, subshells, eval, xargs, sudo', () => {
        expect(classifyShellCommand('rg $(cat patterns.txt)')).toBeNull();
        expect(classifyShellCommand('rg `cat patterns.txt`')).toBeNull();
        expect(classifyShellCommand('(rg foo)')).toBeNull();
        expect(classifyShellCommand('eval rg foo')).toBeNull();
        expect(classifyShellCommand('rg foo | xargs rm')).toBeNull();
        expect(classifyShellCommand('sudo rg foo')).toBeNull();
    });

    it('returns null for an assignment prefix', () => {
        expect(classifyShellCommand('FOO=bar rg baz')).toBeNull();
    });

    it('returns null for background &', () => {
        expect(classifyShellCommand('rg foo &')).toBeNull();
    });

    it('returns null for empty / malformed input', () => {
        expect(classifyShellCommand('')).toBeNull();
        expect(classifyShellCommand('   ')).toBeNull();
        expect(classifyShellCommand("rg 'unterminated")).toBeNull();
        expect(classifyShellCommand(undefined)).toBeNull();
        expect(classifyShellCommand(123)).toBeNull();
    });

    it('does not classify a family word appearing only inside an argument', () => {
        // rg searching for the text "git status" is a Search, not a Git op.
        const info = classifyShellCommand("rg 'git status' src");
        expect(info?.family).toBe('search');
        expect(info?.summary).toBe('git status in src');
        // echo of the word rg is not a search.
        expect(classifyShellCommand('echo rg')).toBeNull();
        // cat of a file literally named git is a read of that file.
        expect(classifyShellCommand('cat git')?.family).toBe('read');
    });
});

describe('classifyShellCommand — description/summary fallback', () => {
    it('falls back to the (unwrapped) command text when a pattern cannot be extracted', () => {
        // No pattern positional after the flags → summary is the command itself.
        const info = classifyShellCommand("bash -lc 'rg --json'");
        expect(info?.family).toBe('search');
        expect(info?.summary).toBe('rg --json');
    });

    it('uses the unwrapped command for multi-command chains', () => {
        const info = classifyShellCommand('git status && git log');
        expect(info?.summary).toBe('git status && git log');
    });
});
