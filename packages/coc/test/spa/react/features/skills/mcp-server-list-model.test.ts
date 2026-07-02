/**
 * Unit tests for the pure MCP server list read model — status/source/description
 * derivation, tool-count labels, counts, filtering, and the assembled view model.
 */

import { describe, it, expect } from 'vitest';
import type { McpServerToolsResult } from '@plusplusoneplusplus/coc-client';
import {
    getServerStatus,
    needsAuth,
    isRemote,
    getServerDescription,
    getTransportPillClass,
    getSourcePillInfo,
    shouldShowAuthButton,
    getToolCountLabel,
    computeServerCounts,
    filterServers,
    buildMcpServerListModel,
    type McpServerEntry,
} from '../../../../../src/server/spa/client/react/features/skills/mcp-server-list-model';

const stdio: McpServerEntry = { name: 'local', type: 'stdio' };
const http: McpServerEntry = { name: 'remote', type: 'http', url: 'https://api.example.com' };

describe('getServerStatus', () => {
    it('is off when disabled regardless of transport', () => {
        expect(getServerStatus(http, false)).toBe('off');
        expect(getServerStatus(stdio, false)).toBe('off');
    });

    it('trusts the server-derived status field when present', () => {
        expect(getServerStatus({ ...http, status: 'ok' }, true)).toBe('ok');
        expect(getServerStatus({ ...http, status: 'err' }, true)).toBe('err');
    });

    it('falls back to auth for remote servers without a status', () => {
        expect(getServerStatus(http, true)).toBe('auth');
        expect(getServerStatus({ name: 's', type: 'sse' }, true)).toBe('auth');
    });

    it('falls back to ok for stdio servers without a status', () => {
        expect(getServerStatus(stdio, true)).toBe('ok');
    });
});

describe('needsAuth', () => {
    it('is false for stdio servers', () => {
        expect(needsAuth(stdio)).toBe(false);
    });

    it('assumes auth is needed for a remote server with no authStatus (legacy)', () => {
        expect(needsAuth(http)).toBe(true);
    });

    it('needs auth only when required or expired', () => {
        expect(needsAuth({ ...http, authStatus: 'required' })).toBe(true);
        expect(needsAuth({ ...http, authStatus: 'expired' })).toBe(true);
        expect(needsAuth({ ...http, authStatus: 'authenticated' })).toBe(false);
        expect(needsAuth({ ...http, authStatus: 'not-required' })).toBe(false);
    });
});

describe('isRemote', () => {
    it('is true only for http/sse', () => {
        expect(isRemote(http)).toBe(true);
        expect(isRemote({ name: 's', type: 'sse' })).toBe(true);
        expect(isRemote(stdio)).toBe(false);
    });
});

describe('getServerDescription', () => {
    it('uses description then url then command when enabled', () => {
        expect(getServerDescription({ ...stdio, description: 'Local docs' }, true)).toBe('Local docs');
        expect(getServerDescription(http, true)).toBe('https://api.example.com');
        expect(getServerDescription({ name: 'c', type: 'stdio', command: 'npx foo' }, true)).toBe('npx foo');
    });

    it('prefixes and lowercases the base when disabled', () => {
        expect(getServerDescription({ ...stdio, description: 'Local Docs' }, false)).toBe('Disabled · local docs');
    });
});

describe('getTransportPillClass', () => {
    it('maps transports to pill classes', () => {
        expect(getTransportPillClass('stdio')).toBe('accent');
        expect(getTransportPillClass('http')).toBe('done');
        expect(getTransportPillClass('sse')).toBe('done');
        expect(getTransportPillClass('other')).toBe('');
    });
});

describe('getSourcePillInfo', () => {
    it('marks a user override', () => {
        expect(getSourcePillInfo({ ...stdio, overriddenBy: 'workspace' })).toEqual({ label: 'user override', cls: 'warn' });
    });

    it('labels workspace-sourced servers as repo config', () => {
        expect(getSourcePillInfo({ ...stdio, source: 'workspace' })).toEqual({ label: 'repo config', cls: 'muted' });
    });

    it('labels global-sourced servers as global', () => {
        expect(getSourcePillInfo({ ...stdio, source: 'global' })).toEqual({ label: 'global', cls: 'muted' });
    });

    it('defaults to repo config', () => {
        expect(getSourcePillInfo(stdio)).toEqual({ label: 'repo config', cls: 'muted' });
    });
});

describe('shouldShowAuthButton', () => {
    it('shows for an enabled remote server that needs auth', () => {
        expect(shouldShowAuthButton(http, true, undefined)).toBe(true);
    });

    it('hides for a disabled server', () => {
        expect(shouldShowAuthButton(http, false, undefined)).toBe(false);
    });

    it('hides for a stdio server', () => {
        expect(shouldShowAuthButton(stdio, true, undefined)).toBe(false);
    });

    it('keeps showing while a non-completed flow is in progress', () => {
        const authed: McpServerEntry = { ...http, authStatus: 'authenticated' };
        expect(shouldShowAuthButton(authed, true, undefined)).toBe(false);
        expect(shouldShowAuthButton(authed, true, { phase: 'authorizing', requestId: 'r' })).toBe(true);
        expect(shouldShowAuthButton(authed, true, { phase: 'completed', requestId: 'r' })).toBe(false);
    });
});

const okResult = (names: string[]): McpServerToolsResult => ({
    status: 'ok',
    tools: names.map(name => ({ name })),
});

describe('getToolCountLabel', () => {
    const base = { discoveryState: 'loaded' as const, allowEntry: undefined, result: okResult(['a', 'b']) };

    it('is a dash for a disabled or overridden server', () => {
        expect(getToolCountLabel({ ...base, enabled: false, effective: true }).text).toBe('—');
        expect(getToolCountLabel({ ...base, enabled: true, effective: false }).text).toBe('—');
    });

    it('is an ellipsis while discovery is loading and a dash once settled empty', () => {
        expect(getToolCountLabel({ enabled: true, effective: true, result: undefined, discoveryState: 'loading', allowEntry: undefined }).text).toBe('…');
        expect(getToolCountLabel({ enabled: true, effective: true, result: undefined, discoveryState: 'idle', allowEntry: undefined }).text).toBe('…');
        expect(getToolCountLabel({ enabled: true, effective: true, result: undefined, discoveryState: 'loaded', allowEntry: undefined }).text).toBe('—');
    });

    it('is a bang with the error as tooltip for an unreachable server', () => {
        const label = getToolCountLabel({ enabled: true, effective: true, result: { status: 'error', tools: [], error: 'ECONNREFUSED' }, discoveryState: 'loaded', allowEntry: undefined });
        expect(label.text).toBe('!');
        expect(label.title).toBe('ECONNREFUSED');
    });

    it('shows the total when all tools are enabled', () => {
        expect(getToolCountLabel({ ...base, enabled: true, effective: true }).text).toBe('2');
    });

    it('shows enabled/total when an allow-list restricts tools', () => {
        const label = getToolCountLabel({ enabled: true, effective: true, result: okResult(['a', 'b']), discoveryState: 'loaded', allowEntry: ['a'] });
        expect(label.text).toBe('1/2');
        expect(label.title).toBe('1 of 2 tools enabled');
    });
});

const servers: McpServerEntry[] = [
    { name: 'active-stdio', type: 'stdio', status: 'ok' },
    { name: 'needs-auth', type: 'http' },
    { name: 'disabled-one', type: 'stdio' },
    { name: 'overridden', type: 'stdio', effective: false },
];
const isEnabled = (name: string) => name !== 'disabled-one';

describe('computeServerCounts', () => {
    it('counts all/active/auth/disabled independently', () => {
        // disabled-one is off; overridden is disabled (effective false); needs-auth is remote → auth.
        expect(computeServerCounts(servers, isEnabled)).toEqual({ all: 4, active: 1, auth: 1, disabled: 2 });
    });
});

describe('filterServers', () => {
    it('returns everything for the all tab', () => {
        expect(filterServers(servers, { filterTab: 'all', searchQuery: '', isEnabled }).map(s => s.name))
            .toEqual(['active-stdio', 'needs-auth', 'disabled-one', 'overridden']);
    });

    it('keeps only healthy enabled servers for the active tab', () => {
        expect(filterServers(servers, { filterTab: 'active', searchQuery: '', isEnabled }).map(s => s.name)).toEqual(['active-stdio']);
    });

    it('keeps only auth-status servers for the auth tab', () => {
        expect(filterServers(servers, { filterTab: 'auth', searchQuery: '', isEnabled }).map(s => s.name)).toEqual(['needs-auth']);
    });

    it('keeps disabled and overridden servers for the disabled tab', () => {
        expect(filterServers(servers, { filterTab: 'disabled', searchQuery: '', isEnabled }).map(s => s.name)).toEqual(['disabled-one', 'overridden']);
    });

    it('applies the search query by name and description', () => {
        const withDesc: McpServerEntry[] = [
            { name: 'github', type: 'stdio', description: 'source control' },
            { name: 'postgres', type: 'stdio', description: 'database' },
        ];
        expect(filterServers(withDesc, { filterTab: 'all', searchQuery: 'data', isEnabled: () => true }).map(s => s.name)).toEqual(['postgres']);
        expect(filterServers(withDesc, { filterTab: 'all', searchQuery: 'GIT', isEnabled: () => true }).map(s => s.name)).toEqual(['github']);
    });
});

describe('buildMcpServerListModel', () => {
    it('assembles counts over all servers and rows over the filtered set', () => {
        const model = buildMcpServerListModel({
            servers,
            isEnabled,
            filterTab: 'active',
            searchQuery: '',
            discovery: { 'active-stdio': okResult(['x', 'y', 'z']) },
            discoveryState: 'loaded',
            toolsAllowList: { 'active-stdio': ['x'] },
            authFlow: {},
        });

        expect(model.counts).toEqual({ all: 4, active: 1, auth: 1, disabled: 2 });
        expect(model.rows).toHaveLength(1);
        const row = model.rows[0];
        expect(row.server.name).toBe('active-stdio');
        expect(row.status).toBe('ok');
        expect(row.transportCls).toBe('accent');
        expect(row.toolCount.text).toBe('1/3');
        expect(row.showAuthBtn).toBe(false);
    });

    it('flags the auth button and carries the flow for a remote server', () => {
        const model = buildMcpServerListModel({
            servers,
            isEnabled,
            filterTab: 'auth',
            searchQuery: '',
            discovery: {},
            discoveryState: 'idle',
            toolsAllowList: {},
            authFlow: { 'needs-auth': { phase: 'authorizing', requestId: 'r1' } },
        });
        expect(model.rows).toHaveLength(1);
        expect(model.rows[0].showAuthBtn).toBe(true);
        expect(model.rows[0].flow).toEqual({ phase: 'authorizing', requestId: 'r1' });
    });
});
