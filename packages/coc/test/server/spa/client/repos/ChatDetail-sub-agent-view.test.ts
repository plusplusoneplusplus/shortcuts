/**
 * @vitest-environment node
 *
 * Static-analysis test: the in-place sub-agent detail view + cascade dropdown
 * wiring in ChatDetail. ChatDetail is too heavyweight (SSE, queue/app contexts,
 * the coc client, model hooks) to render in a unit test, so — mirroring the
 * sibling ChatDetail-*.test.ts files — we assert the wiring against the source.
 * The pieces themselves (levels, sub-agent turns, hash helpers, the menu, the
 * detail view) are covered by their own unit/component tests.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SPA_ROOT = resolve(__dirname, '../../../../../src/server/spa/client/react');
const source = readFileSync(resolve(SPA_ROOT, 'features/chat/ChatDetail.tsx'), 'utf-8');
const canvasSource = readFileSync(resolve(SPA_ROOT, 'features/chat/agent-canvas/AgentCanvas.tsx'), 'utf-8');
const inspectorSource = readFileSync(resolve(SPA_ROOT, 'features/chat/agent-canvas/AgentInspector.tsx'), 'utf-8');

describe('ChatDetail sub-agent drill-in wiring', () => {
    it('imports the cascade menu, detail view, and the supporting helpers', () => {
        for (const name of [
            'AgentCascadeMenu', 'SubAgentDetailView', 'buildSubAgentTurns',
            'flattenAgentLevels', 'findAgentNode', 'pathToAgent',
            'readAgentFromHash', 'applyAgentToHash',
        ]) {
            expect(source).toContain(name);
        }
    });

    it('tracks the selected sub-agent in state, seeded from the hash', () => {
        expect(source).toMatch(/const\s+\[selectedAgentId,\s*setSelectedAgentId\]\s*=\s*useState/);
        expect(source).toMatch(/readAgentFromHash\(window\.location\.hash\)/);
    });

    it('derives showSubAgentDetail from a resolvable selected node', () => {
        expect(source).toMatch(/const\s+showSubAgentDetail\s*=\s*hasSubAgents\s*&&\s*selectedAgentNode\s*!=\s*null/);
    });

    it('renders the detail view BEFORE the canvas branch (precedence)', () => {
        const detailIdx = source.indexOf('showSubAgentDetail ?');
        const canvasIdx = source.indexOf("effectiveView === 'agents' ?");
        expect(detailIdx).toBeGreaterThan(-1);
        expect(canvasIdx).toBeGreaterThan(-1);
        expect(detailIdx).toBeLessThan(canvasIdx);
    });

    it('mounts the cascade menu in the viewToggle slot', () => {
        expect(source).toMatch(/<AgentCascadeMenu/);
        expect(source).toMatch(/onSelectAgent=\{handleSelectAgent\}/);
    });

    it('routes the view from the selection so the orchestrator returns to the thread', () => {
        // handleSelectAgent(null) (Orchestrator breadcrumb / cascade item /
        // canvas root) must switch the view back to the thread instead of
        // leaving the user on the agents canvas — delegated to the pure
        // viewForAgentSelection helper (covered directly in ChatViewToggle.test).
        expect(source).toContain('viewForAgentSelection');
        expect(source).toMatch(/setView\(viewForAgentSelection\(agentId\)\)/);
    });

    it('wires the canvas inspector action through the same selected-agent detail path', () => {
        expect(source).toMatch(/const\s+openAgentDetail\s*=\s*useCallback/);
        expect(source).toContain('handleSelectAgent(node.isRoot ? null : node.id)');
        expect(source).toContain('<AgentCanvas root={agentRoot} onOpenAgentDetail={openAgentDetail} />');
        expect(source).not.toContain('onOpenInThread={openAgentInThread}');
    });

    it('labels the inspector action as opening the sub-agent detail view', () => {
        expect(canvasSource).toContain('onOpenAgentDetail');
        expect(canvasSource).not.toContain('onOpenInThread');
        expect(inspectorSource).toContain('data-testid="agent-inspector-open-detail"');
        expect(inspectorSource).toContain('title="Open sub-agent detail"');
        expect(inspectorSource).toContain('Open sub-agent detail');
        expect(inspectorSource).not.toContain('Open in thread');
    });

    it('suppresses the follow-up composer in detail mode (read-only)', () => {
        // Every FollowUpInputArea render guard must include !showSubAgentDetail.
        const composerGuards = source.match(/!isPending && !noSessionForFollowUp && !readOnly && !showSubAgentDetail/g) ?? [];
        expect(composerGuards.length).toBeGreaterThanOrEqual(2);
    });

    it('composes both view and agent params into the hash mirror', () => {
        expect(source).toMatch(/applyAgentToHash\(applyChatViewToHash\(window\.location\.hash,\s*view\),\s*selectedAgentId\)/);
    });

    it('resets and clears the selected agent appropriately', () => {
        // reset on chat switch + clear when the id no longer resolves to a node
        expect(source).toMatch(/setSelectedAgentId\(hashViewSync \? readAgentFromHash/);
        expect(source).toMatch(/if\s*\(selectedAgentId\s*&&\s*!selectedAgentNode\)/);
    });
});
