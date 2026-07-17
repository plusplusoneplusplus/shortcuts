/**
 * @vitest-environment node
 *
 * Static-analysis test: the in-place sub-agent detail view + tree popover
 * wiring in ChatDetail. ChatDetail is too heavyweight (SSE, queue/app contexts,
 * the coc client, model hooks) to render in a unit test, so — mirroring the
 * sibling ChatDetail-*.test.ts files — we assert the wiring against the source.
 * The pieces themselves (tree rows, sub-agent turns, hash helpers, the menu,
 * the detail view) are covered by their own unit/component tests.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SPA_ROOT = resolve(__dirname, '../../../../../src/server/spa/client/react');
const source = readFileSync(resolve(SPA_ROOT, 'features/chat/ChatDetail.tsx'), 'utf-8');
const canvasSource = readFileSync(resolve(SPA_ROOT, 'features/chat/agent-canvas/AgentCanvas.tsx'), 'utf-8');

describe('ChatDetail sub-agent drill-in wiring', () => {
    it('imports the tree menu, detail view, and the supporting helpers', () => {
        for (const name of [
            'AgentTreeMenu', 'SubAgentDetailView', 'buildSubAgentTurns',
            'findAgentNode', 'pathToAgent',
            'readAgentNavFromHash', 'applyAgentNavToHash',
        ]) {
            expect(source).toContain(name);
        }
    });

    it('tracks one nav state seeded from the hash', () => {
        expect(source).toMatch(/const\s+\[nav,\s*setNav\]\s*=\s*useState<AgentNav>/);
        expect(source).toMatch(/readAgentNavFromHash\(window\.location\.hash\)/);
    });

    it('derives the selected agent from nav and a resolvable node', () => {
        expect(source).toMatch(/const\s+rawSelectedAgentId\s*=\s*nav\.kind\s*===\s*'agent'\s*\?\s*nav\.id\s*:\s*null/);
        expect(source).toMatch(/const\s+showAgentDetail\s*=\s*effectiveNav\.kind\s*===\s*'agent'\s*&&\s*selectedAgentNode\s*!=\s*null/);
    });

    it('renders the detail view BEFORE the map branch (precedence)', () => {
        const detailIdx = source.indexOf('showAgentDetail ?');
        const canvasIdx = source.indexOf("effectiveNav.kind === 'map' ?");
        expect(detailIdx).toBeGreaterThan(-1);
        expect(canvasIdx).toBeGreaterThan(-1);
        expect(detailIdx).toBeLessThan(canvasIdx);
    });

    it('mounts the tree menu in the viewToggle slot', () => {
        expect(source).toMatch(/<AgentTreeMenu/);
        expect(source).toMatch(/onSelectAgent=\{handleSelectAgent\}/);
        expect(source).toMatch(/onOpenMap=\{handleOpenMap\}/);
    });

    it('routes selection through the AgentNav union', () => {
        expect(source).toMatch(/setNav\(agentId\s*\?\s*\{\s*kind:\s*'agent',\s*id:\s*agentId\s*\}\s*:\s*\{\s*kind:\s*'thread'\s*\}\)/);
        expect(source).toMatch(/setNav\(\{\s*kind:\s*'map'\s*\}\)/);
    });

    it('wires canvas clicks through the same selected-agent detail path', () => {
        expect(source).toMatch(/const\s+openAgentDetail\s*=\s*useCallback/);
        expect(source).toContain('handleSelectAgent(node.isRoot ? null : node.id)');
        expect(source).toContain('<AgentCanvas root={agentRoot} onOpenAgentDetail={openAgentDetail} />');
        expect(source).not.toContain('onOpenInThread={openAgentInThread}');
    });

    it('keeps the canvas free of inspector state', () => {
        expect(canvasSource).toContain('onOpenAgentDetail');
        expect(canvasSource).not.toContain('AgentInspector');
        expect(canvasSource).not.toContain('selectedNode');
        expect(canvasSource).not.toContain('selectedId');
    });

    it('suppresses the follow-up composer in detail mode (read-only)', () => {
        const composerGuards = source.match(/!isPending && !noSessionForFollowUp && !readOnly && effectiveNav\.kind !== 'agent'/g) ?? [];
        expect(composerGuards.length).toBeGreaterThanOrEqual(2);
    });

    it('mirrors nav into the hash with one codec call', () => {
        expect(source).toMatch(/applyAgentNavToHash\(window\.location\.hash,\s*nav\)/);
        expect(source).not.toContain('applyChatViewToHash');
        expect(source).not.toContain('applyAgentToHash');
    });

    it('resets and clears stale nav appropriately', () => {
        expect(source).toMatch(/setNav\(hashViewSync \? readAgentNavFromHash/);
        expect(source).toMatch(/if\s*\(nav\.kind\s*===\s*'agent'\s*&&\s*!selectedAgentNode\)/);
        expect(source).toMatch(/setNav\(\{\s*kind:\s*'thread'\s*\}\)/);
    });
});
