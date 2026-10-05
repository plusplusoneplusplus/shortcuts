import { describe, expect, it } from 'vitest';
import {
    collectToolCallsFromTurns,
    detectPullRequestsInToolGroup,
    type DetectedPullRequest,
    type ToolCallBearingTurn,
    type ToolCallLike,
} from '../../src/git/pull-request-detection';

// Actual completed Claude result from shortcuts-2 chat queue_1791211886713-gui2hqq.
const CREATED_PR = {
    success: true,
    url: 'https://github.com/plusplusoneplusplus/shortcuts/pull/874',
    id: 874,
    provider: 'github',
    branch: 'pr/aba433ae1-feat-coc-add-file-selection-attached-con',
    base: 'main',
    existing: false,
    autoMerge: { requested: false, enabled: false },
    bound: true,
};
const MCP_CREATED_PR = { content: [{ type: 'text', text: JSON.stringify(CREATED_PR) }], isError: false };

describe('detectPullRequestsInToolGroup', () => {
    it('does not treat arbitrary script output or recovered status lines as PR creation', () => {
        const calls = [
            { id: 'script', name: 'bash', args: { command: 'python tools/publish.py' },
                result: '$ gh pr create --fill\nhttps://github.com/org/repo/pull/99\nJSON: {"pr_url":"https://github.com/org/repo/pull/99","status":"done"}\nFull output at /tmp/output.txt' },
            { id: 'log', name: 'bash', args: { command: 'tail /tmp/output.txt' },
                result: 'JSON: {"pr_url":"https://github.com/org/repo/pull/99","status":"done"}' },
        ];
        expect(detectPullRequestsInToolGroup(calls)).toEqual([]);
    });

    describe('create_pull_request results', () => {
        it.each([
            'create_pull_request',
            'mcp__coc_llm_tools__create_pull_request',
            'mcp__codex_apps__github___create_pull_request',
            'github_create_pull_request',
            'functions.create_pull_request',
            'MCP__GITHUB__CREATE_PULL_REQUEST',
        ])('recognizes normalized provider name %s', name => {
            expect(detectPullRequestsInToolGroup([{ id: 'created', name, result: JSON.stringify(CREATED_PR) }]))
                .toEqual([expect.objectContaining({ number: 874, provider: 'github', url: CREATED_PR.url, toolCallId: 'created' })]);
        });

        it.each([
            CREATED_PR,
            JSON.stringify(CREATED_PR), // Claude flattens text content to this JSON.
            MCP_CREATED_PR,
            JSON.stringify(MCP_CREATED_PR),
            JSON.stringify(MCP_CREATED_PR.content),
            { structuredContent: CREATED_PR, ...MCP_CREATED_PR },
            { url: CREATED_PR.url, number: 874, state: 'open' }, // GitHub connector.
            { url: 'https://api.github.com/repos/plusplusoneplusplus/shortcuts/pulls/874', html_url: CREATED_PR.url, number: 874, id: 123456789, body: 'See https://github.com/other/repo/pull/1' },
        ])('reads actual structured/serialized creation output %#', result => {
            expect(detectPullRequestsInToolGroup([{ id: 'created', name: 'create_pull_request', result }]))
                .toHaveLength(1);
        });

        it.each([
            ['ado', 'https://dev.azure.com/contoso/My%20Project/_git/repo/pullrequest/874'],
            ['ado', 'https://contoso.visualstudio.com/My%20Project/_git/repo/pullrequest/874'],
        ])('supports the existing %s host contract %s', (provider, url) => {
            const prs = detectPullRequestsInToolGroup([{ id: 'ado', name: 'create_pull_request',
                result: JSON.stringify({ ...CREATED_PR, provider, url }) }],
                { remoteUrl: 'https://dev.azure.com/contoso/My%20Project/_git/repo' });
            expect(prs).toEqual([expect.objectContaining({ number: 874, provider: 'azure-devops', url })]);
        });

        it.each([
            { ...CREATED_PR, success: false },
            { ...CREATED_PR, success: 'false' },
            { ...CREATED_PR, error: 'Command failed' },
            { ...CREATED_PR, status: 'failed' },
            { ...MCP_CREATED_PR, isError: true },
            { ...MCP_CREATED_PR, is_error: true },
            { structuredContent: CREATED_PR, content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Failed' }) }] },
            { ...CREATED_PR, id: 875 },
            { ...CREATED_PR, number: '874' },
            { ...CREATED_PR, number: null },
            { ...CREATED_PR, url: CREATED_PR.url.replace('/874', '/0874') },
            { ...CREATED_PR, url: 'https://github.com/../repo/pull/874' },
            { ...CREATED_PR, provider: 'ado' },
            { ...CREATED_PR, url: 'https://github.com/plusplusoneplusplus/shortcuts/issues/874' },
            { ...CREATED_PR, url: CREATED_PR.url + '/files' },
            { ...CREATED_PR, url: CREATED_PR.url + '.evil.com' },
            { ...CREATED_PR, url: CREATED_PR.url.replace('/874', '/0'), id: 0 },
            { ...CREATED_PR, url: CREATED_PR.url.replace('/874', '/9007199254740992'), id: 9007199254740992 },
            { content: [{ type: 'text', text: 'Error creating PR: ' + CREATED_PR.url }] },
            { content: [{ type: 'text', text: '{"success":true,"url":"' + CREATED_PR.url }] },
            { body: CREATED_PR.url },
            { arguments: CREATED_PR },
            { structuredContent: CREATED_PR, content: [{ type: 'text', text: JSON.stringify({ ...CREATED_PR, id: 875, url: CREATED_PR.url.replace('/874', '/875') }) }] },
            'Created PR ' + CREATED_PR.url,
            null,
        ])('rejects errors, malformed identities and arbitrary mentions %#', result => {
            expect(detectPullRequestsInToolGroup([{ id: 'bad', name: 'create_pull_request', args: CREATED_PR, result }]))
                .toEqual([]);
        });

        it.each(['failed', 'pending', 'running', 'cancelled', 'error'])('rejects %s tool status', status => {
            expect(detectPullRequestsInToolGroup([{ id: 'bad', name: 'create_pull_request', result: CREATED_PR, status }])).toEqual([]);
        });

        it.each(['get_pull_request', 'create_pull_request_preview', 'recreate_pull_request', 'bash'])('ignores non-creation tool %s', name => {
            expect(detectPullRequestsInToolGroup([{ id: 'bad', name, result: JSON.stringify(CREATED_PR) }])).toEqual([]);
        });

        it('deduplicates matching MCP identities and scopes to the workspace remote', () => {
            const calls = [{ id: 'a', name: 'create_pull_request', result: CREATED_PR },
                { id: 'b', name: 'mcp__coc__create_pull_request', result: MCP_CREATED_PR }];
            expect(detectPullRequestsInToolGroup(calls, { remoteUrl: 'git@github.com:plusplusoneplusplus/shortcuts.git' })).toHaveLength(1);
            expect(detectPullRequestsInToolGroup(calls, { remoteUrl: 'https://github.com/other/repo' })).toEqual([]);
        });

        it('merges provider start/completion records without binding arguments', () => {
            const calls = collectToolCallsFromTurns([{
                timeline: [
                    { toolCall: { id: 'native', name: 'mcp__coc__create_pull_request', status: 'running', args: CREATED_PR } },
                    { toolCall: { id: 'native', status: 'completed', result: JSON.stringify(CREATED_PR) } },
                ],
                toolCalls: [{ id: 'native', name: 'create_pull_request', status: 'completed', result: JSON.stringify(CREATED_PR) }],
            }]);
            expect(detectPullRequestsInToolGroup(calls)).toEqual([expect.objectContaining({ number: 874 })]);
            expect(detectPullRequestsInToolGroup([{ id: 'args-only', name: 'create_pull_request', args: CREATED_PR, status: 'completed' }])).toEqual([]);
        });

        it('accepts successful existing-PR results and auto-merge warnings', () => {
            expect(detectPullRequestsInToolGroup([{ id: 'existing', name: 'create_pull_request',
                result: { ...CREATED_PR, existing: true, bound: false,
                    autoMerge: { requested: true, enabled: false, warning: 'Auto-merge unavailable' } } }])).toHaveLength(1);
        });
    });

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

    it('does not detect a structured pr_url/status line embedded in source-search output', () => {
        // Source-search results supply no creation-command evidence.
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'bash',
                args: { command: 'rg -n "pr_url" packages/coc/test' },
                result: [
                    'packages/forge/test/git/pull-request-detection.test.ts:152:    result: \'JSON: {"commits_count": 0, "pr_url": "https://github.com/org/repo/pull/371", "status": "done"}\',',
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
                    'packages/forge/test/git/pull-request-detection.test.ts:172: args: { command: \'az repos pr create --title "feat"\' },',
                    'packages/forge/test/git/pull-request-detection.test.ts:173: result: \'https://dev.azure.com/myorg/MyProject/_git/MyRepo/pullrequest/12345\',',
                ].join('\n'),
            },
        ]);

        expect(pullRequests).toEqual([]);
    });

    it('ignores PR URLs when command metadata is unavailable', () => {
        // Widest hole in the old detector: a shell tool call carrying no
        // `command`/`script` used to attach EVERY PR URL in its output, with no
        // evidence this chat created any of them.
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'powershell',
                result: 'https://github.com/org/repo/pull/101',
            },
        ]);

        expect(pullRequests).toEqual([]);
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

    it('ignores ADO PR URLs when command metadata is unavailable', () => {
        const pullRequests = detectPullRequestsInToolGroup([
            {
                id: 'tool-1',
                toolName: 'powershell',
                result: 'https://dev.azure.com/org/project/_git/repo/pullrequest/999',
            },
        ]);

        expect(pullRequests).toEqual([]);
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
                args: { command: 'az repos pr create --title "feat"' },
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

    // --- Only PRs THIS chat created (composer PR banner) ---
    //
    // Every detection is written back as a `pull_request_chat_bindings` row, so a
    // mis-detection is permanent. These cover the holes that let a PR this chat
    // did not create reach the composer banner.
    describe('rejects PRs this chat did not create', () => {
        const WRAPPER_CMD =
            'python tools/publish.py';

        interface RejectCase {
            name: string;
            toolCalls: Parameters<typeof detectPullRequestsInToolGroup>[0];
            options?: Parameters<typeof detectPullRequestsInToolGroup>[1];
        }

        const cases: RejectCase[] = [
            {
                name: 'shell output with no command metadata at all',
                toolCalls: [
                    { id: 'tool-1', toolName: 'bash', result: 'see https://github.com/org/repo/pull/12' },
                ],
            },
            {
                name: 'no-command shell output that merely quotes a PR link',
                toolCalls: [
                    {
                        id: 'tool-1',
                        toolName: 'bash',
                        args: {},
                        result: 'fixes https://github.com/other/repo/pull/7 and https://github.com/other/repo/pull/8',
                    },
                ],
            },
            {
                name: 'gh pr create that failed because the PR already exists',
                toolCalls: [
                    {
                        id: 'tool-1',
                        toolName: 'bash',
                        args: { command: 'gh pr create --base main --fill' },
                        result: [
                            'a pull request for branch "pr/x" into branch "main" already exists:',
                            'https://github.com/org/repo/pull/123',
                        ].join('\n'),
                    },
                ],
            },
            {
                name: 'gh pr create reported as a failed tool call',
                toolCalls: [
                    {
                        id: 'tool-1',
                        toolName: 'bash',
                        args: { command: 'gh pr create --fill' },
                        status: 'failed',
                        result: 'https://github.com/org/repo/pull/321',
                    },
                ],
            },
            {
                name: 'grep of ANOTHER run’s persisted wrapper log',
                toolCalls: [
                    {
                        id: 'tool-0',
                        toolName: 'bash',
                        args: { command: WRAPPER_CMD },
                        result: '[output truncated — full output at /tmp/tool-results/mine.txt]',
                    },
                    {
                        id: 'tool-1',
                        toolName: 'bash',
                        args: { command: 'grep -a "JSON:" /tmp/tool-results/someone-elses-run.txt' },
                        result: 'JSON: {"pr_url": "https://github.com/org/repo/pull/999", "status": "done"}',
                    },
                ],
            },
            {
                name: 'grep of a wrapper log with no wrapper run in this chat at all',
                toolCalls: [
                    {
                        id: 'tool-1',
                        toolName: 'bash',
                        args: { command: 'tail -5 /tmp/tool-results/unrelated.txt' },
                        result: 'JSON: {"pr_url": "https://github.com/org/repo/pull/999", "status": "done"}',
                    },
                ],
            },
            {
                name: 'a PR in a different repo than the chat (repo scoping)',
                toolCalls: [
                    {
                        id: 'tool-1',
                        toolName: 'bash',
                        args: { command: 'gh pr create --fill' },
                        result: 'https://github.com/someone-else/other-repo/pull/5',
                    },
                ],
                options: { remoteUrl: 'https://github.com/org/repo.git' },
            },
            {
                name: 'an ADO PR in a different project than the chat (repo scoping)',
                toolCalls: [
                    {
                        id: 'tool-1',
                        toolName: 'bash',
                        args: { command: 'az repos pr create --title "feat"' },
                        result: 'https://dev.azure.com/contoso/OtherProject/_git/other/pullrequest/5',
                    },
                ],
                options: { remoteUrl: 'https://dev.azure.com/contoso/MyProject/_git/repo' },
            },
        ];

        for (const testCase of cases) {
            it(`ignores ${testCase.name}`, () => {
                expect(detectPullRequestsInToolGroup(testCase.toolCalls, testCase.options)).toEqual([]);
            });
        }
    });

    describe('attaches only the pull request that was actually created', () => {
        it('takes the last PR URL from a gh pr create dump, not every URL in it', () => {
            // PR URLs in quoted commit messages are not creation evidence.
            const pullRequests = detectPullRequestsInToolGroup([
                {
                    id: 'tool-1',
                    toolName: 'bash',
                    args: { command: 'gh pr create --base main --fill' },
                    result: [
                        '$ git rev-list --reverse main..HEAD',
                        'abc123 fix(coc): follow-up to https://github.com/org/repo/pull/10',
                        'def456 revert of https://github.com/org/repo/pull/11',
                        'https://github.com/org/repo/pull/12',
                    ].join('\n'),
                },
            ]);

            expect(pullRequests).toHaveLength(1);
            expect(pullRequests[0]).toMatchObject({ number: 12, toolCallId: 'tool-1' });
        });

        it('keeps a PR created in the chat’s own repo when repo scoping is on', () => {
            const pullRequests = detectPullRequestsInToolGroup(
                [
                    {
                        id: 'tool-1',
                        toolName: 'bash',
                        args: { command: 'gh pr create --fill' },
                        status: 'completed',
                        result: 'https://github.com/org/repo/pull/12',
                    },
                ],
                // SSH remote for the same repo — normalization must still match.
                { remoteUrl: 'git@github.com:org/repo.git' },
            );

            expect(pullRequests).toHaveLength(1);
            expect(pullRequests[0].number).toBe(12);
        });

        it('keeps an ADO PR created in the chat’s own project when repo scoping is on', () => {
            const pullRequests = detectPullRequestsInToolGroup(
                [
                    {
                        id: 'tool-1',
                        toolName: 'bash',
                        args: { command: 'az repos pr create --title "feat"' },
                        result: 'https://dev.azure.com/contoso/MyProject/_git/repo/pullrequest/380',
                    },
                ],
                { remoteUrl: 'https://dev.azure.com/contoso/MyProject/_git/repo' },
            );

            expect(pullRequests).toHaveLength(1);
            expect(pullRequests[0].number).toBe(380);
        });

        it('does not scope anything away when no remote URL is known', () => {
            const pullRequests = detectPullRequestsInToolGroup(
                [
                    {
                        id: 'tool-1',
                        toolName: 'bash',
                        args: { command: 'gh pr create --fill' },
                        result: 'https://github.com/org/repo/pull/12',
                    },
                ],
                { remoteUrl: null },
            );

            expect(pullRequests).toHaveLength(1);
        });
    });
});

function toolCall(partial: Partial<ToolCallLike> & { id: string }): ToolCallLike {
    return { toolName: 'bash', args: {}, status: 'completed', ...partial };
}

describe('collectToolCallsFromTurns', () => {
    it('detects a PR when a Copilot completion has output but only its start has the command', () => {
        const turns: ToolCallBearingTurn[] = [{
            timeline: [
                { toolCall: { id: 'created-pr', name: 'bash', args: { command: 'gh pr create --fill' }, status: 'running' } },
                { toolCall: { id: 'created-pr', name: 'bash', args: {}, status: 'completed', result: 'https://github.com/org/repo/pull/99' } },
            ],
        }];

        const calls = collectToolCallsFromTurns(turns);
        expect(calls).toHaveLength(1);
        expect(calls[0].args).toEqual(turns[0].timeline![0].toolCall!.args);
        expect(calls[0].status).toBe('completed');
        expect(detectPullRequestsInToolGroup(calls, { remoteUrl: 'https://github.com/org/repo' }))
            .toEqual([expect.objectContaining({ number: 99, toolCallId: 'created-pr' })]);
    });

    it.each(['Bash', 'shell'])('detects a PR from %s when completion repeats the command', name => {
        const calls = collectToolCallsFromTurns([{
            timeline: [
                { toolCall: { id: 'created-pr', name, args: { command: 'gh pr create --fill' }, status: 'running' } },
                { toolCall: { id: 'created-pr', name, args: { command: 'gh pr create --fill' }, status: 'completed', result: 'https://github.com/org/repo/pull/99' } },
            ],
        }]);

        expect(detectPullRequestsInToolGroup(calls, { remoteUrl: 'https://github.com/org/repo' }))
            .toEqual([expect.objectContaining({ number: 99 })]);
    });

    it('does not mistake a failed completion for a successful creation', () => {
        const calls = collectToolCallsFromTurns([{
            timeline: [
                { toolCall: { id: 'failed-pr', name: 'bash', args: { command: 'gh pr create --fill' }, status: 'running' } },
                { toolCall: { id: 'failed-pr', name: 'bash', args: {}, status: 'failed', result: 'https://github.com/org/repo/pull/99' } },
            ],
        }]);

        expect(calls[0].status).toBe('failed');
        expect(detectPullRequestsInToolGroup(calls)).toEqual([]);
    });

    it('recovers the command from a flat tool call when timeline completion lacks it', () => {
        const calls = collectToolCallsFromTurns([{
            timeline: [{ toolCall: { id: 'created-pr', name: 'bash', args: {}, status: 'completed', result: 'https://github.com/org/repo/pull/99' } }],
            toolCalls: [{ id: 'created-pr', name: 'bash', args: { command: 'gh pr create --fill' }, status: 'completed', result: 'https://github.com/org/repo/pull/99' }],
        }]);

        expect(detectPullRequestsInToolGroup(calls)).toEqual([expect.objectContaining({ number: 99 })]);
    });

    it('does not infer creation from a PR URL when no event contains a command', () => {
        const calls = collectToolCallsFromTurns([{
            timeline: [
                { toolCall: { id: 'read-pr', name: 'bash', args: {}, status: 'running' } },
                { toolCall: { id: 'read-pr', name: 'bash', args: {}, status: 'completed', result: 'https://github.com/org/repo/pull/99' } },
            ],
        }]);

        expect(detectPullRequestsInToolGroup(calls)).toEqual([]);
    });

    it('flattens tool calls from timeline and legacy toolCalls, deduped by id within each turn', () => {
        const turns: ToolCallBearingTurn[] = [
            {
                timeline: [
                    { toolCall: toolCall({ id: 'a', result: undefined }) },
                    { toolCall: toolCall({ id: 'a', result: 'A output' }) },
                ],
            },
            { toolCalls: [toolCall({ id: 'b', result: 'B output' })] },
        ];

        const calls = collectToolCallsFromTurns(turns);
        expect(calls.map(c => c.id)).toEqual(['a', 'b']);
        // The completed record (with output) wins over the tool-start placeholder.
        expect(calls[0].result).toBe('A output');
        expect(calls[1].result).toBe('B output');
    });

    it('does not overwrite a result-bearing record with a later empty one', () => {
        const calls = collectToolCallsFromTurns([
            {
                timeline: [{ toolCall: toolCall({ id: 'a', result: 'done' }) }],
                toolCalls: [toolCall({ id: 'a', result: undefined })],
            },
        ]);
        expect(calls).toHaveLength(1);
        expect(calls[0].result).toBe('done');
    });

    it('keeps ids from separate turns distinct', () => {
        const calls = collectToolCallsFromTurns([
            { toolCalls: [toolCall({ id: 'a', result: 'first' })] },
            { toolCalls: [toolCall({ id: 'a', result: 'second' })] },
        ]);
        expect(calls.map(c => c.result)).toEqual(['first', 'second']);
    });

    it('tolerates undefined / empty turns', () => {
        expect(collectToolCallsFromTurns(undefined)).toEqual([]);
        expect(collectToolCallsFromTurns([])).toEqual([]);
    });

    it('skips entries with no id', () => {
        const calls = collectToolCallsFromTurns([
            { toolCalls: [{ id: '', result: 'x' }, toolCall({ id: 'a' })] },
        ]);
        expect(calls.map(c => c.id)).toEqual(['a']);
    });
});
