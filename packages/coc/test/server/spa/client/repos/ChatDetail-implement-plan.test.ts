/**
 * @vitest-environment node
 *
 * Source-level wiring tests for the ImplementPlanCard handoff in ChatDetail.
 *
 * We verify that ChatDetail.tsx imports ImplementPlanCard and gates its render
 * on the three required conditions: terminal status, plan mode, and a known
 * plan file path.
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

    it('gates rendering on terminal status, plan mode, and a known plan path', () => {
        const guard = source.match(
            /isTerminal\s*&&\s*resolveLoadedTaskMode\(task\)\s*===\s*'plan'\s*&&\s*effectivePlanPath/,
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
});
