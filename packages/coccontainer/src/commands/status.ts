/**
 * Status command — shows all agents and their status.
 */

import { resolveConfig, ensureDataDir } from '../config';
import { createAgentStore } from '../store';
import { checkAgentHealth } from '../proxy/health';
import { fetchAgentWorkspaces } from '../proxy/workspaces';

export async function executeStatus(opts: { output: string }): Promise<void> {
    const config = resolveConfig();
    ensureDataDir(config.serve.dataDir);
    const store = createAgentStore(config.serve.dataDir);

    try {
        const agents = store.list();

        if (agents.length === 0) {
            console.log('No agents registered. Use `coccontainer agent add <address>` to add one.');
            return;
        }

        // Check health and fetch workspace counts in parallel
        const results = await Promise.all(
            agents.map(async (agent) => {
                const healthy = await checkAgentHealth(agent.address);
                store.updateStatus(agent.id, healthy ? 'online' : 'offline');

                let repoCount = 0;
                if (healthy) {
                    try {
                        const workspaces = await fetchAgentWorkspaces(agent.address);
                        repoCount = workspaces.length;
                    } catch {
                        // ignore
                    }
                }

                return { ...agent, status: healthy ? 'online' as const : 'offline' as const, repoCount };
            })
        );

        if (opts.output === 'json') {
            console.log(JSON.stringify(results, null, 2));
            return;
        }

        console.log(`${'Name'.padEnd(20)} ${'Address'.padEnd(35)} ${'Status'.padEnd(10)} ${'Repos'.padEnd(6)}`);
        console.log('─'.repeat(75));
        for (const r of results) {
            const icon = r.status === 'online' ? '●' : '○';
            console.log(
                `${r.name.padEnd(20)} ${r.address.padEnd(35)} ${(icon + ' ' + r.status).padEnd(10)} ${String(r.repoCount).padEnd(6)}`
            );
        }

        const online = results.filter(r => r.status === 'online').length;
        console.log(`\n${online}/${results.length} agents online, ${results.reduce((s, r) => s + r.repoCount, 0)} total repos`);
    } finally {
        store.close();
    }
}
