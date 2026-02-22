/**
 * Tests for queue bootstrap and reconnect wiring.
 *
 * Verifies that:
 * - useWebSocket exposes onConnect callback
 * - App.tsx fetches /queue during bootstrap and dispatches SEED_QUEUE
 * - App.tsx passes onConnect to useWebSocket for reconnect recovery
 * - QueueContext includes queueInitialized flag and SEED_QUEUE action
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CLIENT_DIR = path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react');

// ============================================================================
// useWebSocket — onConnect callback support
// ============================================================================

describe('useWebSocket — onConnect callback', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(path.join(CLIENT_DIR, 'hooks', 'useWebSocket.ts'), 'utf-8');
    });

    it('accepts onConnect in UseWebSocketOptions', () => {
        expect(source).toContain('onConnect');
        expect(source).toMatch(/interface\s+UseWebSocketOptions[\s\S]*?onConnect/);
    });

    it('stores onConnect in a ref for stable callback identity', () => {
        expect(source).toContain('onConnectRef');
        expect(source).toMatch(/useRef.*onConnect/);
    });

    it('keeps onConnectRef in sync via useEffect', () => {
        expect(source).toMatch(/onConnectRef\.current\s*=\s*onConnect/);
    });

    it('calls onConnectRef in the onopen handler', () => {
        expect(source).toMatch(/onConnectRef\.current\?\.\(\)/);
    });

    it('calls onConnect after ping interval is set up', () => {
        const onopenMatch = source.match(/ws\.onopen\s*=\s*\(\)\s*=>\s*\{([\s\S]*?)\};/);
        expect(onopenMatch).not.toBeNull();
        const onopenBody = onopenMatch![1];
        const pingIndex = onopenBody.indexOf('setInterval');
        const connectIndex = onopenBody.indexOf('onConnectRef.current');
        expect(pingIndex).toBeGreaterThan(-1);
        expect(connectIndex).toBeGreaterThan(pingIndex);
    });
});

// ============================================================================
// App.tsx — bootstrap /queue fetch
// ============================================================================

describe('App.tsx — bootstrap queue fetch', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(path.join(CLIENT_DIR, 'App.tsx'), 'utf-8');
    });

    it('fetches /queue in the bootstrap Promise.all', () => {
        expect(source).toContain("fetchApi('/queue')");
        expect(source).toMatch(/Promise\.all\(\[[\s\S]*?fetchApi\('\/queue'\)/);
    });

    it('dispatches SEED_QUEUE with the queue response', () => {
        expect(source).toContain("type: 'SEED_QUEUE'");
        expect(source).toContain('SEED_QUEUE');
    });

    it('guards SEED_QUEUE dispatch with Array.isArray checks', () => {
        const seedBlock = source.match(/if\s*\(qRes[\s\S]*?SEED_QUEUE[\s\S]*?\}/);
        expect(seedBlock).not.toBeNull();
        expect(seedBlock![0]).toContain('Array.isArray(qRes.queued)');
        expect(seedBlock![0]).toContain('Array.isArray(qRes.running)');
    });

    it('catches /queue fetch errors gracefully', () => {
        expect(source).toMatch(/fetchApi\('\/queue'\)\.catch\(\(\)\s*=>\s*null\)/);
    });
});

// ============================================================================
// App.tsx — onConnect handler for WS reconnect
// ============================================================================

describe('App.tsx — onConnect reconnect handler', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(path.join(CLIENT_DIR, 'App.tsx'), 'utf-8');
    });

    it('defines handleConnect callback', () => {
        expect(source).toContain('handleConnect');
        expect(source).toMatch(/const\s+handleConnect\s*=\s*useCallback/);
    });

    it('handleConnect fetches /queue', () => {
        const handleConnectBlock = source.match(/const\s+handleConnect[\s\S]*?(?=\n\s{4}const\s)/);
        expect(handleConnectBlock).not.toBeNull();
        expect(handleConnectBlock![0]).toContain("fetchApi('/queue')");
    });

    it('handleConnect dispatches QUEUE_UPDATED (not SEED_QUEUE) for reconnect', () => {
        const handleConnectBlock = source.match(/const\s+handleConnect[\s\S]*?(?=\n\s{4}const\s)/);
        expect(handleConnectBlock).not.toBeNull();
        expect(handleConnectBlock![0]).toContain("type: 'QUEUE_UPDATED'");
        expect(handleConnectBlock![0]).not.toContain("type: 'SEED_QUEUE'");
    });

    it('handleConnect guards dispatch with Array.isArray checks', () => {
        const handleConnectBlock = source.match(/const\s+handleConnect[\s\S]*?(?=\n\s{4}const\s)/);
        expect(handleConnectBlock).not.toBeNull();
        expect(handleConnectBlock![0]).toContain('Array.isArray(data.queued)');
        expect(handleConnectBlock![0]).toContain('Array.isArray(data.running)');
    });

    it('passes onConnect to useWebSocket', () => {
        expect(source).toContain('onConnect: handleConnect');
    });
});

// ============================================================================
// QueueContext — queueInitialized flag and SEED_QUEUE action
// ============================================================================

describe('QueueContext — queueInitialized and SEED_QUEUE', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(path.join(CLIENT_DIR, 'context', 'QueueContext.tsx'), 'utf-8');
    });

    it('QueueContextState includes queueInitialized', () => {
        expect(source).toMatch(/interface\s+QueueContextState[\s\S]*?queueInitialized:\s*boolean/);
    });

    it('initialState sets queueInitialized to false', () => {
        expect(source).toMatch(/queueInitialized:\s*false/);
    });

    it('QueueAction union includes SEED_QUEUE', () => {
        expect(source).toContain("type: 'SEED_QUEUE'");
    });

    it('QUEUE_UPDATED case sets queueInitialized to true', () => {
        const queueUpdatedCase = source.match(/case\s+'QUEUE_UPDATED'[\s\S]*?(?=case\s+')/);
        expect(queueUpdatedCase).not.toBeNull();
        expect(queueUpdatedCase![0]).toContain('queueInitialized: true');
    });

    it('SEED_QUEUE case checks queueInitialized before applying', () => {
        const seedCase = source.match(/case\s+'SEED_QUEUE'[\s\S]*?(?=case\s+'|default:)/);
        expect(seedCase).not.toBeNull();
        expect(seedCase![0]).toContain('state.queueInitialized');
        expect(seedCase![0]).toContain('return state');
    });
});
