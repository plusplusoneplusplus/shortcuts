/**
 * @vitest-environment node
 *
 * Static-analysis test: the Thread/Agents toggle must only appear once a chat
 * has actually spawned sub-agents, and the canvas must never render without
 * them — even via a stale `?view=agents` deep-link.
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

describe('ChatDetail Agents toggle visibility', () => {
    it('derives hasSubAgents from the agent tree children', () => {
        expect(source).toMatch(/const\s+hasSubAgents\s*=\s*agentRoot\.children\.length\s*>\s*0/);
    });

    it('pins the rendered view to thread when there are no sub-agents', () => {
        expect(source).toMatch(/const\s+effectiveView\s*:\s*ChatView\s*=\s*hasSubAgents\s*\?\s*view\s*:\s*'thread'/);
    });

    it('gates the Thread/Agents toggle on hasSubAgents', () => {
        // The toggle must be hidden when no sub-agents exist; `hasSubAgents`
        // is the first guard in the viewToggle expression.
        expect(source).toMatch(/viewToggle=\{hasSubAgents\s*&&/);
    });

    it('renders the canvas from effectiveView, not the raw view state', () => {
        expect(source).toMatch(/effectiveView\s*===\s*'agents'\s*\?/);
        expect(source).not.toMatch(/\{view\s*===\s*'agents'\s*\?/);
    });

    it('gates the thread-only side panels on effectiveView', () => {
        // Ralph start + ImplementPlan cards should show when we fall back to
        // the thread, so they must key off effectiveView rather than `view`.
        expect(source).not.toMatch(/\{view\s*===\s*'thread'\s*&&/);
        const threadGuards = source.match(/effectiveView\s*===\s*'thread'\s*&&/g) ?? [];
        expect(threadGuards.length).toBeGreaterThanOrEqual(2);
    });
});
