/**
 * Agent health checking.
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

/**
 * Check if an agent is reachable by hitting a known endpoint.
 * Returns true if the agent responds with 2xx within timeout.
 */
export async function checkAgentHealth(agentAddress: string, timeoutMs: number = 5000): Promise<boolean> {
    return new Promise((resolve) => {
        try {
            let normalizedAddr = agentAddress;
            if (!/^(https?|wss?):\/\//i.test(normalizedAddr)) {
                normalizedAddr = `http://${normalizedAddr}`;
            }
            const url = new URL('/api/health', normalizedAddr);
            const isHttps = url.protocol === 'https:';
            const transport = isHttps ? https : http;

            const req = transport.get(
                {
                    hostname: url.hostname,
                    port: url.port,
                    path: url.pathname,
                    timeout: timeoutMs,
                },
                (res) => {
                    // Consume body to free socket
                    res.resume();
                    resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 400);
                }
            );

            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
        } catch {
            resolve(false);
        }
    });
}
