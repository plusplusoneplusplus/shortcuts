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
    // Unknown fields (strict mode)
    // ========================================================================

    it('rejects unknown top-level fields', () => {
        expect(() => CLIConfigSchema.parse({ unknownField: true }))
            .toThrow();
    });

    it('rejects unknown nested fields in serve', () => {
        expect(() => CLIConfigSchema.parse({ serve: { unknownPort: 8080 } }))
            .toThrow();
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
