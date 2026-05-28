import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SPA_ROOT = resolve(__dirname, '../../../../../src/server/spa/client/react');

describe('ChatDetail follow-up provider model wiring', () => {
    const source = readFileSync(resolve(SPA_ROOT, 'features/chat/ChatDetail.tsx'), 'utf-8');

    it('loads the follow-up model picker from the conversation provider catalog', () => {
        expect(source).toContain('const { models: availableModels } = useModels(sessionProvider);');
        expect(source).not.toContain('const { models: availableModels } = useModels();');
    });

    it('seeds token limits from the same provider-scoped catalog', () => {
        expect(source).toContain('const info = availableModels.find((m: ModelInfo) => m.id === sessionModel);');
        expect(source).not.toContain('agentProviders.listModels(getActiveProvider())');
    });
});
