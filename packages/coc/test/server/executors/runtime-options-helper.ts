/**
 * Test helper: flat → nested executor options.
 *
 * Late-bound executor capabilities live in one `runtime` object
 * (`ExecutorRuntimeCapabilities`) rather than as individual option fields.
 * Most test helpers build a flat option bag and spread caller overrides into
 * it, so this adapter moves any capability keys found at the top level into
 * `runtime`, merging with an explicit `runtime` when both are present.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

/** Every key that belongs to the runtime capability contract. */
export const RUNTIME_CAPABILITY_KEYS = [
    'getWsServer',
    'getCronInfra',
    'getTriggerInfra',
    'getEnqueueChat',
    'getSendMessage',
    'getSendToConversationRuntime',
    'getMcpOauthManager',
    'getTurnPerformanceStore',
    'getGlobalSystemPrompt',
    'getChatStyleSelectorEnabled',
    'getDefaultChatStyle',
    'resolveAiServiceForProvider',
    'getDreamRunExecutor',
    'processAbortControllers',
] as const;

/**
 * Move any top-level capability keys of `opts` into `opts.runtime`.
 * Keys already present in an explicit `runtime` win over the flat form.
 */
export function nestRuntime<T extends Record<string, unknown>>(opts: T): T {
    const rest: Record<string, unknown> = {};
    const capabilities: Record<string, unknown> = {};
    const keys = new Set<string>(RUNTIME_CAPABILITY_KEYS);

    for (const [key, value] of Object.entries(opts)) {
        if (key === 'runtime') continue;
        if (keys.has(key)) {
            capabilities[key] = value;
        } else {
            rest[key] = value;
        }
    }

    return {
        ...rest,
        runtime: { ...capabilities, ...(opts.runtime as Record<string, unknown> | undefined) },
    } as unknown as T;
}

/**
 * Loose override shape for helpers that accept capability keys in either the
 * flat or the nested form.
 */
export type FlatExecutorOptions = Record<string, any>;
