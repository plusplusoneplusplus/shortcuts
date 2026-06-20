/**
 * @vitest-environment node
 *
 * Source-level wiring tests for the ImplementPlanCard handoff in ChatDetail.
 *
 * We verify that ChatDetail.tsx imports ImplementPlanCard and gates its render
 * on the required conditions: terminal status, Ask mode, and a known plan file
 * path. Also verifies that the new existing-runs props are wired.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CHAT_DETAIL_SOURCE = resolve(
    __dirname,
    '../../../../../src/server/spa/client/react/features/chat/ChatDetail.tsx',
);

const source = readFileSync(CHAT_DETAIL_SOURCE, 'utf-8');

describe('ChatDetail implement-plan handoff', () => {
    it('imports ImplementPlanCard from the chat features folder', () => {
        expect(source).toContain("import { ImplementPlanCard } from './ImplementPlanCard'");
    });

    it('imports ImplementationRecord and ExistingRun types', () => {
        expect(source).toContain("import type { ImplementationRecord, ExistingRun, RunLiveStatus } from './ImplementPlanCard'");
    });

    it('gates rendering on terminal status, not busy, Ask mode, and a known plan path', () => {
        const guard = source.match(
            /isTerminal\s*&&\s*!planChatBusy\s*&&\s*resolveLoadedTaskMode\(task\)\s*===\s*'ask'\s*&&\s*effectivePlanPath/,
        );
        expect(guard).not.toBeNull();
    });

    it('passes effectivePlanPath, workspaceId, and workingDirectory to the card', () => {
        const cardBlock = source.match(/<ImplementPlanCard[\s\S]*?\/>/);
        expect(cardBlock).not.toBeNull();
        const block = cardBlock![0];
        expect(block).toContain('planFilePath={effectivePlanPath}');
        expect(block).toContain('workspaceId={workspaceId}');
        expect(block).toContain('workingDirectory={workingDirectory}');
        expect(block).toContain('onImplemented=');
    });

    it('navigates by dispatching SELECT_QUEUE_TASK in the onImplemented handler', () => {
        const cardBlock = source.match(/<ImplementPlanCard[\s\S]*?\/>/);
        expect(cardBlock).not.toBeNull();
        expect(cardBlock![0]).toContain("queueDispatch({ type: 'SELECT_QUEUE_TASK'");
    });

    it('passes existingRuns (resolvedRuns) and onViewRun to the card', () => {
        const cardBlock = source.match(/<ImplementPlanCard[\s\S]*?\/>/);
        expect(cardBlock).not.toBeNull();
        const block = cardBlock![0];
        expect(block).toContain('existingRuns={resolvedRuns}');
        expect(block).toContain('onViewRun=');
    });

    it('passes availableTargets (implementTargets) to the card', () => {
        const cardBlock = source.match(/<ImplementPlanCard[\s\S]*?\/>/);
        expect(cardBlock).not.toBeNull();
        expect(cardBlock![0]).toContain('availableTargets={implementTargets}');
    });

    it('routes onViewRun to the run target server (targetWorkspaceId ?? workspaceId)', () => {
        const cardBlock = source.match(/<ImplementPlanCard[\s\S]*?\/>/);
        expect(cardBlock).not.toBeNull();
        const block = cardBlock![0];
        expect(block).toMatch(/onViewRun=\{\(runProcessId,\s*targetWorkspaceId\)/);
        expect(block).toContain('repoId: targetWorkspaceId ?? workspaceId');
    });

    it('builds implementTargets from the repos context, gated by remote-shell availability', () => {
        expect(source).toContain("import { buildImplementTargets } from './implementTargets'");
        expect(source).toContain('const implementTargets = useMemo(');
        expect(source).toMatch(/if\s*\(!isRemoteShellEnabled\(\)\s*\|\|\s*!reposCtx\)\s*return undefined/);
    });

    it('resolves remote run status via the target-routed client', () => {
        expect(source).toContain('getCocClientForWorkspace');
        expect(source).toMatch(/run\.isRemoteTarget\s*\?\s*getCocClientForWorkspace\(run\.targetWorkspaceId\)/);
    });

    it('passes sourceProcessId and sourceMetadata for persistence', () => {
        const cardBlock = source.match(/<ImplementPlanCard[\s\S]*?\/>/);
        expect(cardBlock).not.toBeNull();
        const block = cardBlock![0];
        expect(block).toContain('sourceProcessId=');
        expect(block).toContain('sourceMetadata=');
    });

    it('passes onRecordPersisted for optimistic local update', () => {
        const cardBlock = source.match(/<ImplementPlanCard[\s\S]*?\/>/);
        expect(cardBlock).not.toBeNull();
        expect(cardBlock![0]).toContain('onRecordPersisted=');
    });

    it('defines planChatBusy predicate gating on sending, isActiveGeneration, and pendingQueue', () => {
        const predicate = source.match(
            /const\s+planChatBusy\s*=\s*sending\s*\|\|\s*isActiveGeneration\s*\|\|\s*\(pendingQueue\?\.\s*length\s*\?\?\s*0\)\s*>\s*0/,
        );
        expect(predicate).not.toBeNull();
    });

    it('planChatBusy is derived right after isTerminal', () => {
        const terminalIdx = source.indexOf('const isTerminal =');
        const busyIdx = source.indexOf('const planChatBusy =');
        expect(terminalIdx).toBeGreaterThan(-1);
        expect(busyIdx).toBeGreaterThan(terminalIdx);
        // Should be within a few lines (no large gap)
        const between = source.slice(terminalIdx, busyIdx);
        expect(between.split('\n').length).toBeLessThanOrEqual(3);
    });

    it('resolves implementation runs from task metadata', () => {
        expect(source).toContain('rawImplementations');
        expect(source).toContain('task?.metadata?.implementations');
        expect(source).toContain('resolvedRuns');
    });
});
