/**
 * Tests for queue bootstrap and reconnect wiring.
 *
 * Verifies that:
 * - useWebSocket exposes onConnect callback
 * - App.tsx does NOT fetch /queue during bootstrap (handled solely by handleConnect)
 * - App.tsx passes onConnect to useWebSocket for reconnect recovery
 * - QueueContext no longer includes the SEED_QUEUE action
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

    it('delegates open lifecycle to the shared CoC client', () => {
        expect(source).toContain('getSpaCocClient().events.connect');
        expect(source).toContain('onOpen: () => onConnectRef.current?.()');
    });
});

// ============================================================================
// App.tsx — bootstrap does NOT fetch /queue (handled by handleConnect)
// ============================================================================

describe('App.tsx — bootstrap does not fetch queue', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(path.join(CLIENT_DIR, 'App.tsx'), 'utf-8');
    });

    it('does not fetch /queue in bootstrap', () => {
        const bootstrapBlock = source.match(/async\s+function\s+bootstrap[\s\S]*?connect\(\)/);
        expect(bootstrapBlock).not.toBeNull();
        expect(bootstrapBlock![0]).not.toContain("fetchApi('/queue')");
    });

    it('does not dispatch SEED_QUEUE', () => {
        const bootstrapBlock = source.match(/async\s+function\s+bootstrap[\s\S]*?connect\(\)/);
        expect(bootstrapBlock).not.toBeNull();
        expect(bootstrapBlock![0]).not.toContain('SEED_QUEUE');
    });

    it('bootstrap fetches only preferences (processes moved to ReposContext)', () => {
        const bootstrapBlock = source.match(/async\s+function\s+bootstrap[\s\S]*?connect\(\)/);
        expect(bootstrapBlock).not.toBeNull();
        expect(bootstrapBlock![0]).toContain("fetchApi('/preferences')");
        expect(bootstrapBlock![0]).not.toContain("fetchApi('/processes/summaries')");
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
// App.tsx — per-repo queue WS aliasing (repoId hash -> workspace ID)
// ============================================================================

describe('App.tsx — per-repo queue update aliasing', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(path.join(CLIENT_DIR, 'App.tsx'), 'utf-8');
    });

    it('dispatches REPO_QUEUE_UPDATED when queue message includes repoId', () => {
        expect(source).toContain("type: 'REPO_QUEUE_UPDATED'");
        expect(source).toContain("repoId: String(msg.queue.repoId)");
    });

    it('falls back to QUEUE_UPDATED when no repoId present', () => {
        // The else branch when msg.queue.repoId is falsy dispatches QUEUE_UPDATED
        expect(source).toContain("type: 'QUEUE_UPDATED', queue: msg.queue");
    });

    it('guards dispatch with repoId check', () => {
        expect(source).toContain('if (msg.queue.repoId)');
    });
});

// ============================================================================
// QueueContext — SEED_QUEUE action removed
// ============================================================================

describe('QueueContext — SEED_QUEUE removed', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(path.join(CLIENT_DIR, 'contexts', 'QueueContext.tsx'), 'utf-8');
    });

    it('QueueContextState includes queueInitialized', () => {
        expect(source).toMatch(/interface\s+QueueContextState[\s\S]*?queueInitialized:\s*boolean/);
    });

    it('initialState sets queueInitialized to false', () => {
        expect(source).toMatch(/queueInitialized:\s*false/);
    });

    it('QueueAction union does not include SEED_QUEUE', () => {
        expect(source).not.toContain("type: 'SEED_QUEUE'");
    });

    it('QUEUE_UPDATED case sets queueInitialized to true', () => {
        const queueUpdatedCase = source.match(/case\s+'QUEUE_UPDATED'[\s\S]*?(?=case\s+')/);
        expect(queueUpdatedCase).not.toBeNull();
        expect(queueUpdatedCase![0]).toContain('queueInitialized: true');
    });

    it('reducer does not have a SEED_QUEUE case', () => {
        expect(source).not.toContain("case 'SEED_QUEUE'");
    });
});
