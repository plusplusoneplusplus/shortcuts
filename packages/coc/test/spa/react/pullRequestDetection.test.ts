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
});
