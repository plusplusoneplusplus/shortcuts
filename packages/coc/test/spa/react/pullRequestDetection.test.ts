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
