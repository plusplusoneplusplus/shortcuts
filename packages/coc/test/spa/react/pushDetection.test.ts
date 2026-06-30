import { describe, expect, it } from 'vitest';
import {
    detectPushesInToolGroup,
    type DetectedPush,
} from '../../../src/server/spa/client/react/features/chat/conversation/pushDetection';

describe('detectPushesInToolGroup', () => {
    it('detects a fast-forward push from standard git push output (https remote)', () => {
        const pushes = detectPushesInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'git push origin main' },
                result: [
                    'Enumerating objects: 5, done.',
                    'To https://github.com/owner/repo.git',
                    '   abc1234..def5678  main -> main',
                ].join('\n'),
            },
        ]);

        expect(pushes).toEqual<DetectedPush[]>([
            {
                remote: 'https://github.com/owner/repo.git',
                branch: 'main',
                localRef: 'main',
                summary: 'abc1234..def5678',
                forced: false,
                provider: 'github',
                url: 'https://github.com/owner/repo/tree/main',
                toolCallId: 'tool-1',
            },
        ]);
    });

    it('detects a new-branch push and flags it as a new ref', () => {
        const pushes = detectPushesInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'git push -u origin feature' },
                result: [
                    'To https://github.com/owner/repo.git',
                    ' * [new branch]      feature -> feature',
                ].join('\n'),
            },
        ]);

        expect(pushes).toHaveLength(1);
        expect(pushes[0]).toMatchObject({
            branch: 'feature',
            summary: '[new branch]',
            isNewRef: true,
            forced: false,
            url: 'https://github.com/owner/repo/tree/feature',
        });
    });

    it('flags a force push from the (forced update) output marker', () => {
        const pushes = detectPushesInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'git push origin main' },
                result: [
                    'To https://github.com/owner/repo.git',
                    ' + abc1234...def5678 main -> main (forced update)',
                ].join('\n'),
            },
        ]);

        expect(pushes).toHaveLength(1);
        expect(pushes[0].forced).toBe(true);
        expect(pushes[0].summary).toBe('abc1234...def5678');
    });

    it('flags a force push from a --force-with-lease command flag even without the output marker', () => {
        const pushes = detectPushesInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'git push --force-with-lease origin main' },
                result: [
                    'To https://github.com/owner/repo.git',
                    '   abc1234..def5678  main -> main',
                ].join('\n'),
            },
        ]);

        expect(pushes).toHaveLength(1);
        expect(pushes[0].forced).toBe(true);
    });

    it('flags a force push from a -f command flag', () => {
        const pushes = detectPushesInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'git push -f origin main' },
                result: [
                    'To https://github.com/owner/repo.git',
                    '   abc1234..def5678  main -> main',
                ].join('\n'),
            },
        ]);

        expect(pushes).toHaveLength(1);
        expect(pushes[0].forced).toBe(true);
    });

    it('detects a wrapper-triggered push from its output block (no git push command)', () => {
        // submit_commits_as_pr.py / gh / az all surface the same `To ... / -> `
        // output block, so detection keys off the block rather than the command.
        const pushes = detectPushesInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'python .github/skills/submit-commits-as-pr/scripts/submit_commits_as_pr.py start abc123' },
                result: [
                    '$ git push -u origin pr/feature',
                    'To https://github.com/org/repo.git',
                    ' * [new branch]      pr/feature -> pr/feature',
                    'JSON: {"pr_url": "https://github.com/org/repo/pull/1", "status": "done"}',
                ].join('\n'),
            },
        ]);

        expect(pushes).toHaveLength(1);
        expect(pushes[0]).toMatchObject({
            remote: 'https://github.com/org/repo.git',
            branch: 'pr/feature',
            isNewRef: true,
            url: 'https://github.com/org/repo/tree/pr%2Ffeature',
        });
    });

    it('does not count a rejected (non-fast-forward) push', () => {
        const pushes = detectPushesInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'git push origin main' },
                result: [
                    'To https://github.com/owner/repo.git',
                    ' ! [rejected]        main -> main (non-fast-forward)',
                    "error: failed to push some refs to 'https://github.com/owner/repo.git'",
                ].join('\n'),
            },
        ]);

        expect(pushes).toEqual([]);
    });

    it('does not count a push whose command exited non-zero', () => {
        const pushes = detectPushesInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'git push origin main' },
                result: [
                    'To https://github.com/owner/repo.git',
                    '   abc1234..def5678  main -> main',
                    '<exited with exit code 1>',
                ].join('\n'),
            },
        ]);

        expect(pushes).toEqual([]);
    });

    it('does not count an auth-failed push (fatal: with no output block)', () => {
        const pushes = detectPushesInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'git push origin main' },
                result: "fatal: Authentication failed for 'https://github.com/owner/repo.git/'",
            },
        ]);

        expect(pushes).toEqual([]);
    });

    it('derives a GitHub browse URL from an ssh remote', () => {
        const pushes = detectPushesInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'git push origin main' },
                result: [
                    'To git@github.com:owner/repo.git',
                    '   abc1234..def5678  main -> main',
                ].join('\n'),
            },
        ]);

        expect(pushes).toHaveLength(1);
        expect(pushes[0]).toMatchObject({
            provider: 'github',
            url: 'https://github.com/owner/repo/tree/main',
        });
    });

    it('derives an Azure DevOps browse URL from a dev.azure.com remote', () => {
        const pushes = detectPushesInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'git push origin main' },
                result: [
                    'To https://dev.azure.com/myorg/MyProject/_git/MyRepo',
                    '   abc1234..def5678  main -> main',
                ].join('\n'),
            },
        ]);

        expect(pushes).toHaveLength(1);
        expect(pushes[0]).toMatchObject({
            provider: 'azure-devops',
            url: 'https://dev.azure.com/myorg/MyProject/_git/MyRepo?version=GBmain',
        });
    });

    it('leaves a named remote (origin, no URL) as plain text with no derived URL', () => {
        const pushes = detectPushesInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'git push origin main' },
                result: [
                    'To origin',
                    '   abc1234..def5678  main -> main',
                ].join('\n'),
            },
        ]);

        expect(pushes).toHaveLength(1);
        expect(pushes[0].remote).toBe('origin');
        expect(pushes[0].provider).toBe('unknown');
        expect(pushes[0].url).toBeUndefined();
    });

    it('deduplicates the same (remote, branch, summary) push within a group', () => {
        const block = [
            'To https://github.com/owner/repo.git',
            '   abc1234..def5678  main -> main',
        ].join('\n');
        const pushes = detectPushesInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'git push origin main' },
                result: [block, block].join('\n'),
            },
        ]);

        expect(pushes).toHaveLength(1);
    });

    it('detects multiple distinct pushes across tool calls', () => {
        const pushes = detectPushesInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'git push origin main' },
                result: [
                    'To https://github.com/owner/repo.git',
                    '   abc1234..def5678  main -> main',
                ].join('\n'),
            },
            {
                id: 'tool-2',
                toolName: 'bash',
                args: { command: 'git push origin feature' },
                result: [
                    'To https://github.com/owner/repo.git',
                    ' * [new branch]      feature -> feature',
                ].join('\n'),
            },
        ]);

        expect(pushes).toHaveLength(2);
        expect(pushes[0].toolCallId).toBe('tool-1');
        expect(pushes[1].toolCallId).toBe('tool-2');
    });

    it('ignores non-shell tools', () => {
        const pushes = detectPushesInToolGroup([
            {
                id: 'tool-1',
                toolName: 'web_fetch',
                args: { url: 'https://github.com/owner/repo.git' },
                result: [
                    'To https://github.com/owner/repo.git',
                    '   abc1234..def5678  main -> main',
                ].join('\n'),
            },
        ]);

        expect(pushes).toEqual([]);
    });

    it('accepts "Bash" (capital B) tool name as used by the Claude SDK', () => {
        const pushes = detectPushesInToolGroup([
            {
                id: 'tool-1',
                toolName: 'Bash',
                args: { command: 'git push origin main' },
                result: [
                    'To https://github.com/owner/repo.git',
                    '   abc1234..def5678  main -> main',
                ].join('\n'),
            },
        ]);

        expect(pushes).toHaveLength(1);
        expect(pushes[0].toolCallId).toBe('tool-1');
    });

    it('handles command strings under args.script', () => {
        const pushes = detectPushesInToolGroup([
            {
                id: 'tool-1',
                toolName: 'shell',
                args: { script: 'git push --force origin main' },
                result: [
                    'To https://github.com/owner/repo.git',
                    '   abc1234..def5678  main -> main',
                ].join('\n'),
            },
        ]);

        expect(pushes).toHaveLength(1);
        expect(pushes[0].forced).toBe(true);
    });

    it('does not emit a push when there is no output block (e.g. up-to-date)', () => {
        const pushes = detectPushesInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'git push origin main' },
                result: 'Everything up-to-date',
            },
        ]);

        expect(pushes).toEqual([]);
    });
});
