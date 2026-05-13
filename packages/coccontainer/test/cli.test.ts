/**
 * Tests for CLI setup.
 */

import { describe, it, expect } from 'vitest';
import { createProgram } from '../src/cli';

describe('CLI', () => {
    it('should create a program with expected commands', () => {
        const program = createProgram();
        expect(program.name()).toBe('coccontainer');

        const commandNames = program.commands.map(c => c.name());
        expect(commandNames).toContain('agent');
        expect(commandNames).toContain('serve');
        expect(commandNames).toContain('status');
        expect(commandNames).toContain('run');
        expect(commandNames).toContain('list');
        expect(commandNames).toContain('validate');
    });

    it('should have agent subcommands', () => {
        const program = createProgram();
        const agentCmd = program.commands.find(c => c.name() === 'agent');
        expect(agentCmd).toBeDefined();

        const subcommands = agentCmd!.commands.map(c => c.name());
        expect(subcommands).toContain('add');
        expect(subcommands).toContain('remove');
        expect(subcommands).toContain('list');
    });
});
