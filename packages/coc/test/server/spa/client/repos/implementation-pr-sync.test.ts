import { describe, expect, it } from 'vitest';
import {
    mergeImplementationPrAnnotations,
    parseImplementationPrAnnotation,
} from '../../../../../src/server/spa/client/react/features/chat/implementation-pr-sync';

describe('implementation PR record sync', () => {
    it('parses valid target annotations and rejects malformed values', () => {
        expect(parseImplementationPrAnnotation({
            chainId: 'chain-1',
            prUrl: 'https://github.com/acme/repo/pull/7',
            prNumber: 7,
            prState: 'open',
        })).toEqual({
            chainId: 'chain-1',
            prUrl: 'https://github.com/acme/repo/pull/7',
            prNumber: 7,
            prState: 'open',
        });
        expect(parseImplementationPrAnnotation({ chainId: 'chain-1', prState: 'merged' })).toBeUndefined();
    });

    it('updates only the source record with the matching process and chain', () => {
        const records = [
            {
                processId: 'queue_impl-1',
                planFilePath: '/plan.md',
                enqueuedAt: '2026-01-01T00:00:00Z',
                prGateChainId: 'chain-1',
                prState: 'pending' as const,
            },
            {
                processId: 'queue_impl-2',
                planFilePath: '/other.md',
                enqueuedAt: '2026-01-01T00:00:00Z',
                prGateChainId: 'chain-2',
                prState: 'pending' as const,
            },
        ];

        const updated = mergeImplementationPrAnnotations(records, {
            'queue_impl-1': {
                chainId: 'chain-1',
                prUrl: 'https://github.com/acme/repo/pull/7',
                prNumber: 7,
                prState: 'merged',
            },
            'queue_impl-2': {
                chainId: 'stale-chain',
                prUrl: 'https://github.com/acme/repo/pull/8',
                prNumber: 8,
                prState: 'open',
            },
        });

        expect(updated[0]).toMatchObject({
            prUrl: 'https://github.com/acme/repo/pull/7',
            prNumber: 7,
            prState: 'merged',
        });
        expect(updated[1]).toBe(records[1]);
    });
});
