import * as path from 'node:path';
import { TeamsOAuthCredential } from '@plusplusoneplusplus/coc-connector/teams';
import type { MCPServerConfig, SendMessageOptions } from '@plusplusoneplusplus/coc-agent-sdk';

const hosts = new Map<string, Map<string, TeamsOAuthCredential>>();
export const TEAMS_NATIVE_MCP_NAME = 'Microsoft Teams';

export function isTeamsMcpServer(name: string, config: MCPServerConfig): config is MCPServerConfig & { url: string } {
    return name === TEAMS_NATIVE_MCP_NAME && (config.type === 'http' || config.type === 'sse')
        && 'url' in config && typeof config.url === 'string';
}

export function getTeamsOAuthCredential(dataDir: string, serverUrl: string): TeamsOAuthCredential {
    const host = path.resolve(dataDir);
    let credentials = hosts.get(host);
    if (!credentials) {
        credentials = new Map();
        hosts.set(host, credentials);
    }
    let credential = credentials.get(serverUrl);
    if (!credential) {
        credential = new TeamsOAuthCredential({ dataDir: host, serverUrl, mode: 'mcp' });
        credentials.set(serverUrl, credential);
    }
    return credential;
}

export function disposeTeamsOAuthCredentials(dataDir: string): void {
    const host = path.resolve(dataDir);
    const credentials = hosts.get(host);
    hosts.delete(host);
    for (const credential of credentials?.values() ?? []) credential.dispose();
}

export function teamsNativeAuthStatus(dataDir: string, serverUrl: string): 'authenticated' | 'required' | 'unknown' {
    const status = getTeamsOAuthCredential(dataDir, serverUrl).getStatus();
    return status === 'authenticated' ? 'authenticated' : status === 'error' ? 'unknown' : 'required';
}

export function buildTeamsMcpAuthHandler(
    dataDir: string,
    servers: Record<string, MCPServerConfig>,
    signal?: AbortSignal,
): SendMessageOptions['onMcpAuthRequest'] {
    const managed = Object.entries(servers).filter(([name, config]) => isTeamsMcpServer(name, config));
    if (managed.length === 0) return undefined;
    return async request => {
        const match = managed.find(([name, config]) =>
            name === request.serverName && 'url' in config && config.url === request.serverUrl);
        if (!match || request.reason === 'upscope') return { kind: 'cancelled' };
        signal?.throwIfAborted();
        const token = await getTeamsOAuthCredential(dataDir, request.serverUrl)
            .getTokenSnapshot(signal, request.reason !== 'initial');
        signal?.throwIfAborted();
        return {
            kind: 'token', accessToken: token.accessToken, tokenType: token.tokenType,
            expiresIn: Math.max(0, Math.floor((token.expiresAt - Date.now()) / 1000)),
        };
    };
}
