import { describe, expect, it } from 'vitest';
import {
    collectToolCallsFromTurns,
    gatherDetectedPrsFromTurns,
    originIdForDetectedPr,
    unionAssociations,
    detectedPrsNeedingBinding,
    type PrAssociation,
} from '../../../src/server/spa/client/react/features/chat/conversation/prChatAssociation';
import { resolveCanonicalOriginId } from '../../../src/server/spa/client/react/repos/originScope';
import type { ClientConversationTurn, ClientToolCall } from '../../../src/server/spa/client/react/types/dashboard';
import type { DetectedPullRequest } from '../../../src/server/spa/client/react/features/chat/conversation/pullRequestDetection';

const WS = 'ws-1';

function toolCall(partial: Partial<ClientToolCall> & { id: string }): ClientToolCall {
    return { toolName: 'bash', args: {}, status: 'completed', ...partial };
}

function turn(partial: Partial<ClientConversationTurn>): ClientConversationTurn {
    return { role: 'assistant', content: '', timeline: [], ...partial };
}

describe('collectToolCallsFromTurns', () => {
    it('flattens tool calls from timeline and legacy toolCalls, deduped by id within each turn', () => {
        const turns: ClientConversationTurn[] = [
            turn({
                timeline: [
                    { type: 'tool-start', timestamp: '1', toolCall: toolCall({ id: 'a', result: undefined }) },
                    { type: 'tool-complete', timestamp: '2', toolCall: toolCall({ id: 'a', result: 'A output' }) },
                ],
            }),
            turn({ toolCalls: [toolCall({ id: 'b', result: 'B output' })] }),
        ];

        const calls = collectToolCallsFromTurns(turns);
        expect(calls.map(c => c.id)).toEqual(['a', 'b']);
        // The completed record (with output) wins over the tool-start placeholder.
        expect(calls[0].result).toBe('A output');
        expect(calls[1].result).toBe('B output');
    });

    it('does not overwrite a result-bearing record with a later empty one', () => {
        const turns: ClientConversationTurn[] = [
            turn({
                timeline: [{ type: 'tool-complete', timestamp: '1', toolCall: toolCall({ id: 'a', result: 'done' }) }],
                toolCalls: [toolCall({ id: 'a', result: undefined })],
            }),
        ];
        const calls = collectToolCallsFromTurns(turns);
        expect(calls).toHaveLength(1);
        expect(calls[0].result).toBe('done');
    });

    it('tolerates undefined / empty turns', () => {
        expect(collectToolCallsFromTurns(undefined)).toEqual([]);
        expect(collectToolCallsFromTurns([])).toEqual([]);
    });
});

describe('gatherDetectedPrsFromTurns', () => {
    it('detects GitHub and Azure DevOps PRs across loaded turns (AC-01 DoD #3)', () => {
        const turns: ClientConversationTurn[] = [
            turn({
                timeline: [
                    {
                        type: 'tool-complete',
                        timestamp: '1',
                        toolCall: toolCall({
                            id: 'gh',
                            toolName: 'powershell',
                            args: { command: 'gh pr create --fill' },
                            result: 'https://github.com/org/repo/pull/42',
                        }),
                    },
                ],
            }),
            turn({
                toolCalls: [
                    toolCall({
                        id: 'ado',
                        toolName: 'bash',
                        args: { command: 'az repos pr create --title sync' },
                        result: 'https://dev.azure.com/myorg/MyProject/_git/MyRepo/pullrequest/200',
                    }),
                ],
            }),
        ];

        const detected = gatherDetectedPrsFromTurns(turns);
        expect(detected).toHaveLength(2);
        expect(detected[0]).toMatchObject({ provider: 'github', number: 42, owner: 'org', repo: 'repo' });
        expect(detected[1]).toMatchObject({ provider: 'azure-devops', number: 200, organization: 'myorg', project: 'MyProject' });
    });

    it('de-duplicates the same PR URL emitted in multiple turns', () => {
        const make = (id: string) =>
            turn({
                toolCalls: [
                    toolCall({ id, toolName: 'bash', args: { command: 'gh pr create' }, result: 'https://github.com/org/repo/pull/7' }),
                ],
            });
        const detected = gatherDetectedPrsFromTurns([make('t1'), make('t2')]);
        expect(detected).toHaveLength(1);
        expect(detected[0].number).toBe(7);
    });

    it('detects a wrapper-created PR when a later assistant turn reuses a tool-call id', () => {
        const turns: ClientConversationTurn[] = [
            turn({
                toolCalls: [
                    toolCall({
                        id: 'item_1',
                        toolName: 'view',
                        args: { path: '.github/skills/submit-commits-as-pr/SKILL.md' },
                        result: 'Submit commits as a pull request.',
                    }),
                ],
            }),
            turn({
                toolCalls: [
                    toolCall({
                        id: 'item_1',
                        toolName: 'bash',
                        args: {
                            command: 'python .github/skills/submit-commits-as-pr/scripts/submit_commits_as_pr.py start abc123',
                        },
                        result: 'JSON: {"pr_url": "https://github.com/plusplusoneplusplus/shortcuts/pull/642", "status": "done"}',
                    }),
                ],
            }),
        ];

        expect(gatherDetectedPrsFromTurns(turns)).toEqual([
            expect.objectContaining({
                provider: 'github',
                number: 642,
                url: 'https://github.com/plusplusoneplusplus/shortcuts/pull/642',
                toolCallId: 'item_1',
            }),
        ]);
    });

    it('ignores read-only PR commands (gh pr view)', () => {
        const turns = [
            turn({
                toolCalls: [
                    toolCall({ id: 'v', toolName: 'powershell', args: { command: 'gh pr view 9' }, result: 'https://github.com/org/repo/pull/9' }),
                ],
            }),
        ];
        expect(gatherDetectedPrsFromTurns(turns)).toEqual([]);
    });
});

describe('gatherDetectedPrsFromTurns repo scoping', () => {
    const foreignTurn = turn({
        timeline: [
            {
                type: 'tool-complete',
                timestamp: '2024-01-01T00:00:00Z',
                toolCall: toolCall({
                    id: 'tc1',
                    args: { command: 'gh pr create --fill' },
                    result: 'https://github.com/someone-else/other-repo/pull/5',
                }),
            },
        ],
    });

    it('drops a detected PR that is not in the chat workspace\'s repo', () => {
        expect(gatherDetectedPrsFromTurns([foreignTurn], 'https://github.com/org/repo')).toEqual([]);
    });

    it('keeps a detected PR in the chat workspace\'s own repo', () => {
        const ownTurn = turn({
            timeline: [
                {
                    type: 'tool-complete',
                    timestamp: '2024-01-01T00:00:00Z',
                    toolCall: toolCall({
                        id: 'tc1',
                        args: { command: 'gh pr create --fill' },
                        result: 'https://github.com/org/repo/pull/42',
                    }),
                },
            ],
        });
        const detected = gatherDetectedPrsFromTurns([ownTurn], 'git@github.com:org/repo.git');
        expect(detected.map(pr => pr.number)).toEqual([42]);
    });

    it('does not scope when the chat has no remote URL', () => {
        expect(gatherDetectedPrsFromTurns([foreignTurn], null).map(pr => pr.number)).toEqual([5]);
    });
});

describe('originIdForDetectedPr', () => {
    const github: DetectedPullRequest = { number: 1, url: 'u', provider: 'github', owner: 'org', repo: 'repo', toolCallId: 't' };
    const ado: DetectedPullRequest = {
        number: 2, url: 'u', provider: 'azure-devops', organization: 'myorg', project: 'MyProject', repo: 'MyRepo', toolCallId: 't',
    };

    it('resolves the same origin a GitHub repo remote URL would', () => {
        expect(originIdForDetectedPr(github, WS)).toBe('gh_org_repo');
        expect(originIdForDetectedPr(github, WS)).toBe(
            resolveCanonicalOriginId({ workspaceId: WS, remoteUrl: 'https://github.com/org/repo.git' }),
        );
    });

    it('resolves the same origin an ADO repo remote URL would', () => {
        expect(originIdForDetectedPr(ado, WS)).toBe('ado_myorg_myproject');
        expect(originIdForDetectedPr(ado, WS)).toBe(
            resolveCanonicalOriginId({ workspaceId: WS, remoteUrl: 'https://dev.azure.com/myorg/MyProject/_git/MyRepo' }),
        );
    });

    it('returns null for unknown provider or missing fields', () => {
        expect(originIdForDetectedPr({ number: 1, url: 'u', provider: 'unknown', toolCallId: 't' }, WS)).toBeNull();
        expect(originIdForDetectedPr({ number: 1, url: 'u', provider: 'github', owner: 'org', toolCallId: 't' }, WS)).toBeNull();
        expect(originIdForDetectedPr({ number: 1, url: 'u', provider: 'azure-devops', organization: 'o', toolCallId: 't' }, WS)).toBeNull();
    });
});

describe('unionAssociations', () => {
    const chatOriginId = resolveCanonicalOriginId({ workspaceId: WS, remoteUrl: 'https://github.com/org/repo' });
    const detectedGh: DetectedPullRequest = { number: 42, url: 'https://github.com/org/repo/pull/42', provider: 'github', owner: 'org', repo: 'repo', toolCallId: 't' };

    it('merges a detected PR and its binding into one association with both sources', () => {
        const result = unionAssociations({
            detected: [detectedGh],
            bindings: [{ prId: '42', taskId: 'task-1' }],
            workspaceId: WS,
            chatOriginId,
        });
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject<Partial<PrAssociation>>({
            key: `${chatOriginId}:42`,
            originId: chatOriginId,
            prId: '42',
            number: 42,
            url: 'https://github.com/org/repo/pull/42',
            provider: 'github',
        });
        expect(result[0].sources.sort()).toEqual(['binding', 'detected']);
    });

    it('includes binding-only PRs (reload with the creating turn collapsed)', () => {
        const result = unionAssociations({ detected: [], bindings: [{ prId: '99' }], workspaceId: WS, chatOriginId });
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ originId: chatOriginId, prId: '99', number: 99 });
        expect(result[0].sources).toEqual(['binding']);
    });

    it('includes detected-only PRs and keeps detected entries first', () => {
        const result = unionAssociations({
            detected: [detectedGh],
            bindings: [{ prId: '7' }],
            workspaceId: WS,
            chatOriginId,
        });
        expect(result.map(a => a.prId)).toEqual(['42', '7']);
        expect(result[0].sources).toEqual(['detected']);
        expect(result[1].sources).toEqual(['binding']);
    });

    it('skips detected PRs with no resolvable origin', () => {
        const result = unionAssociations({
            detected: [{ number: 5, url: 'u', provider: 'unknown', toolCallId: 't' }],
            bindings: [],
            workspaceId: WS,
            chatOriginId,
        });
        expect(result).toEqual([]);
    });

    it('skips a detected PR from a different repo than the chat', () => {
        // A foreign PR used to be upserted under its own synthesized origin, so a
        // PR URL from any repo could render a banner on this chat.
        const foreign: DetectedPullRequest = {
            number: 5,
            url: 'https://github.com/someone-else/other-repo/pull/5',
            provider: 'github',
            owner: 'someone-else',
            repo: 'other-repo',
            toolCallId: 't',
        };
        const result = unionAssociations({ detected: [foreign], bindings: [], workspaceId: WS, chatOriginId });
        expect(result).toEqual([]);
    });

    it('skips a detected ADO PR from a different project than the chat', () => {
        const adoChatOrigin = resolveCanonicalOriginId({
            workspaceId: WS,
            remoteUrl: 'https://dev.azure.com/contoso/MyProject/_git/repo',
        });
        const foreign: DetectedPullRequest = {
            number: 8,
            url: 'https://dev.azure.com/contoso/OtherProject/_git/other/pullrequest/8',
            provider: 'azure-devops',
            organization: 'contoso',
            project: 'OtherProject',
            repo: 'other',
            toolCallId: 't',
        };
        const result = unionAssociations({
            detected: [foreign],
            bindings: [],
            workspaceId: WS,
            chatOriginId: adoChatOrigin,
        });
        expect(result).toEqual([]);
    });
});

describe('detectedPrsNeedingBinding', () => {
    const chatOriginId = resolveCanonicalOriginId({ workspaceId: WS, remoteUrl: 'https://github.com/org/repo' });

    it('returns detected PRs in the chat origin that are not yet bound', () => {
        const detected: DetectedPullRequest[] = [
            { number: 42, url: 'u1', provider: 'github', owner: 'org', repo: 'repo', toolCallId: 't1' },
            { number: 7, url: 'u2', provider: 'github', owner: 'org', repo: 'repo', toolCallId: 't2' },
        ];
        const result = detectedPrsNeedingBinding(detected, [{ prId: '7' }], WS, chatOriginId);
        expect(result).toEqual([{ originId: chatOriginId, prId: '42', number: 42 }]);
    });

    it('excludes detected PRs from a different repo than the chat origin', () => {
        const detected: DetectedPullRequest[] = [
            { number: 1, url: 'u', provider: 'github', owner: 'other', repo: 'elsewhere', toolCallId: 't' },
        ];
        expect(detectedPrsNeedingBinding(detected, [], WS, chatOriginId)).toEqual([]);
    });

    it('de-duplicates repeated detected PR numbers', () => {
        const detected: DetectedPullRequest[] = [
            { number: 42, url: 'u', provider: 'github', owner: 'org', repo: 'repo', toolCallId: 't1' },
            { number: 42, url: 'u', provider: 'github', owner: 'org', repo: 'repo', toolCallId: 't2' },
        ];
        const result = detectedPrsNeedingBinding(detected, [], WS, chatOriginId);
        expect(result).toEqual([{ originId: chatOriginId, prId: '42', number: 42 }]);
    });
});
