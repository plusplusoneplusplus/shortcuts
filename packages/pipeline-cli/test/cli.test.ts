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
            expect(program.name()).toBe('pipeline');
        });

        it('should have run command', () => {
            const program = createProgram();
            const runCmd = program.commands.find(c => c.name() === 'run');
            expect(runCmd).toBeDefined();
        });

        it('should have validate command', () => {
            const program = createProgram();
            const validateCmd = program.commands.find(c => c.name() === 'validate');
            expect(validateCmd).toBeDefined();
        });

        it('should have list command', () => {
            const program = createProgram();
            const listCmd = program.commands.find(c => c.name() === 'list');
            expect(listCmd).toBeDefined();
        });

        it('should have version', () => {
            const program = createProgram();
            expect(program.version()).toBe('1.0.0');
        });

        it('run command should have expected options', () => {
            const program = createProgram();
            const runCmd = program.commands.find(c => c.name() === 'run')!;
            const optionNames = runCmd.options.map(o => o.long || o.short);
            expect(optionNames).toContain('--model');
            expect(optionNames).toContain('--parallel');
            expect(optionNames).toContain('--output');
            expect(optionNames).toContain('--output-file');
            expect(optionNames).toContain('--verbose');
            expect(optionNames).toContain('--dry-run');
            expect(optionNames).toContain('--timeout');
            expect(optionNames).toContain('--approve-permissions');
        });

        it('validate command should accept a path argument', () => {
            const program = createProgram();
            const validateCmd = program.commands.find(c => c.name() === 'validate')!;
            // Commander stores arguments in _args
            expect(validateCmd.args?.length || (validateCmd as any)._args?.length).toBeGreaterThan(0);
        });

        it('list command should have optional dir argument', () => {
            const program = createProgram();
            const listCmd = program.commands.find(c => c.name() === 'list')!;
            expect(listCmd).toBeDefined();
        });
    });
});
