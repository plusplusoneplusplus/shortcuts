/**
 * Validate command — proxy YAML validation to a remote agent.
 */

import { resolveConfig, ensureDataDir } from '../config';
import { createAgentStore } from '../store';
import { proxyRequest } from '../proxy/http';

export async function executeValidate(
    workflowPath: string,
    opts: { agent: string }
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

        const fs = await import('fs');
        if (!fs.existsSync(workflowPath)) {
            console.error(`Workflow file not found: ${workflowPath}`);
            process.exit(1);
        }
        const content = fs.readFileSync(workflowPath, 'utf8');

        const result = await proxyRequest(agent.address, 'POST', '/api/validate', { content });

        if ((result as { valid?: boolean }).valid) {
            console.log('✓ Workflow is valid.');
        } else {
            console.error('✗ Validation failed:');
            console.error(JSON.stringify(result, null, 2));
            process.exit(1);
        }
    } finally {
        store.close();
    }
}
