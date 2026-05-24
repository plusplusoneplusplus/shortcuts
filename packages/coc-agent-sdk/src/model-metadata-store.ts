import { ModelInfo } from './model-info';
import { sdkServiceRegistry, SDK_PROVIDER_COPILOT } from './sdk-service-registry';
import { getModelContextWindow } from './model-registry';
import { getSDKLogger } from './logger';

class ModelMetadataStore {
    private cache: Map<string, ModelInfo> = new Map();
    private initialized = false;

    /**
     * Fetch models from the SDK and populate the cache.
     * Safe to call multiple times; re-fetches on every call to allow refresh.
     * Never throws — SDK errors are caught and logged; the cache is left as-is.
     * @param aiService Optional SDK service instance; falls back to sdkServiceRegistry.getOrThrow(SDK_PROVIDER_COPILOT).
     */
    async initialize(aiService?: { listModels(): Promise<ModelInfo[]> }): Promise<void> {
        try {
            const service = aiService ?? sdkServiceRegistry.getOrThrow(SDK_PROVIDER_COPILOT);
            const models = await service.listModels() as unknown as ModelInfo[];
            this.cache.clear();
            for (const model of models) {
                this.cache.set(model.id, model);
            }
            this.initialized = true;
        } catch (err) {
            getSDKLogger().warn(
                { store: 'ModelMetadataStore' },
                `Failed to fetch models from SDK; falling back to static registry. ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    /**
     * Context window for modelId.
     * Fallback chain: SDK cache → static registry → undefined.
     */
    getContextWindow(modelId: string): number | undefined {
        const info = this.cache.get(modelId);
        if (info?.capabilities?.limits?.max_context_window_tokens !== undefined) {
            return info.capabilities.limits.max_context_window_tokens;
        }
        return getModelContextWindow(modelId);
    }

    /**
     * Cached SDK metadata for modelId. Undefined until initialize() has fetched
     * this model, or when the SDK cannot provide metadata for it.
     */
    getModel(modelId: string): ModelInfo | undefined {
        return this.cache.get(modelId);
    }

    /**
     * All cached ModelInfo entries. Empty until initialize() resolves.
     */
    getCachedModels(): ModelInfo[] {
        return [...this.cache.values()];
    }

    /**
     * All cached ModelInfo entries. Alias for getCachedModels().
     * Empty until initialize() resolves.
     */
    getAll(): ModelInfo[] {
        return this.getCachedModels();
    }

    /** True after at least one successful initialize() call. */
    isInitialized(): boolean {
        return this.initialized;
    }
}

export const modelMetadataStore = new ModelMetadataStore();
