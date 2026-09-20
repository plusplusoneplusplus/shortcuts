import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SPA_ROOT = resolve(__dirname, '../../../../../src/server/spa/client/react');

describe('ChatDetail follow-up provider model wiring', () => {
    const source = readFileSync(resolve(SPA_ROOT, 'features/chat/ChatDetail.tsx'), 'utf-8');

    it('loads pending-provider catalogs from the server that owns the conversation', () => {
        expect(source).toContain('const composerProvider: ConcreteChatProvider = pendingProvider ?? conversationProvider;');
        expect(source).toContain('useModels(composerProvider, owningServerBaseUrl)');
        expect(source).toContain('useProviderReasoningEfforts(composerProvider, owningServerBaseUrl)');
        expect(source).toContain('useProviderEffortTiers(composerProvider, owningServerBaseUrl)');
        expect(source).toContain('useAgentProviders(owningServerBaseUrl)');
        expect(source).not.toContain('const { models: availableModels } = useModels();');
    });

    it('passes only a confirmed pending provider into the follow-up request', () => {
        expect(source).toContain('providerOverride: pendingProvider ?? undefined');
    });

    it('retries with the failed user turn provider unless another provider was confirmed', () => {
        expect(source).toContain('providerOverride: getRetryProvider(turnsRef.current, pendingProvider)');
    });

    it('seeds token limits from the same provider-scoped catalog', () => {
        expect(source).toContain('const info = activeProviderModels.find((m: ModelInfo) => m.id === sessionModel);');
        expect(source).not.toContain('agentProviders.listModels(getActiveProvider())');
    });

    it('does not display the outgoing session model for a pending target provider', () => {
        expect(source).toContain('const composerSessionModel = pendingProvider ? undefined : sessionModel;');
        expect(source).toContain('sessionModel={composerSessionModel}');
    });
});
