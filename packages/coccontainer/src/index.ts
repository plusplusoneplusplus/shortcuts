#!/usr/bin/env node

/**
 * CoCContainer CLI Entry Point
 *
 * Multi-agent CoC aggregation dashboard and CLI proxy.
 * Manages multiple remote CoC agents and proxies operations to them.
 *
 * Usage:
 *   coccontainer serve                Start the aggregation dashboard
 *   coccontainer agent add <address>  Register a CoC agent
 *   coccontainer agent remove <id>    Remove a registered agent
 *   coccontainer agent list           List registered agents
 *   coccontainer run <path>           Execute workflow on a remote agent
 *   coccontainer status               Show status of all agents
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { createProgram, EXIT_CODES } from './cli';

async function main(): Promise<void> {
    try {
        const program = createProgram();
        await program.parseAsync(process.argv);
    } catch (error) {
        if (error instanceof Error) {
            console.error(`Error: ${error.message}`);
        } else {
            console.error(`Error: ${String(error)}`);
        }
        process.exit(EXIT_CODES.EXECUTION_ERROR);
    }
}

main();
