/**
 * ModelMetadataStore Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setLogger, nullLogger } from '../../src/logger';

setLogger(nullLogger);

// Mock getCopilotSDKService before importing the store
vi.mock('../../src/copilot-sdk-wrapper/copilot-sdk-service', () => ({
    getCopilotSDKService: vi.fn(),
}));

import { getCopilotSDKService } from '../../src/copilot-sdk-wrapper/copilot-sdk-service';
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

const mockGetService = getCopilotSDKService as ReturnType<typeof vi.fn>;

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
        mockGetService.mockReturnValue({
            listModels: vi.fn().mockResolvedValue([makeModel('model-x', 300_000)]),
        });

        await modelMetadataStore.initialize();

        expect(modelMetadataStore.getContextWindow('model-x')).toBe(300_000);
    });

    it('falls back to static registry when model not in SDK', async () => {
        mockGetService.mockReturnValue({
            listModels: vi.fn().mockResolvedValue([]),
        });

        await modelMetadataStore.initialize();

        expect(modelMetadataStore.getContextWindow('claude-sonnet-4.6')).toBe(200_000);
    });

    it('falls back to static registry when SDK throws', async () => {
        mockGetService.mockReturnValue({
            listModels: vi.fn().mockRejectedValue(new Error('SDK unavailable')),
        });

        await modelMetadataStore.initialize();

        expect(modelMetadataStore.getContextWindow('claude-haiku-4.5')).toBe(200_000);
    });

    it('returns undefined for unknown model with no SDK data', async () => {
        mockGetService.mockReturnValue({
            listModels: vi.fn().mockRejectedValue(new Error('SDK unavailable')),
        });

        await modelMetadataStore.initialize();

        expect(modelMetadataStore.getContextWindow('unknown-model')).toBeUndefined();
    });

    it('isInitialized() false before initialize(), true after success', async () => {
        mockGetService.mockReturnValue({
            listModels: vi.fn().mockResolvedValue([]),
        });

        expect(modelMetadataStore.isInitialized()).toBe(false);
        await modelMetadataStore.initialize();
        expect(modelMetadataStore.isInitialized()).toBe(true);
    });

    it('isInitialized() stays false after SDK failure', async () => {
        mockGetService.mockReturnValue({
            listModels: vi.fn().mockRejectedValue(new Error('SDK unavailable')),
        });

        await modelMetadataStore.initialize();

        expect(modelMetadataStore.isInitialized()).toBe(false);
    });

    it('getCachedModels() returns all fetched models', async () => {
        const models = [makeModel('model-a', 100_000), makeModel('model-b', 200_000)];
        mockGetService.mockReturnValue({
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
        mockGetService.mockReturnValue({ listModels });

        await modelMetadataStore.initialize();
        expect(modelMetadataStore.getContextWindow('model-a')).toBe(100_000);
        expect(modelMetadataStore.getContextWindow('model-b')).toBeUndefined();

        await modelMetadataStore.initialize();
        expect(modelMetadataStore.getContextWindow('model-b')).toBe(200_000);
        expect(modelMetadataStore.getContextWindow('model-a')).toBeUndefined();
    });
});

