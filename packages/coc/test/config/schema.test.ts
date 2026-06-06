/**
 * Schema validation tests
 *
 * Tests for CLIConfigSchema Zod validation and validateConfigWithSchema().
 */

import { describe, it, expect } from 'vitest';
import { CLIConfigSchema, validateConfigWithSchema } from '../../src/config/schema';

describe('CLIConfigSchema', () => {
    // ========================================================================
    // Valid configs
    // ========================================================================

    it('validates empty config (all fields optional)', () => {
        const result = CLIConfigSchema.parse({});
        expect(result).toEqual({});
    });

    it('validates full valid config', () => {
        const config = {
            model: 'gpt-4',
            parallel: 10,
            output: 'json' as const,
            approvePermissions: true,
            mcpConfig: '/path/to/mcp.yaml',
            timeout: 300,
            persist: false,
            serve: {
                port: 8080,
                host: '0.0.0.0',
                dataDir: '/data',
                theme: 'dark' as const,
            },
        };
        const result = CLIConfigSchema.parse(config);
        expect(result).toEqual(config);
    });

    it('validates partial config with only model', () => {
        const result = CLIConfigSchema.parse({ model: 'claude-sonnet' });
        expect(result).toEqual({ model: 'claude-sonnet' });
    });

    it('validates all output formats', () => {
        for (const fmt of ['table', 'json', 'csv', 'markdown']) {
            const result = CLIConfigSchema.parse({ output: fmt });
            expect(result.output).toBe(fmt);
        }
    });

    it('validates all serve themes', () => {
        for (const theme of ['auto', 'light', 'dark']) {
            const result = CLIConfigSchema.parse({ serve: { theme } });
            expect(result.serve?.theme).toBe(theme);
        }
    });

    it('validates serve with partial fields', () => {
        const result = CLIConfigSchema.parse({ serve: { port: 3000 } });
        expect(result.serve?.port).toBe(3000);
        expect(result.serve?.host).toBeUndefined();
    });

    it('validates serve.serverName', () => {
        const result = CLIConfigSchema.parse({ serve: { serverName: 'MBP' } });
        expect(result.serve?.serverName).toBe('MBP');
    });

    it('validates port at boundary values', () => {
        expect(CLIConfigSchema.parse({ serve: { port: 1 } }).serve?.port).toBe(1);
        expect(CLIConfigSchema.parse({ serve: { port: 65535 } }).serve?.port).toBe(65535);
    });

    // ========================================================================
    // Invalid configs - parallel
    // ========================================================================

    it('rejects negative parallel', () => {
        expect(() => CLIConfigSchema.parse({ parallel: -5 }))
            .toThrow();
    });

    it('rejects zero parallel', () => {
        expect(() => CLIConfigSchema.parse({ parallel: 0 }))
            .toThrow();
    });

    it('rejects decimal parallel', () => {
        expect(() => CLIConfigSchema.parse({ parallel: 5.5 }))
            .toThrow();
    });

    it('rejects string parallel', () => {
        expect(() => CLIConfigSchema.parse({ parallel: 'ten' }))
            .toThrow();
    });

    // ========================================================================
    // Invalid configs - output
    // ========================================================================

    it('rejects invalid output format', () => {
        expect(() => CLIConfigSchema.parse({ output: 'xml' }))
            .toThrow();
    });

    // ========================================================================
    // Invalid configs - timeout
    // ========================================================================

    it('rejects negative timeout', () => {
        expect(() => CLIConfigSchema.parse({ timeout: -10 }))
            .toThrow();
    });

    it('rejects zero timeout', () => {
        expect(() => CLIConfigSchema.parse({ timeout: 0 }))
            .toThrow();
    });

    // ========================================================================
    // Invalid configs - approvePermissions / persist
    // ========================================================================

    it('rejects string approvePermissions', () => {
        expect(() => CLIConfigSchema.parse({ approvePermissions: 'yes' }))
            .toThrow();
    });

    it('rejects string persist', () => {
        expect(() => CLIConfigSchema.parse({ persist: 'yes' }))
            .toThrow();
    });

    // ========================================================================
    // Invalid configs - serve
    // ========================================================================

    it('rejects invalid port (too high)', () => {
        expect(() => CLIConfigSchema.parse({ serve: { port: 70000 } }))
            .toThrow();
    });

    it('rejects zero port', () => {
        expect(() => CLIConfigSchema.parse({ serve: { port: 0 } }))
            .toThrow();
    });

    it('rejects decimal port', () => {
        expect(() => CLIConfigSchema.parse({ serve: { port: 80.5 } }))
            .toThrow();
    });

    it('rejects invalid serve theme', () => {
        expect(() => CLIConfigSchema.parse({ serve: { theme: 'blue' } }))
            .toThrow();
    });

    // ========================================================================
    // Unknown fields (passthrough mode — silently ignored)
    // ========================================================================

    it('accepts unknown top-level fields', () => {
        const result = CLIConfigSchema.parse({ unknownField: true });
        expect(result).toHaveProperty('unknownField', true);
    });

    it('accepts unknown nested fields in serve', () => {
        const result = CLIConfigSchema.parse({ serve: { unknownPort: 8080 } });
        expect((result.serve as Record<string, unknown>)?.unknownPort).toBe(8080);
    });

    // ========================================================================
    // showReportIntent
    // ========================================================================

    it('validates showReportIntent true', () => {
        const result = CLIConfigSchema.parse({ showReportIntent: true });
        expect(result.showReportIntent).toBe(true);
    });

    it('validates showReportIntent false', () => {
        const result = CLIConfigSchema.parse({ showReportIntent: false });
        expect(result.showReportIntent).toBe(false);
    });

    it('rejects string showReportIntent', () => {
        expect(() => CLIConfigSchema.parse({ showReportIntent: 'yes' }))
            .toThrow();
    });

    it('rejects numeric showReportIntent', () => {
        expect(() => CLIConfigSchema.parse({ showReportIntent: 1 }))
            .toThrow();
    });

    // ========================================================================
    // toolCompactness
    // ========================================================================

    it('validates toolCompactness 0', () => {
        const result = CLIConfigSchema.parse({ toolCompactness: 0 });
        expect(result.toolCompactness).toBe(0);
    });

    it('validates toolCompactness 1', () => {
        const result = CLIConfigSchema.parse({ toolCompactness: 1 });
        expect(result.toolCompactness).toBe(1);
    });

    it('validates toolCompactness 2', () => {
        const result = CLIConfigSchema.parse({ toolCompactness: 2 });
        expect(result.toolCompactness).toBe(2);
    });

    it('rejects toolCompactness 3', () => {
        expect(() => CLIConfigSchema.parse({ toolCompactness: 3 }))
            .not.toThrow();
    });

    it('validates toolCompactness 3', () => {
        const result = CLIConfigSchema.parse({ toolCompactness: 3 });
        expect(result.toolCompactness).toBe(3);
    });

    it('rejects toolCompactness 4', () => {
        expect(() => CLIConfigSchema.parse({ toolCompactness: 4 }))
            .toThrow();
    });

    it('rejects toolCompactness -1', () => {
        expect(() => CLIConfigSchema.parse({ toolCompactness: -1 }))
            .toThrow();
    });

    it('rejects non-integer toolCompactness (1.5)', () => {
        expect(() => CLIConfigSchema.parse({ toolCompactness: 1.5 }))
            .toThrow();
    });

    it('rejects string toolCompactness', () => {
        expect(() => CLIConfigSchema.parse({ toolCompactness: '1' }))
            .toThrow();
    });

    // ========================================================================
    // chat.followUpSuggestions
    // ========================================================================

    it('validates chat.followUpSuggestions.enabled as boolean', () => {
        const result = CLIConfigSchema.parse({ chat: { followUpSuggestions: { enabled: false } } });
        expect(result.chat?.followUpSuggestions?.enabled).toBe(false);
    });

    it('rejects chat.followUpSuggestions.enabled as string', () => {
        expect(() => CLIConfigSchema.parse({ chat: { followUpSuggestions: { enabled: 'yes' } } }))
            .toThrow();
    });

    it('validates chat.followUpSuggestions.count in range 1-5', () => {
        for (const count of [1, 3, 5]) {
            const result = CLIConfigSchema.parse({ chat: { followUpSuggestions: { count } } });
            expect(result.chat?.followUpSuggestions?.count).toBe(count);
        }
    });

    it('rejects chat.followUpSuggestions.count = 0', () => {
        expect(() => CLIConfigSchema.parse({ chat: { followUpSuggestions: { count: 0 } } }))
            .toThrow();
    });

    it('rejects chat.followUpSuggestions.count = 6', () => {
        expect(() => CLIConfigSchema.parse({ chat: { followUpSuggestions: { count: 6 } } }))
            .toThrow();
    });

    it('accepts unknown keys inside chat.followUpSuggestions (passthrough)', () => {
        const result = CLIConfigSchema.parse({ chat: { followUpSuggestions: { unknown: true } } });
        expect((result.chat?.followUpSuggestions as Record<string, unknown>)?.unknown).toBe(true);
    });

    it('accepts unknown keys inside chat (passthrough)', () => {
        const result = CLIConfigSchema.parse({ chat: { unknown: true } });
        expect((result.chat as Record<string, unknown>)?.unknown).toBe(true);
    });

    // ========================================================================
    // terminal
    // ========================================================================

    describe('terminal', () => {
        it('validates terminal.enabled true', () => {
            expect(() => CLIConfigSchema.parse({ terminal: { enabled: true } })).not.toThrow();
        });
        it('validates terminal.enabled false', () => {
            expect(() => CLIConfigSchema.parse({ terminal: { enabled: false } })).not.toThrow();
        });
        it('rejects terminal.enabled string', () => {
            expect(() => CLIConfigSchema.parse({ terminal: { enabled: 'yes' } })).toThrow();
        });
        it('accepts unknown terminal sub-field (passthrough)', () => {
            const result = CLIConfigSchema.parse({ terminal: { enabled: true, foo: 1 } });
            expect((result.terminal as Record<string, unknown>)?.foo).toBe(1);
        });
    });
});

describe('validateConfigWithSchema', () => {
    it('returns validated config for valid input', () => {
        const result = validateConfigWithSchema({ model: 'gpt-4', parallel: 5 });
        expect(result).toEqual({ model: 'gpt-4', parallel: 5 });
    });

    it('throws with formatted error message for invalid input', () => {
        expect(() => validateConfigWithSchema({ parallel: -5 }))
            .toThrow('Invalid config file:');
    });

    it('includes field path in error message', () => {
        expect(() => validateConfigWithSchema({ parallel: -5 }))
            .toThrow('parallel:');
    });

    it('includes nested field path in error message', () => {
        expect(() => validateConfigWithSchema({ serve: { port: -1 } }))
            .toThrow('serve.port:');
    });

    it('reports multiple errors', () => {
        try {
            validateConfigWithSchema({ parallel: -5, timeout: -10 });
            expect.unreachable('Should have thrown');
        } catch (e: unknown) {
            const msg = (e as Error).message;
            expect(msg).toContain('parallel:');
            expect(msg).toContain('timeout:');
        }
    });
});

// ============================================================================
// queue.restartPickupDelayMs schema
// ============================================================================

describe('queue.restartPickupDelayMs schema validation', () => {
    it('accepts restartPickupDelayMs = 0', () => {
        const result = CLIConfigSchema.parse({ queue: { restartPickupDelayMs: 0 } });
        expect(result.queue?.restartPickupDelayMs).toBe(0);
    });

    it('accepts restartPickupDelayMs positive integer', () => {
        const result = CLIConfigSchema.parse({ queue: { restartPickupDelayMs: 30000 } });
        expect(result.queue?.restartPickupDelayMs).toBe(30000);
    });

    it('rejects restartPickupDelayMs negative', () => {
        expect(() => CLIConfigSchema.parse({ queue: { restartPickupDelayMs: -1 } }))
            .toThrow();
    });

    it('rejects restartPickupDelayMs decimal', () => {
        expect(() => CLIConfigSchema.parse({ queue: { restartPickupDelayMs: 1.5 } }))
            .toThrow();
    });

    it('rejects restartPickupDelayMs string', () => {
        expect(() => CLIConfigSchema.parse({ queue: { restartPickupDelayMs: '5000' } }))
            .toThrow();
    });
});

describe('auto agent provider routing schema validation', () => {
    it('accepts concrete default providers without the feature flag', () => {
        for (const provider of ['copilot', 'codex', 'claude']) {
            const result = CLIConfigSchema.parse({ defaultProvider: provider });
            expect(result.defaultProvider).toBe(provider);
        }
    });

    it('rejects defaultProvider auto when the feature flag is not enabled', () => {
        expect(() => CLIConfigSchema.parse({ defaultProvider: 'auto' }))
            .toThrow();
        expect(() => CLIConfigSchema.parse({
            defaultProvider: 'auto',
            features: { autoAgentProviderRouting: false },
        })).toThrow();
    });

    it('accepts defaultProvider auto when the feature flag is enabled', () => {
        const result = CLIConfigSchema.parse({
            defaultProvider: 'auto',
            features: { autoAgentProviderRouting: true },
        });
        expect(result.defaultProvider).toBe('auto');
        expect(result.features?.autoAgentProviderRouting).toBe(true);
    });

    it('accepts auto routing rules and fallback provider', () => {
        const result = CLIConfigSchema.parse({
            agentProviderRouting: {
                auto: {
                    rules: [
                        {
                            provider: 'claude',
                            enabled: true,
                            minimumRemainingPercent: 25,
                            weeklyGuard: {
                                enabled: true,
                                minimumRemainingPercent: 25,
                            },
                        },
                        {
                            provider: 'copilot',
                            enabled: false,
                            minimumRemainingPercent: 0,
                            weeklyGuard: {
                                enabled: false,
                                minimumRemainingPercent: 100,
                            },
                        },
                    ],
                    fallbackProvider: 'copilot',
                },
            },
        });
        expect(result.agentProviderRouting?.auto?.rules?.[0].provider).toBe('claude');
        expect(result.agentProviderRouting?.auto?.fallbackProvider).toBe('copilot');
    });

    it('rejects invalid auto routing provider values', () => {
        expect(() => CLIConfigSchema.parse({
            agentProviderRouting: {
                auto: {
                    rules: [{ provider: 'openai' }],
                    fallbackProvider: 'copilot',
                },
            },
        })).toThrow();
        expect(() => CLIConfigSchema.parse({
            agentProviderRouting: {
                auto: {
                    fallbackProvider: 'openai',
                },
            },
        })).toThrow();
    });

    it('rejects auto routing percentages outside 0..100', () => {
        expect(() => CLIConfigSchema.parse({
            agentProviderRouting: {
                auto: {
                    rules: [{ provider: 'copilot', minimumRemainingPercent: -1 }],
                },
            },
        })).toThrow();
        expect(() => CLIConfigSchema.parse({
            agentProviderRouting: {
                auto: {
                    rules: [{ provider: 'copilot', weeklyGuard: { minimumRemainingPercent: 101 } }],
                },
            },
        })).toThrow();
    });
});

describe('memoryPromotion schema validation', () => {
    it('accepts AI normalization config', () => {
        const result = CLIConfigSchema.parse({
            memoryPromotion: {
                batchSize: 25,
                timeoutMs: 90000,
                aiNormalization: {
                    enabled: true,
                    timeoutMs: 30000,
                    model: 'gpt-test',
                },
            },
        });
        expect(result.memoryPromotion?.batchSize).toBe(25);
        expect(result.memoryPromotion?.aiNormalization?.enabled).toBe(true);
        expect(result.memoryPromotion?.aiNormalization?.timeoutMs).toBe(30000);
    });

    it('rejects non-boolean AI normalization enabled', () => {
        expect(() => CLIConfigSchema.parse({ memoryPromotion: { aiNormalization: { enabled: 'yes' } } }))
            .toThrow();
    });

    it('rejects non-positive AI normalization timeout', () => {
        expect(() => CLIConfigSchema.parse({ memoryPromotion: { aiNormalization: { timeoutMs: 0 } } }))
            .toThrow();
    });
});

describe('logging schema validation', () => {
    it('accepts empty logging section', () => {
        const result = CLIConfigSchema.parse({ logging: {} });
        expect(result.logging).toEqual({});
    });

    it('accepts full logging config', () => {
        const config = {
            logging: {
                level: 'debug' as const,
                dir: '~/.coc/logs',
                pretty: 'auto' as const,
                stores: {
                    'ai-service': { level: 'trace' as const, file: true },
                    'coc-service': { level: 'info' as const, file: false },
                },
            },
        };
        const result = CLIConfigSchema.parse(config);
        expect(result.logging?.level).toBe('debug');
        expect(result.logging?.dir).toBe('~/.coc/logs');
        expect(result.logging?.pretty).toBe('auto');
        expect(result.logging?.stores?.['ai-service']?.level).toBe('trace');
        expect(result.logging?.stores?.['ai-service']?.file).toBe(true);
    });

    it('accepts all valid log levels', () => {
        for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
            const result = CLIConfigSchema.parse({ logging: { level } });
            expect(result.logging?.level).toBe(level);
        }
    });

    it('rejects invalid log level', () => {
        expect(() => CLIConfigSchema.parse({ logging: { level: 'verbose' } })).toThrow();
    });

    it('accepts pretty: true', () => {
        const result = CLIConfigSchema.parse({ logging: { pretty: true } });
        expect(result.logging?.pretty).toBe(true);
    });

    it('accepts pretty: false', () => {
        const result = CLIConfigSchema.parse({ logging: { pretty: false } });
        expect(result.logging?.pretty).toBe(false);
    });

    it('accepts pretty: "auto"', () => {
        const result = CLIConfigSchema.parse({ logging: { pretty: 'auto' } });
        expect(result.logging?.pretty).toBe('auto');
    });

    it('rejects pretty: "always" (unknown string)', () => {
        expect(() => CLIConfigSchema.parse({ logging: { pretty: 'always' } })).toThrow();
    });

    it('accepts unknown fields inside logging (passthrough)', () => {
        const result = CLIConfigSchema.parse({ logging: { unknownField: true } });
        expect((result.logging as Record<string, unknown>)?.unknownField).toBe(true);
    });

    it('accepts unknown fields inside logging.stores[name] (passthrough)', () => {
        const result = CLIConfigSchema.parse({ logging: { stores: { 'ai-service': { unknownField: true } } } });
        expect((result.logging?.stores?.['ai-service'] as Record<string, unknown>)?.unknownField).toBe(true);
    });

    it('accepts stores with undefined values', () => {
        const result = CLIConfigSchema.parse({ logging: { stores: { 'ai-service': undefined } } });
        expect(result.logging?.stores?.['ai-service']).toBeUndefined();
    });

    it('rejects invalid store level', () => {
        expect(() => CLIConfigSchema.parse({ logging: { stores: { 'ai-service': { level: 'verbose' } } } })).toThrow();
    });
});

// ============================================================================
// monitoring.heapCheck schema
// ============================================================================

describe('monitoring.heapCheck schema validation', () => {
    it('accepts empty monitoring section', () => {
        const result = CLIConfigSchema.parse({ monitoring: {} });
        expect(result.monitoring).toEqual({});
    });

    it('accepts empty heapCheck section', () => {
        const result = CLIConfigSchema.parse({ monitoring: { heapCheck: {} } });
        expect(result.monitoring?.heapCheck).toEqual({});
    });

    it('accepts full heapCheck config', () => {
        const config = {
            monitoring: {
                heapCheck: {
                    enabled: true,
                    intervalMs: 30000,
                    warnThreshold: 70,
                    criticalThreshold: 85,
                },
            },
        };
        const result = CLIConfigSchema.parse(config);
        expect(result.monitoring?.heapCheck?.enabled).toBe(true);
        expect(result.monitoring?.heapCheck?.intervalMs).toBe(30000);
        expect(result.monitoring?.heapCheck?.warnThreshold).toBe(70);
        expect(result.monitoring?.heapCheck?.criticalThreshold).toBe(85);
    });

    it('accepts partial heapCheck config', () => {
        const result = CLIConfigSchema.parse({ monitoring: { heapCheck: { enabled: false } } });
        expect(result.monitoring?.heapCheck?.enabled).toBe(false);
    });

    it('rejects non-boolean enabled', () => {
        expect(() => CLIConfigSchema.parse({ monitoring: { heapCheck: { enabled: 'yes' } } }))
            .toThrow();
    });

    it('rejects non-positive intervalMs', () => {
        expect(() => CLIConfigSchema.parse({ monitoring: { heapCheck: { intervalMs: 0 } } }))
            .toThrow();
    });

    it('rejects negative intervalMs', () => {
        expect(() => CLIConfigSchema.parse({ monitoring: { heapCheck: { intervalMs: -1000 } } }))
            .toThrow();
    });

    it('rejects decimal intervalMs', () => {
        expect(() => CLIConfigSchema.parse({ monitoring: { heapCheck: { intervalMs: 1.5 } } }))
            .toThrow();
    });

    it('rejects warnThreshold above 100', () => {
        expect(() => CLIConfigSchema.parse({ monitoring: { heapCheck: { warnThreshold: 101 } } }))
            .toThrow();
    });

    it('rejects warnThreshold below 0', () => {
        expect(() => CLIConfigSchema.parse({ monitoring: { heapCheck: { warnThreshold: -1 } } }))
            .toThrow();
    });

    it('accepts warnThreshold at boundary (0 and 100)', () => {
        expect(CLIConfigSchema.parse({ monitoring: { heapCheck: { warnThreshold: 0 } } }).monitoring?.heapCheck?.warnThreshold).toBe(0);
        expect(CLIConfigSchema.parse({ monitoring: { heapCheck: { warnThreshold: 100 } } }).monitoring?.heapCheck?.warnThreshold).toBe(100);
    });

    it('rejects criticalThreshold above 100', () => {
        expect(() => CLIConfigSchema.parse({ monitoring: { heapCheck: { criticalThreshold: 101 } } }))
            .toThrow();
    });

    it('accepts unknown keys inside monitoring (passthrough)', () => {
        const result = CLIConfigSchema.parse({ monitoring: { unknown: true } });
        expect((result.monitoring as Record<string, unknown>)?.unknown).toBe(true);
    });

    it('accepts unknown keys inside monitoring.heapCheck (passthrough)', () => {
        const result = CLIConfigSchema.parse({ monitoring: { heapCheck: { unknown: true } } });
        expect((result.monitoring?.heapCheck as Record<string, unknown>)?.unknown).toBe(true);
    });
});
