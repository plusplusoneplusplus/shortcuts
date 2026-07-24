/**
 * Source-level tests verifying that NewChatArea and ChatDetail have the
 * correct effort-derive wiring.  These tests read the source files and assert
 * on structural patterns without mounting the full component trees (which
 * require many heavy mocks).  Complements the unit tests for deriveEffort and
 * useProviderReasoningEfforts.
 *
 * The ACs tested here correspond to the Reasoning-Effort Picker spec §9.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CHAT_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'chat',
);

const NEW_CHAT_PATH = path.join(CHAT_DIR, 'NewChatArea.tsx');
const CHAT_DETAIL_PATH = path.join(CHAT_DIR, 'ChatDetail.tsx');

describe('NewChatArea effort-derive wiring', () => {
    let src: string;
    beforeAll(() => { src = fs.readFileSync(NEW_CHAT_PATH, 'utf-8'); });

    it('imports deriveEffort from effortUtils', () => {
        expect(src).toContain("import { deriveEffort }");
        expect(src).toContain("effortUtils");
    });

    it('imports useProviderReasoningEfforts', () => {
        expect(src).toContain("import { useProviderReasoningEfforts }");
    });

    it('calls useProviderReasoningEfforts with the concrete provider used by provider-scoped hooks, routed to the owning clone', () => {
        // AC-07: the reasoning-effort read is routed to the selected workspace's
        // clone via the resolved cloneBaseUrl (see providerHooks-clone-routing.test.ts).
        expect(src).toContain('useProviderReasoningEfforts(selectedProviderForClientHooks, cloneBaseUrl)');
    });

    it('declares userPickedForModelRef', () => {
        expect(src).toContain('userPickedForModelRef');
    });

    it('includes auto-derive useEffect that watches selectedProvider and effectiveModelId', () => {
        expect(src).toContain('selectedProvider, effectiveModelId');
    });

    it('draft restore does NOT call setEffortOverride from draft.effortOverride', () => {
        // The draft restore should no longer restore effortOverride from the draft
        expect(src).not.toContain("setEffortOverride(draft.effortOverride)");
    });

    it('handleEffortChange sets userPickedForModelRef', () => {
        expect(src).toContain('userPickedForModelRef.current = { provider: selectedProvider');
    });

    it('EffortPillSelector uses handleEffortChange not setEffortOverride directly', () => {
        expect(src).toContain('onChange={handleEffortChange}');
    });

    it('calls deriveEffort inside the auto-derive effect', () => {
        expect(src).toContain('deriveEffort(');
    });

    it('logs auto-derive event with trigger tag', () => {
        expect(src).toContain('[coc-effort-auto-derive]');
        expect(src).toContain('trigger:');
    });
});

describe('ChatDetail effort-derive wiring', () => {
    let src: string;
    beforeAll(() => { src = fs.readFileSync(CHAT_DETAIL_PATH, 'utf-8'); });

    it('imports deriveEffort', () => {
        expect(src).toContain("import { deriveEffort }");
    });

    it('imports useProviderReasoningEfforts', () => {
        expect(src).toContain("import { useProviderReasoningEfforts }");
    });

    it('calls useProviderReasoningEfforts with sessionProvider', () => {
        expect(src).toContain('useProviderReasoningEfforts(sessionProvider)');
    });

    it('uses EffortLevel type for effortOverride', () => {
        expect(src).toContain('useState<EffortLevel | null>(null)');
    });

    it('declares effortInitializedRef', () => {
        expect(src).toContain('effortInitializedRef');
    });

    it('resets effortInitializedRef on taskId change', () => {
        // The reset block should include effortInitializedRef.current = false
        expect(src).toContain('effortInitializedRef.current = false');
    });

    it('initialises from processDetails.config.reasoningEffort (§5.1)', () => {
        expect(src).toContain("config?.reasoningEffort");
    });

    it('uses deriveEffort in the init effect', () => {
        expect(src).toContain('deriveEffort(');
    });

    it('has a model-override-swap re-derive effect that watches modelCommand.modelOverride', () => {
        expect(src).toContain('modelCommand.modelOverride]');
    });

    it('clears stale modelOverride when sessionProvider changes', () => {
        expect(src).toContain('previousSessionProviderRef');
        expect(src).toContain('modelCommand.setModelOverride(null)');
        expect(src).toContain('[sessionProvider, modelCommand.setModelOverride]');
    });

    it('uses chatEffectiveModelId for the mid-conversation derive', () => {
        expect(src).toContain('chatEffectiveModelId');
    });

    it('logs existing-chat-init trigger tag', () => {
        expect(src).toContain('existing-chat-init');
    });

    it('logs model-swap trigger tag', () => {
        expect(src).toContain('model-swap');
    });

    it('both FollowUpInputArea instances use handleEffortChange', () => {
        const matches = [...src.matchAll(/onEffortChange=\{([^}]+)\}/g)].map(m => m[1]);
        // All occurrences should be handleEffortChange
        expect(matches.length).toBeGreaterThanOrEqual(2);
        for (const m of matches) {
            expect(m.trim()).toBe('handleEffortChange');
        }
    });
});
