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
    it('flattens tool calls from timeline and legacy toolCalls, deduped by id', () => {
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
