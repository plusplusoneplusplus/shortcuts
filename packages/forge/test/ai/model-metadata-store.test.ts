/**
 * ModelMetadataStore Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setLogger, nullLogger } from '../../src/logger';

setLogger(nullLogger);

// Mock sdkServiceRegistry before importing the store
const mockGetOrThrow = vi.hoisted(() => vi.fn());
vi.mock('../../src/copilot-sdk-wrapper/sdk-service-registry', () => ({
    sdkServiceRegistry: {
        getOrThrow: mockGetOrThrow,
    },
    SDK_PROVIDER_COPILOT: 'copilot',
    COPILOT_PROVIDER: 'copilot',
}));

import { modelMetadataStore } from '../../src/copilot-sdk-wrapper/model-metadata-store';
import { ModelInfo } from '../../src/copilot-sdk-wrapper/model-info';

const makeModel = (id: string, maxContextWindow: number): ModelInfo => ({
    id,
    name: id,
    capabilities: {
        supports: { vision: false, reasoningEffort: false },
        limits: { max_context_window_tokens: maxContextWindow },
    },
});

function resetStore() {
    const s = modelMetadataStore as any;
    s.cache = new Map();
    s.initialized = false;
}

describe('ModelMetadataStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStore();
    });

    it('returns SDK value after successful initialize', async () => {
        mockGetOrThrow.mockReturnValue({
            listModels: vi.fn().mockResolvedValue([makeModel('model-x', 300_000)]),
        });

        await modelMetadataStore.initialize();

        expect(modelMetadataStore.getContextWindow('model-x')).toBe(300_000);
    });

    it('returns cached model metadata by ID', async () => {
        const metadata = makeModel('model-x', 300_000);
        mockGetOrThrow.mockReturnValue({
            listModels: vi.fn().mockResolvedValue([metadata]),
        });

        await modelMetadataStore.initialize();

        expect(modelMetadataStore.getModel('model-x')).toBe(metadata);
        expect(modelMetadataStore.getModel('missing-model')).toBeUndefined();
    });

    it('falls back to static registry when model not in SDK', async () => {
        mockGetOrThrow.mockReturnValue({
            listModels: vi.fn().mockResolvedValue([]),
        });

        await modelMetadataStore.initialize();

        expect(modelMetadataStore.getContextWindow('claude-sonnet-4.6')).toBe(200_000);
    });

    it('falls back to static registry when SDK throws', async () => {
        mockGetOrThrow.mockReturnValue({
            listModels: vi.fn().mockRejectedValue(new Error('SDK unavailable')),
        });

        await modelMetadataStore.initialize();

        expect(modelMetadataStore.getContextWindow('claude-haiku-4.5')).toBe(200_000);
    });

    it('returns undefined for unknown model with no SDK data', async () => {
        mockGetOrThrow.mockReturnValue({
            listModels: vi.fn().mockRejectedValue(new Error('SDK unavailable')),
        });

        await modelMetadataStore.initialize();

        expect(modelMetadataStore.getContextWindow('unknown-model')).toBeUndefined();
    });

    it('isInitialized() false before initialize(), true after success', async () => {
        mockGetOrThrow.mockReturnValue({
            listModels: vi.fn().mockResolvedValue([]),
        });

        expect(modelMetadataStore.isInitialized()).toBe(false);
        await modelMetadataStore.initialize();
        expect(modelMetadataStore.isInitialized()).toBe(true);
    });

    it('isInitialized() stays false after SDK failure', async () => {
        mockGetOrThrow.mockReturnValue({
            listModels: vi.fn().mockRejectedValue(new Error('SDK unavailable')),
        });

        await modelMetadataStore.initialize();

        expect(modelMetadataStore.isInitialized()).toBe(false);
    });

    it('getCachedModels() returns all fetched models', async () => {
        const models = [makeModel('model-a', 100_000), makeModel('model-b', 200_000)];
        mockGetOrThrow.mockReturnValue({
            listModels: vi.fn().mockResolvedValue(models),
        });

        await modelMetadataStore.initialize();

        const cached = modelMetadataStore.getCachedModels();
        expect(cached).toHaveLength(2);
        expect(cached.map(m => m.id)).toContain('model-a');
        expect(cached.map(m => m.id)).toContain('model-b');
    });

    it('re-initialize() refreshes the cache', async () => {
        const listModels = vi.fn()
            .mockResolvedValueOnce([makeModel('model-a', 100_000)])
            .mockResolvedValueOnce([makeModel('model-b', 200_000)]);
        mockGetOrThrow.mockReturnValue({ listModels });

        await modelMetadataStore.initialize();
        expect(modelMetadataStore.getContextWindow('model-a')).toBe(100_000);
        expect(modelMetadataStore.getContextWindow('model-b')).toBeUndefined();

        await modelMetadataStore.initialize();
        expect(modelMetadataStore.getContextWindow('model-b')).toBe(200_000);
        expect(modelMetadataStore.getContextWindow('model-a')).toBeUndefined();
    });
});

