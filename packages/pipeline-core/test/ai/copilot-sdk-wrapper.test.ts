/**
 * Copilot SDK Wrapper Module Tests
 *
 * Verifies that the copilot-sdk-wrapper barrel exports are complete
 * and that all types/functions are accessible from the wrapper module.
 * Also verifies backward compatibility through the ai/ re-exports.
 */

import { describe, it, expect } from 'vitest';

// Import from the wrapper module barrel
import {
    // Types
    DEFAULT_SESSION_POOL_CONFIG,
    approveAllPermissions,
    denyAllPermissions,
    // Model Registry
    AIModel,
    VALID_MODELS,
    DEFAULT_MODEL_ID,
    MODEL_REGISTRY,
    getModelLabel,
    getModelDescription,
    getModelDefinition,
    getAllModels,
    getActiveModels,
    isValidModelId,
    getModelCount,
    getModelsByTier,
    // Session Pool
    SessionPool,
    // SDK Service
    CopilotSDKService,
    getCopilotSDKService,
    resetCopilotSDKService,
    // MCP Config Loader
    getHomeDirectory,
    getMcpConfigPath,
    loadDefaultMcpConfig,
    mergeMcpConfigs,
    clearMcpConfigCache,
    mcpConfigExists,
    getCachedMcpConfig,
    setHomeDirectoryOverride,
    // Trusted Folder
    ensureFolderTrusted,
    isFolderTrusted,
    getCopilotConfigPath,
    setTrustedFolderHomeOverride,
} from '../../src/copilot-sdk-wrapper';

// Import from the ai/ barrel (backward compatibility)
import {
    // These should all be re-exported from copilot-sdk-wrapper
    MCPServerConfig as AiMCPServerConfig,
    SendMessageOptions as AiSendMessageOptions,
    TokenUsage as AiTokenUsage,
    SDKInvocationResult as AiSDKInvocationResult,
    PermissionHandler as AiPermissionHandler,
    SessionPoolConfig as AiSessionPoolConfig,
    approveAllPermissions as aiApproveAll,
    denyAllPermissions as aiDenyAll,
    CopilotSDKService as AiCopilotSDKService,
    getCopilotSDKService as aiGetService,
    resetCopilotSDKService as aiResetService,
    SessionPool as AiSessionPool,
    AIModel as AiAIModel,
    VALID_MODELS as AiVALID_MODELS,
    DEFAULT_MODEL_ID as AiDEFAULT_MODEL_ID,
    MODEL_REGISTRY as AiMODEL_REGISTRY,
    // AI-only types (not from wrapper)
    AIBackendType,
    AIInvocationResult,
    DEFAULT_PROMPTS,
} from '../../src/ai';

describe('Copilot SDK Wrapper Module', () => {
    describe('barrel exports', () => {
        it('should export model registry functions', () => {
            expect(typeof getModelLabel).toBe('function');
            expect(typeof getModelDescription).toBe('function');
            expect(typeof getModelDefinition).toBe('function');
            expect(typeof getAllModels).toBe('function');
            expect(typeof getActiveModels).toBe('function');
            expect(typeof isValidModelId).toBe('function');
            expect(typeof getModelCount).toBe('function');
            expect(typeof getModelsByTier).toBe('function');
        });

        it('should export model constants', () => {
            expect(VALID_MODELS).toBeDefined();
            expect(VALID_MODELS.length).toBeGreaterThan(0);
            expect(DEFAULT_MODEL_ID).toBeDefined();
            expect(MODEL_REGISTRY).toBeDefined();
            expect(MODEL_REGISTRY.size).toBeGreaterThan(0);
        });

        it('should export session pool class', () => {
            expect(SessionPool).toBeDefined();
            expect(typeof SessionPool).toBe('function');
        });

        it('should export SDK service', () => {
            expect(CopilotSDKService).toBeDefined();
            expect(typeof getCopilotSDKService).toBe('function');
            expect(typeof resetCopilotSDKService).toBe('function');
        });

        it('should export MCP config loader functions', () => {
            expect(typeof getHomeDirectory).toBe('function');
            expect(typeof getMcpConfigPath).toBe('function');
            expect(typeof loadDefaultMcpConfig).toBe('function');
            expect(typeof mergeMcpConfigs).toBe('function');
            expect(typeof clearMcpConfigCache).toBe('function');
            expect(typeof mcpConfigExists).toBe('function');
            expect(typeof getCachedMcpConfig).toBe('function');
            expect(typeof setHomeDirectoryOverride).toBe('function');
        });

        it('should export trusted folder functions', () => {
            expect(typeof ensureFolderTrusted).toBe('function');
            expect(typeof isFolderTrusted).toBe('function');
            expect(typeof getCopilotConfigPath).toBe('function');
            expect(typeof setTrustedFolderHomeOverride).toBe('function');
        });

        it('should export permission helpers', () => {
            expect(typeof approveAllPermissions).toBe('function');
            expect(typeof denyAllPermissions).toBe('function');
        });

        it('should export session pool config defaults', () => {
            expect(DEFAULT_SESSION_POOL_CONFIG).toBeDefined();
            expect(DEFAULT_SESSION_POOL_CONFIG.maxSessions).toBe(5);
            expect(DEFAULT_SESSION_POOL_CONFIG.idleTimeoutMs).toBe(300000);
        });
    });

    describe('permission helpers', () => {
        it('approveAllPermissions should return approved', () => {
            const result = approveAllPermissions(
                { kind: 'shell' },
                { sessionId: 'test' }
            );
            expect(result).toEqual({ kind: 'approved' });
        });

        it('denyAllPermissions should return denied-by-rules', () => {
            const result = denyAllPermissions(
                { kind: 'write' },
                { sessionId: 'test' }
            );
            expect(result).toEqual({ kind: 'denied-by-rules' });
        });
    });

    describe('backward compatibility via ai/ barrel', () => {
        it('should re-export the same CopilotSDKService class', () => {
            expect(AiCopilotSDKService).toBe(CopilotSDKService);
        });

        it('should re-export the same permission helpers', () => {
            expect(aiApproveAll).toBe(approveAllPermissions);
            expect(aiDenyAll).toBe(denyAllPermissions);
        });

        it('should re-export the same convenience functions', () => {
            expect(aiGetService).toBe(getCopilotSDKService);
            expect(aiResetService).toBe(resetCopilotSDKService);
        });

        it('should re-export the same SessionPool class', () => {
            expect(AiSessionPool).toBe(SessionPool);
        });

        it('should re-export model constants', () => {
            expect(AiVALID_MODELS).toBe(VALID_MODELS);
            expect(AiDEFAULT_MODEL_ID).toBe(DEFAULT_MODEL_ID);
            expect(AiMODEL_REGISTRY).toBe(MODEL_REGISTRY);
        });

        it('should still export AI-specific types from ai/', () => {
            // These are not part of the wrapper — they stay in ai/
            expect(DEFAULT_PROMPTS).toBeDefined();
            expect(DEFAULT_PROMPTS.clarify).toBeDefined();
            expect(DEFAULT_PROMPTS.goDeeper).toBeDefined();
        });
    });
});
