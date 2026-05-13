/**
 * Run command — proxy workflow execution to a remote agent.
 */

import { resolveConfig, ensureDataDir } from '../config';
import { createAgentStore } from '../store';
import { proxyRequest } from '../proxy/http';

export async function executeRun(
    workflowPath: string,
    opts: {
        agent: string;
        model?: string;
        parallel?: string;
        output?: string;
        param?: string[];
        dryRun?: boolean;
        timeout?: string;
    }
): Promise<void> {
    const config = resolveConfig();
    ensureDataDir(config.serve.dataDir);
    const store = createAgentStore(config.serve.dataDir);

    try {
        const agent = store.get(opts.agent);
        if (!agent) {
            console.error(`Agent '${opts.agent}' not found. Use \`coccontainer agent list\` to see registered agents.`);
            process.exit(1);
        }

        // Read workflow content
        const fs = await import('fs');
        if (!fs.existsSync(workflowPath)) {
            console.error(`Workflow file not found: ${workflowPath}`);
            process.exit(1);
        }
        const content = fs.readFileSync(workflowPath, 'utf8');

        // Build request body matching CoC's run expectations
        const body: Record<string, unknown> = {
            content,
            model: opts.model,
            parallel: opts.parallel ? parseInt(opts.parallel, 10) : undefined,
            output: opts.output,
            params: opts.param?.reduce((acc, p) => {
                const [k, ...v] = p.split('=');
                acc[k] = v.join('=');
                return acc;
            }, {} as Record<string, string>),
            dryRun: opts.dryRun,
            timeout: opts.timeout ? parseInt(opts.timeout, 10) : undefined,
        };

        console.log(`Running workflow on agent '${agent.name}' (${agent.address})...`);

        const result = await proxyRequest(agent.address, 'POST', '/api/run', body);
        console.log(JSON.stringify(result, null, 2));
    } finally {
        store.close();
    }
}
