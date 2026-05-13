/**
 * Agent management commands: add, remove, list
 */

import { resolveConfig, ensureDataDir } from '../config';
import { createAgentStore, type Agent } from '../store';
import { checkAgentHealth } from '../proxy/health';

export async function executeAgentAdd(address: string, opts: { name?: string }): Promise<void> {
    const config = resolveConfig();
    ensureDataDir(config.serve.dataDir);
    const store = createAgentStore(config.serve.dataDir);

    try {
        // Validate URL format
        try {
            new URL(address);
        } catch {
            throw new Error(`Invalid URL: ${address}. Use format like http://localhost:4000`);
        }

        const agent = store.add(address, opts.name);

        // Check health immediately
        const healthy = await checkAgentHealth(agent.address);
        store.updateStatus(agent.id, healthy ? 'online' : 'offline');

        console.log(`Agent registered:`);
        console.log(`  ID:      ${agent.id}`);
        console.log(`  Name:    ${agent.name}`);
        console.log(`  Address: ${agent.address}`);
        console.log(`  Status:  ${healthy ? 'online' : 'offline'}`);
    } finally {
        store.close();
    }
}

export async function executeAgentRemove(idOrName: string): Promise<void> {
    const config = resolveConfig();
    const store = createAgentStore(config.serve.dataDir);

    try {
        const removed = store.remove(idOrName);
        if (removed) {
            console.log(`Agent '${idOrName}' removed.`);
        } else {
            console.error(`Agent '${idOrName}' not found.`);
            process.exit(1);
        }
    } finally {
        store.close();
    }
}

export async function executeAgentList(opts: { output: string }): Promise<void> {
    const config = resolveConfig();
    ensureDataDir(config.serve.dataDir);
    const store = createAgentStore(config.serve.dataDir);

    try {
        const agents = store.list();

        if (opts.output === 'json') {
            console.log(JSON.stringify(agents, null, 2));
            return;
        }

        if (agents.length === 0) {
            console.log('No agents registered. Use `coccontainer agent add <address>` to add one.');
            return;
        }

        // Table output
        console.log(`${'Name'.padEnd(20)} ${'Address'.padEnd(35)} ${'Status'.padEnd(10)} ${'ID'}`);
        console.log('─'.repeat(90));
        for (const agent of agents) {
            const statusIcon = agent.status === 'online' ? '●' : agent.status === 'offline' ? '○' : '?';
            console.log(
                `${agent.name.padEnd(20)} ${agent.address.padEnd(35)} ${(statusIcon + ' ' + agent.status).padEnd(10)} ${agent.id}`
            );
        }
    } finally {
        store.close();
    }
}
