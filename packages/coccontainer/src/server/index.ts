/**
 * CoCContainer Server
 *
 * Thin wrapper that serves CoC's SPA in containerMode and proxies
 * API calls to registered CoC agents. The container has NO SPA of
 * its own — it reuses CoC's dashboard bundle.
 *
 * This module is only a composition root: it builds a ContainerRuntime,
 * registers route modules onto a RouteTable, wires WebSocket upgrades through
 * the ContainerWebSocketRouter, and owns HTTP-level concerns (CORS, 404, 500).
 */

import * as http from 'http';
import { URL } from 'url';
import type { ResolvedContainerConfig } from '../config';
import { ContainerRuntime } from './runtime';
import { MessagingConfigService } from './messaging-config';
import { TeamsAuthController } from './teams-auth-controller';
import { ContainerWebSocketRouter } from './websocket-router';
import { RouteTable } from './http-util';
import { installAgentRoutes } from './routes/agent-routes';
import { installWorkspaceAggregationRoutes } from './routes/workspace-routes';
import { installStubRoutes } from './routes/stub-routes';
import { installMessagingRoutes } from './routes/messaging-routes';
import { installTeamsAuthRoutes } from './routes/teams-auth-routes';
import { installProxyRoutes } from './routes/proxy-routes';
import { installEventRoutes } from './routes/event-routes';
import { installSpaRoutes } from './routes/spa-routes';

export interface ContainerServer {
    close(): void;
}

export async function createContainerServer(config: ResolvedContainerConfig): Promise<ContainerServer> {
    const runtime = new ContainerRuntime(config);
    await runtime.start();

    const messagingConfig = new MessagingConfigService(config.serve.dataDir);
    const teamsAuth = new TeamsAuthController({ config, runtime, messagingConfig });

    // Register route modules. Order matters only where matchers overlap
    // (exact vs prefix agent routes, the agent-proxy regex, and the SPA/404
    // fallbacks) — first match wins.
    const routes = new RouteTable();
    installAgentRoutes(routes, runtime);
    installWorkspaceAggregationRoutes(routes, runtime);
    installStubRoutes(routes, config);
    installMessagingRoutes(routes, runtime, messagingConfig);
    installTeamsAuthRoutes(routes, teamsAuth);
    installProxyRoutes(routes, runtime);
    installEventRoutes(routes, runtime);
    installSpaRoutes(routes);

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        try {
            const handled = await routes.dispatch({ req, res, url, method: req.method ?? 'GET' });
            if (!handled) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Not found' }));
            }
        } catch (err) {
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }));
            }
        }
    });

    // WebSocket upgrade handling
    const wsRouter = new ContainerWebSocketRouter();
    // Client WS at /ws — relay all agent messages via WebClientBridge
    wsRouter.register('/ws', (ws) => runtime.webClientBridge.handleConnection(ws));
    // Agent inbound WS at /ws/agent-link — call-home connection
    wsRouter.register('/ws/agent-link', (ws) => runtime.agentManager.handleConnection(ws));
    wsRouter.attach(server);

    server.listen(config.serve.port, config.serve.host);

    return {
        close() {
            runtime.cleanup();
            wsRouter.close();
            server.close();
        },
    };
}
