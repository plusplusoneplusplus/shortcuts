/**
 * List command — proxy workflow listing to a remote agent.
 */

import { resolveConfig, ensureDataDir } from '../config';
import { createAgentStore } from '../store';
import { proxyRequest } from '../proxy/http';

export async function executeList(
    dir: string | undefined,
    opts: { agent: string; output: string }
): Promise<void> {
    const config = resolveConfig();
    ensureDataDir(config.serve.dataDir);
    const store = createAgentStore(config.serve.dataDir);

    try {
        const agent = store.get(opts.agent);
        if (!agent) {
            console.error(`Agent '${opts.agent}' not found.`);
            process.exit(1);
        }

        const queryParams = dir ? `?dir=${encodeURIComponent(dir)}` : '';
        const result = await proxyRequest(agent.address, 'GET', `/api/workflows${queryParams}`);

        if (opts.output === 'json') {
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log(JSON.stringify(result, null, 2)); // TODO: table format
        }
    } finally {
        store.close();
    }
}
