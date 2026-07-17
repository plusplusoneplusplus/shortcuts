/**
 * @vitest-environment node
 *
 * Static-analysis test: the agent tree control must only appear once a chat
 * has actually spawned sub-agents, and the map must never render without them
 * even via a stale `?view=agents` deep-link.
 *
 * ChatDetail is too heavyweight (SSE, queue/app contexts, the coc client,
 * model hooks) to render in a unit test, so — mirroring the other ChatDetail
 * tests in this folder — we assert the wiring against the source. The data
 * contract this wiring depends on (no `Task` calls ⇒ `root.children` is empty)
 * is covered directly in agent-canvas-data.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SPA_ROOT = resolve(__dirname, '../../../../../src/server/spa/client/react');
const source = readFileSync(resolve(SPA_ROOT, 'features/chat/ChatDetail.tsx'), 'utf-8');

describe('ChatDetail agent navigation visibility', () => {
    it('derives hasSubAgents from the agent tree children', () => {
        expect(source).toMatch(/const\s+hasSubAgents\s*=\s*agentRoot\.children\.length\s*>\s*0/);
    });

    it('tracks agent navigation as one state variable', () => {
        expect(source).toMatch(/const\s+\[nav,\s*setNav\]\s*=\s*useState<AgentNav>/);
        expect(source).not.toMatch(/const\s+\[view,\s*setView\]\s*=\s*useState/);
        expect(source).not.toMatch(/const\s+\[selectedAgentId,\s*setSelectedAgentId\]\s*=\s*useState/);
    });

    it('pins the rendered nav to thread when there are no sub-agents', () => {
        expect(source).toMatch(/const\s+effectiveNav:\s*AgentNav\s*=\s*!hasSubAgents[\s\S]*\?\s*\{\s*kind:\s*'thread'\s*\}[\s\S]*:\s*nav/);
    });

    it('gates the single agent tree control on hasSubAgents', () => {
        expect(source).toMatch(/viewToggle=\{hasSubAgents\s*&&/);
        expect(source).toContain('<AgentTreeMenu');
        expect(source).not.toContain('<ChatViewToggle');
        expect(source).not.toContain('<AgentCascadeMenu');
    });

    it('renders the map from effectiveNav, not raw nav state', () => {
        expect(source).toMatch(/effectiveNav\.kind\s*===\s*'map'\s*\?/);
        expect(source).not.toMatch(/nav\.kind\s*===\s*'map'\s*\?/);
    });

    it('gates the thread-only side panels on effectiveNav', () => {
        // Ralph start + ImplementPlan cards should show when we fall back to
        // the thread, so they must key off effectiveNav rather than raw `nav`.
        expect(source).not.toMatch(/\{nav\.kind\s*===\s*'thread'\s*&&/);
        const threadGuards = source.match(/effectiveNav\.kind\s*===\s*'thread'\s*&&/g) ?? [];
        expect(threadGuards.length).toBeGreaterThanOrEqual(2);
    });
});
