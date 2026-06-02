/**
 * CoCContainer CLI
 *
 * Commander setup for the coccontainer CLI.
 * Routes commands to handlers for agent management, serve, and proxied operations.
 */

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { join } from 'path';

const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

export const EXIT_CODES = {
    SUCCESS: 0,
    EXECUTION_ERROR: 1,
    CONFIG_ERROR: 2,
    AGENT_UNAVAILABLE: 3,
    CANCELLED: 130,
} as const;

export function createProgram(): Command {
    const program = new Command();

    program
        .name('coccontainer')
        .description('CoCContainer - Multi-agent CoC aggregation dashboard and CLI proxy')
        .version(pkg.version);

    // ========================================================================
    // agent subcommand
    // ========================================================================
    const agentCmd = program
        .command('agent')
        .description('Manage CoC agents');

    agentCmd
        .command('add <address>')
        .description('Register a CoC agent by its URL (e.g. http://localhost:4000)')
        .option('-n, --name <name>', 'Friendly name for the agent')
        .action(async (address: string, opts: { name?: string }) => {
            const { executeAgentAdd } = await import('./commands/agent');
            await executeAgentAdd(address, opts);
        });

    agentCmd
        .command('remove <id>')
        .description('Remove a registered agent by ID or name')
        .action(async (id: string) => {
            const { executeAgentRemove } = await import('./commands/agent');
            await executeAgentRemove(id);
        });

    agentCmd
        .command('list')
        .description('List all registered agents')
        .option('-o, --output <fmt>', 'Output format: table, json', 'table')
        .action(async (opts: { output: string }) => {
            const { executeAgentList } = await import('./commands/agent');
            await executeAgentList(opts);
        });

    // ========================================================================
    // serve
    // ========================================================================
    program
        .command('serve')
        .description('Start the CoCContainer aggregation dashboard')
        .option('-p, --port <number>', 'Port number (default: 5000)')
        .option('-H, --host <string>', 'Bind address (default: 127.0.0.1)')
        .option('-d, --data-dir <path>', 'Data directory (default: ~/.coccontainer)')
        .option('--no-open', "Don't auto-open browser")
        .action(async (opts) => {
            const { executeServe } = await import('./commands/serve');
            await executeServe(opts);
        });

    // ========================================================================
    // status
    // ========================================================================
    program
        .command('status')
        .description('Show status of all registered agents')
        .option('-o, --output <fmt>', 'Output format: table, json', 'table')
        .action(async (opts: { output: string }) => {
            const { executeStatus } = await import('./commands/status');
            await executeStatus(opts);
        });

    // ========================================================================
    // run (proxy to agent)
    // ========================================================================
    program
        .command('run <path>')
        .description('Execute a workflow on a remote agent')
        .requiredOption('-a, --agent <id>', 'Agent ID or name to run on')
        .option('-m, --model <model>', 'Override AI model')
        .option('-p, --parallel <n>', 'Parallelism limit')
        .option('-o, --output <fmt>', 'Output format: table, json, csv, markdown')
        .option('--param <params...>', 'Workflow parameters (key=value)')
        .option('--dry-run', 'Validate only')
        .option('--timeout <seconds>', 'Execution timeout')
        .action(async (path: string, opts) => {
            const { executeRun } = await import('./commands/run');
            await executeRun(path, opts);
        });

    // ========================================================================
    // list (proxy to agent)
    // ========================================================================
    program
        .command('list [dir]')
        .description('List workflow packages on a remote agent')
        .requiredOption('-a, --agent <id>', 'Agent ID or name')
        .option('-o, --output <fmt>', 'Output format: table, json', 'table')
        .action(async (dir: string | undefined, opts) => {
            const { executeList } = await import('./commands/list');
            await executeList(dir, opts);
        });

    // ========================================================================
    // validate (proxy to agent)
    // ========================================================================
    program
        .command('validate <path>')
        .description('Validate a workflow YAML on a remote agent')
        .requiredOption('-a, --agent <id>', 'Agent ID or name')
        .action(async (path: string, opts) => {
            const { executeValidate } = await import('./commands/validate');
            await executeValidate(path, opts);
        });

    return program;
}
