import { describe, expect, it } from 'vitest';
import {
    detectPullRequestsInToolGroup,
    type DetectedPullRequest,
} from '../../../src/server/spa/client/react/features/chat/conversation/pullRequestDetection';

describe('detectPullRequestsInToolGroup', () => {
    it('detects a GitHub pull request URL from gh pr create output', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'powershell',
                args: { command: 'gh pr create --title "feat" --body "body"' },
                result: 'https://github.com/org/repo/pull/99',
            },
        ]);

        expect(pullRequests).toEqual<DetectedPullRequest[]>([
            {
                number: 99,
                url: 'https://github.com/org/repo/pull/99',
                provider: 'github',
                owner: 'org',
                repo: 'repo',
                toolCallId: 'tool-1',
            },
        ]);
    });

    it('deduplicates repeated pull request URLs', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'gh pr create --fill' },
                result: [
                    'https://github.com/org/repo/pull/99',
                    'Created pull request: https://github.com/org/repo/pull/99',
                ].join('\n'),
            },
        ]);

        expect(pullRequests).toHaveLength(1);
        expect(pullRequests[0].url).toBe('https://github.com/org/repo/pull/99');
    });

    it('detects a GitHub PR when gh pr create is wrapped in bash -lc', () => {
        // Regression (PR #484): some agent harnesses serialize every shell tool
        // call as `/bin/bash -lc '<real command>'`. The real `gh pr create` then
        // lives entirely inside the single-quoted payload, which the quote-strip
        // used to erase — so the PR URL in the result was never detected.
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'shell',
                args: {
                    command:
                        "/bin/bash -lc 'gh pr create --base main --head pr/7f5d8f2-make-schedule-persistence-async --fill'",
                },
                result: 'https://github.com/plusplusoneplusplus/shortcuts/pull/484',
            },
        ]);

        expect(pullRequests).toEqual<DetectedPullRequest[]>([
            {
                number: 484,
                url: 'https://github.com/plusplusoneplusplus/shortcuts/pull/484',
                provider: 'github',
                owner: 'plusplusoneplusplus',
                repo: 'shortcuts',
                toolCallId: 'tool-1',
            },
        ]);
    });

    it('detects an ADO PR when az repos pr create is wrapped in sh -c', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'shell',
                args: { command: 'sh -c "az repos pr create --title \\"feat\\""' },
                result: 'https://dev.azure.com/myorg/MyProject/_git/MyRepo/pullrequest/12345',
            },
        ]);

        expect(pullRequests).toHaveLength(1);
        expect(pullRequests[0]).toMatchObject({
            number: 12345,
            provider: 'azure-devops',
            organization: 'myorg',
            project: 'MyProject',
        });
    });

    it('ignores a wrapped command that only mentions gh pr create inside a search', () => {
        // The wrapper unwrap must not re-introduce false positives: here the inner
        // payload runs `rg`, and `gh pr create` is just its quoted search pattern.
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'shell',
                args: { command: '/bin/bash -lc \'rg -n "gh pr create" packages/coc/test\'' },
                result: 'https://github.com/org/repo/pull/99',
            },
        ]);

        expect(pullRequests).toEqual([]);
    });

    it('ignores a read-only gh pr view wrapped in bash -lc', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'shell',
                args: { command: "/bin/bash -lc 'gh pr view 99'" },
                result: 'https://github.com/org/repo/pull/99',
            },
        ]);

        expect(pullRequests).toEqual([]);
    });

    it('ignores gh pr view output', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'powershell',
                args: { command: 'gh pr view 99' },
                result: 'https://github.com/org/repo/pull/99',
            },
        ]);

        expect(pullRequests).toEqual([]);
    });

    it('ignores non-shell tools', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'web_fetch',
                args: { url: 'https://github.com/org/repo/pull/99' },
                result: 'https://github.com/org/repo/pull/99',
            },
        ]);

        expect(pullRequests).toEqual([]);
    });

    it('detects a GitHub pull request URL from the GitHub connector create tool', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                name: 'github_create_pull_request',
                args: {
                    server: 'codex_apps',
                    arguments: {
                        repository_full_name: 'plusplusoneplusplus/shortcuts',
                        base: 'main',
                        head: 'pr/5838993-show-result-size',
                    },
                },
                result: JSON.stringify({
                    url: 'https://github.com/plusplusoneplusplus/shortcuts/pull/453',
                    number: 453,
                    state: 'open',
                }),
            },
        ]);

        expect(pullRequests).toEqual<DetectedPullRequest[]>([
            {
                number: 453,
                url: 'https://github.com/plusplusoneplusplus/shortcuts/pull/453',
                provider: 'github',
                owner: 'plusplusoneplusplus',
                repo: 'shortcuts',
                toolCallId: 'tool-1',
            },
        ]);
    });

    it('ignores read-only GitHub connector PR lookups', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                name: 'github_get_pr_info',
                args: {
                    server: 'codex_apps',
                    arguments: {
                        repository_full_name: 'plusplusoneplusplus/shortcuts',
                        pr_number: 453,
                    },
                },
                result: JSON.stringify({
                    url: 'https://github.com/plusplusoneplusplus/shortcuts/pull/453',
                    number: 453,
                    state: 'open',
                }),
            },
        ]);

        expect(pullRequests).toEqual([]);
    });

    it('accepts "Bash" (capital B) tool name as used by Claude SDK', () => {
        // Claude SDK stores tool names with capital first letter (e.g. "Bash").
        // Regression: capitalized names were not matched against SHELL_TOOL_NAMES.
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'Bash',
                args: { command: 'gh pr create --fill' },
                result: 'https://github.com/org/repo/pull/42',
            },
        ]);

        expect(pullRequests).toHaveLength(1);
        expect(pullRequests[0].number).toBe(42);
        expect(pullRequests[0].toolCallId).toBe('tool-1');
    });

    it('handles command strings under args.script', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'shell',
                args: { script: 'gh pr create --base main --head feature' },
                result: 'Pull request created: https://github.com/org/repo/pull/100',
            },
        ]);

        expect(pullRequests).toHaveLength(1);
        expect(pullRequests[0]).toMatchObject({
            number: 100,
            url: 'https://github.com/org/repo/pull/100',
            owner: 'org',
            repo: 'repo',
            toolCallId: 'tool-1',
        });
    });

    it('detects PR URLs from wrapper command transcripts that ran gh pr create', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'powershell',
                args: {
                    command: 'python .github/skills/submit-commits-as-pr/scripts/submit_commits_as_pr.py start 7c911464',
                },
                result: [
                    '$ git push -u origin pr/feature',
                    "remote: Create a pull request for 'pr/feature' on GitHub by visiting:",
                    'remote:      https://github.com/org/repo/pull/new/pr/feature',
                    '$ gh pr create --base main --head pr/feature --fill',
                    'https://github.com/org/repo/pull/101',
                    'JSON: {"pr_url": "https://github.com/org/repo/pull/101", "status": "done"}',
                ].join('\n'),
            },
        ]);

        expect(pullRequests).toHaveLength(1);
        expect(pullRequests[0]).toMatchObject({
            number: 101,
            url: 'https://github.com/org/repo/pull/101',
            owner: 'org',
            repo: 'repo',
            toolCallId: 'tool-1',
        });
    });

    it('detects a wrapper PR from structured success output with no gh pr create echo (idempotent resume)', () => {
        // Real-world repro: an idempotent / resumed wrapper run (commits_count: 0)
        // does not re-run `gh pr create`, so the only PR-creation evidence is the
        // wrapper's structured success line.
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: {
                    command: 'python .github/skills/submit-commits-as-pr/scripts/submit_commits_as_pr.py start 7c911464',
                },
                result: [
                    'PR already exists for this branch; nothing to push.',
                    'JSON: {"commits_count": 0, "commits_submitted": [], "new_branch": "pr/fix-detection", "original_branch": "main", "pr_url": "https://github.com/plusplusoneplusplus/shortcuts/pull/371", "status": "done"}',
                ].join('\n'),
            },
        ]);

        expect(pullRequests).toHaveLength(1);
        expect(pullRequests[0]).toMatchObject({
            number: 371,
            url: 'https://github.com/plusplusoneplusplus/shortcuts/pull/371',
            provider: 'github',
            owner: 'plusplusoneplusplus',
            repo: 'shortcuts',
            toolCallId: 'tool-1',
        });
    });

    it('detects a wrapper PR when the gh pr create echo is truncated under a large dump', () => {
        // On the first run the `gh pr create` echo can be lost when a large
        // `git rev-list` dump truncates the captured output, leaving only the
        // structured success line and the URL.
        const revListDump = Array.from({ length: 50 }, (_, i) => `${'a'.repeat(40)}${i}`).join('\n');
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: {
                    command: 'python .github/skills/submit-commits-as-pr/scripts/submit_commits_as_pr.py start abc123',
                },
                result: [
                    '$ git rev-list --reverse main..HEAD',
                    revListDump,
                    'JSON: {"commits_count": 3, "commits_submitted": ["abc123"], "new_branch": "pr/big", "original_branch": "main", "pr_url": "https://github.com/org/repo/pull/371", "status": "done"}',
                ].join('\n'),
            },
        ]);

        expect(pullRequests).toHaveLength(1);
        expect(pullRequests[0]).toMatchObject({
            number: 371,
            url: 'https://github.com/org/repo/pull/371',
            toolCallId: 'tool-1',
        });
    });

    it('detects a wrapper PR recovered by grepping the wrapper\'s persisted stdout', () => {
        // Real-world repro (PR #374): the wrapper's own 269KB output was truncated
        // to a head preview — a large `git rev-list` dump — so the trailing success
        // line never reached the captured result. The model recovered it by
        // grepping the persisted stdout file, leaving a bare `JSON: {...}` success
        // line under a (non-creating, non-wrapper) grep command.
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'Bash',
                args: { command: 'grep -a "JSON:" /tmp/tool-results/byixuxzao.txt | tail -20' },
                result: 'JSON: {"commits_count": 0, "commits_submitted": [], "new_branch": "pr/x", "original_branch": "main", "pr_url": "https://github.com/plusplusoneplusplus/shortcuts/pull/374", "status": "done"}',
            },
        ]);

        expect(pullRequests).toHaveLength(1);
        expect(pullRequests[0]).toMatchObject({
            number: 374,
            url: 'https://github.com/plusplusoneplusplus/shortcuts/pull/374',
            provider: 'github',
            owner: 'plusplusoneplusplus',
            repo: 'shortcuts',
            toolCallId: 'tool-1',
        });
    });

    it('does not detect a structured pr_url/status line embedded in source-search output', () => {
        // A `rg`/`cat` over source can surface the wrapper's success line from a
        // test fixture, but there it is indented inside a string literal or behind a
        // `path:line:` prefix — never at the start of a line. The line-start anchor
        // (which runs before the command checks) keeps these out, so the result is
        // not detected even though it contains `pr_url` + `status: "done"`.
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'rg -n "pr_url" packages/coc/test' },
                result: [
                    'packages/coc/test/spa/react/pullRequestDetection.test.ts:152:    result: \'JSON: {"commits_count": 0, "pr_url": "https://github.com/org/repo/pull/371", "status": "done"}\',',
                    '                result: \'JSON: {"pr_url": "https://github.com/org/repo/pull/371", "status": "done"}\',',
                ].join('\n'),
            },
        ]);

        expect(pullRequests).toEqual([]);
    });

    it('ignores source search output that contains PR creation fixtures', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: {
                    command: 'rg -n "gh pr create|az repos pr create|pull/" packages/coc/test',
                },
                result: [
                    'packages/coc/test/server/work-items/work-item-execution-routes.test.ts:720: if (command === \'gh\' && args[0] === \'pr\' && args[1] === \'create\') return { stdout: \'https://github.com/example/repo/pull/123\\n\', stderr: \'\' };',
                    'packages/coc/test/spa/react/pullRequestDetection.test.ts:172: args: { command: \'az repos pr create --title "feat"\' },',
                    'packages/coc/test/spa/react/pullRequestDetection.test.ts:173: result: \'https://dev.azure.com/myorg/MyProject/_git/MyRepo/pullrequest/12345\',',
                ].join('\n'),
            },
        ]);

        expect(pullRequests).toEqual([]);
    });

    it('detects PR URLs when command metadata is unavailable', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'powershell',
                result: 'https://github.com/org/repo/pull/101',
            },
        ]);

        expect(pullRequests).toHaveLength(1);
        expect(pullRequests[0].number).toBe(101);
    });

    it('does not count known non-creation commands that mention PR URLs', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'powershell',
                args: { command: 'gh pr checks 99' },
                result: 'https://github.com/org/repo/pull/99',
            },
        ]);

        expect(pullRequests).toEqual([]);
    });

    // --- Azure DevOps detection ---

    it('detects an ADO dev.azure.com pull request URL', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'powershell',
                args: { command: 'az repos pr create --title "feat"' },
                result: 'https://dev.azure.com/myorg/MyProject/_git/MyRepo/pullrequest/12345',
            },
        ]);

        expect(pullRequests).toEqual<DetectedPullRequest[]>([
            {
                number: 12345,
                url: 'https://dev.azure.com/myorg/MyProject/_git/MyRepo/pullrequest/12345',
                provider: 'azure-devops',
                organization: 'myorg',
                project: 'MyProject',
                repo: 'MyRepo',
                toolCallId: 'tool-1',
            },
        ]);
    });

    it('detects an ADO visualstudio.com pull request URL', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-2',
                toolName: 'powershell',
                args: { command: 'az repos pr create --source-branch feature' },
                result: 'https://contoso.visualstudio.com/alpha-project/_git/my-service/pullrequest/7890',
            },
        ]);

        expect(pullRequests).toEqual<DetectedPullRequest[]>([
            {
                number: 7890,
                url: 'https://contoso.visualstudio.com/alpha-project/_git/my-service/pullrequest/7890',
                provider: 'azure-devops',
                organization: 'contoso',
                project: 'alpha-project',
                repo: 'my-service',
                toolCallId: 'tool-2',
            },
        ]);
    });

    it('detects ADO PR when command metadata is unavailable', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'powershell',
                result: 'https://dev.azure.com/org/project/_git/repo/pullrequest/999',
            },
        ]);

        expect(pullRequests).toHaveLength(1);
        expect(pullRequests[0]).toMatchObject({
            number: 999,
            provider: 'azure-devops',
            organization: 'org',
            project: 'project',
            repo: 'repo',
        });
    });

    it('ignores az repos pr show (read-only ADO command)', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'powershell',
                args: { command: 'az repos pr show --id 123' },
                result: 'https://dev.azure.com/org/proj/_git/repo/pullrequest/123',
            },
        ]);

        expect(pullRequests).toEqual([]);
    });

    it('ignores az repos pr list (read-only ADO command)', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'powershell',
                args: { command: 'az repos pr list --project MyProject' },
                result: 'https://dev.azure.com/org/MyProject/_git/repo/pullrequest/100',
            },
        ]);

        expect(pullRequests).toEqual([]);
    });

    it('deduplicates repeated ADO URLs', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'az repos pr create --title "fix"' },
                result: [
                    'https://dev.azure.com/org/proj/_git/repo/pullrequest/500',
                    'Created: https://dev.azure.com/org/proj/_git/repo/pullrequest/500',
                ].join('\n'),
            },
        ]);

        expect(pullRequests).toHaveLength(1);
        expect(pullRequests[0].number).toBe(500);
    });

    it('detects both GitHub and ADO PRs in the same tool group', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'powershell',
                args: { command: 'gh pr create --fill' },
                result: 'https://github.com/org/repo/pull/42',
            },
            {
                id: 'tool-2',
                toolName: 'powershell',
                args: { command: 'az repos pr create --title "sync"' },
                result: 'https://dev.azure.com/myorg/proj/_git/repo/pullrequest/200',
            },
        ]);

        expect(pullRequests).toHaveLength(2);
        expect(pullRequests[0].provider).toBe('github');
        expect(pullRequests[1].provider).toBe('azure-devops');
    });

    // --- Compound-shell / control-flow detection (PR #525) ---

    it('detects gh pr create as the first command in a then branch', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: {
                    command: 'if git diff --quiet; then gh pr create --fill; fi',
                },
                result: 'https://github.com/owner/repo/pull/525',
            },
        ]);

        expect(pullRequests).toHaveLength(1);
        expect(pullRequests[0]).toMatchObject({
            number: 525,
            url: 'https://github.com/owner/repo/pull/525',
            provider: 'github',
        });
    });

    it('detects gh pr create as the first command in an else branch', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: {
                    command:
                        'if git diff --quiet HEAD; then echo "no changes"; else gh pr create --fill; fi',
                },
                result: 'https://github.com/owner/repo/pull/525',
            },
        ]);

        expect(pullRequests).toHaveLength(1);
        expect(pullRequests[0]).toMatchObject({
            number: 525,
            url: 'https://github.com/owner/repo/pull/525',
            provider: 'github',
        });
    });

    it('detects gh pr create on a new line after fi', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: {
                    command: 'git push -u origin HEAD; fi\ngh pr create --fill',
                },
                result: 'https://github.com/owner/repo/pull/525',
            },
        ]);

        expect(pullRequests).toHaveLength(1);
        expect(pullRequests[0]).toMatchObject({ number: 525 });
    });

    it('detects gh pr create inside a command substitution', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: {
                    command: 'URL=$(gh pr create --fill) && echo "$URL"',
                },
                result: 'https://github.com/owner/repo/pull/525',
            },
        ]);

        expect(pullRequests).toHaveLength(1);
        expect(pullRequests[0]).toMatchObject({ number: 525 });
    });

    it('does not detect gh pr create inside a ripgrep quoted search pattern', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'rg -n "gh pr create" .' },
                result: 'https://github.com/owner/repo/pull/525',
            },
        ]);

        expect(pullRequests).toEqual([]);
    });

    it('does not detect a flag-value mention of gh-pr-create', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'echo --note=please-run-gh-pr-create-later' },
                result: 'https://github.com/owner/repo/pull/525',
            },
        ]);

        expect(pullRequests).toEqual([]);
    });

    it('handles ADO project names with percent-encoded spaces', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'powershell',
                result: 'https://dev.azure.com/org/My%20Project/_git/repo/pullrequest/77',
            },
        ]);

        expect(pullRequests).toHaveLength(1);
        expect(pullRequests[0]).toMatchObject({
            number: 77,
            provider: 'azure-devops',
            project: 'My%20Project',
        });
    });
});
