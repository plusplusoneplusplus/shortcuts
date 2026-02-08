/**
 * CLI Tests
 *
 * Tests for the CLI argument parser and program creation.
 */

import { describe, it, expect } from 'vitest';
import { createProgram, EXIT_CODES } from '../src/cli';

describe('CLI', () => {
    // ========================================================================
    // Exit Codes
    // ========================================================================

    describe('EXIT_CODES', () => {
        it('should define SUCCESS as 0', () => {
            expect(EXIT_CODES.SUCCESS).toBe(0);
        });

        it('should define EXECUTION_ERROR as 1', () => {
            expect(EXIT_CODES.EXECUTION_ERROR).toBe(1);
        });

        it('should define CONFIG_ERROR as 2', () => {
            expect(EXIT_CODES.CONFIG_ERROR).toBe(2);
        });

        it('should define AI_UNAVAILABLE as 3', () => {
            expect(EXIT_CODES.AI_UNAVAILABLE).toBe(3);
        });

        it('should define CANCELLED as 130', () => {
            expect(EXIT_CODES.CANCELLED).toBe(130);
        });

        it('should have all exit codes as numbers', () => {
            for (const [, value] of Object.entries(EXIT_CODES)) {
                expect(typeof value).toBe('number');
            }
        });
    });

    // ========================================================================
    // Program Creation
    // ========================================================================

    describe('createProgram', () => {
        it('should create a program', () => {
            const program = createProgram();
            expect(program).toBeDefined();
        });

        it('should have the correct name', () => {
            const program = createProgram();
            expect(program.name()).toBe('deep-wiki');
        });

        it('should have version', () => {
            const program = createProgram();
            expect(program.version()).toBe('1.0.0');
        });

        it('should have discover command', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'discover');
            expect(cmd).toBeDefined();
        });

        it('should have generate command', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'generate');
            expect(cmd).toBeDefined();
        });
    });

    // ========================================================================
    // Discover Command Options
    // ========================================================================

    describe('discover command', () => {
        it('should accept a repo-path argument', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'discover')!;
            expect(cmd).toBeDefined();
            // Commander stores arguments in registeredArguments or _args
            const args = (cmd as any).registeredArguments || (cmd as any)._args;
            expect(args?.length).toBeGreaterThan(0);
        });

        it('should have expected options', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'discover')!;
            const optionNames = cmd.options.map(o => o.long || o.short);

            expect(optionNames).toContain('--output');
            expect(optionNames).toContain('--model');
            expect(optionNames).toContain('--timeout');
            expect(optionNames).toContain('--focus');
            expect(optionNames).toContain('--force');
            expect(optionNames).toContain('--use-cache');
            expect(optionNames).toContain('--verbose');
        });

        it('should have default value for output', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'discover')!;
            const outputOpt = cmd.options.find(o => o.long === '--output');
            expect(outputOpt).toBeDefined();
            expect(outputOpt!.defaultValue).toBe('./wiki');
        });
    });

    // ========================================================================
    // Generate Command Options
    // ========================================================================

    describe('generate command', () => {
        it('should accept a repo-path argument', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'generate')!;
            expect(cmd).toBeDefined();
            const args = (cmd as any).registeredArguments || (cmd as any)._args;
            expect(args?.length).toBeGreaterThan(0);
        });

        it('should have expected options', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'generate')!;
            const optionNames = cmd.options.map(o => o.long || o.short);

            expect(optionNames).toContain('--output');
            expect(optionNames).toContain('--model');
            expect(optionNames).toContain('--concurrency');
            expect(optionNames).toContain('--timeout');
            expect(optionNames).toContain('--focus');
            expect(optionNames).toContain('--depth');
            expect(optionNames).toContain('--force');
            expect(optionNames).toContain('--use-cache');
            expect(optionNames).toContain('--phase');
            expect(optionNames).toContain('--verbose');
        });

        it('should have default values for depth', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'generate')!;
            const depthOpt = cmd.options.find(o => o.long === '--depth');
            expect(depthOpt).toBeDefined();
            expect(depthOpt!.defaultValue).toBe('normal');
        });
    });
});
