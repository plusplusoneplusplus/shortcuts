import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    addRemoteServer,
    listRemoteServers,
    reconnectServer,
    removeRemoteServer,
    restartServer,
    updateRemoteServer,
    type RemoteServer,
    type RemoteServerInput,
    type RemoteServerPatch,
} from '../../utils/serverRegistry';
import { useRemoteServerHealth } from '../../hooks/useRemoteServerHealth';
import { getHostname } from '../../utils/config';
import { getSpaCocClient } from '../../api/cocClient';
import { Button, Dialog } from '../../ui';
import { ServerCard, formatUptime, timeAgo, type ServerCardHealth } from './ServerCard';
import { AddServerDialog, EditServerDialog } from './AddServerDialog';

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewMode = 'grid' | 'split' | 'list';
type FilterMode = 'all' | 'online' | 'offline' | 'local' | 'url' | 'devtunnel';
type ServerKind = 'local' | 'url' | 'devtunnel' | 'ssh';

interface UnifiedHealth extends ServerCardHealth {
    isLocal: boolean;
    kind: ServerKind;
}

const LOCAL_POLL_INTERVAL_MS = 30_000;
const FETCH_TIMEOUT_MS = 5_000;
// Upper bound on the optimistic "Restarting…" indicator. Normally it clears once
// polling observes the server go offline and come back online; this backstop
// guarantees it never sticks if the restart blip is missed between poll cycles.
const RESTART_OPTIMISTIC_MAX_MS = 90_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inputToPatch(input: RemoteServerInput): RemoteServerPatch {
    return input.kind === 'url'
        ? { kind: 'url', label: input.label, url: input.url }
        : { kind: 'devtunnel', label: input.label, tunnelId: input.tunnelId };
}

function supportsReconnect(kind: ServerKind): boolean {
    return kind === 'devtunnel' || kind === 'ssh';
}

function getEndpoint(h: UnifiedHealth): string | undefined {
    if (h.isLocal) { return undefined; }
    if (h.effectiveUrl) { return h.effectiveUrl; }
    const srv = h.server;
    if ('url' in srv && srv.kind === 'url') {
        return (srv as RemoteServer & { url: string }).url;
    }
    return undefined;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function Svg({ d, size = 14 }: { d: string; size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d={d} />
        </svg>
    );
}

const ICON = {
    servers:   'M3 4h18v6H3zM3 14h18v6H3z',
    search:    'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
    plus:      'M12 5v14M5 12h14',
    cross:     'M6 6l12 12M18 6L6 18',
    viewSplit: 'M3 4h8v16H3zM13 4h8v16h-8z',
    viewGrid:  'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    viewList:  'M3 6h18M3 12h18M3 18h18',
    external:  'M14 3h7v7M10 14L21 3M19 14v6H4V5h6',
    copy:      'M9 9h10v10H9zM5 5h10v4M5 5v10h4',
    reconnect: 'M3 12a9 9 0 0114-7.5L21 7M21 3v4h-4M21 12a9 9 0 01-14 7.5L3 17M3 21v-4h4',
    restart:   'M12 3v8M5.6 7.6a9 9 0 1012.8 0',
    edit:      'M4 20h4l11-11-4-4L4 16zM14 5l4 4',
    remove:    'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
};

// ─── Shared primitives ────────────────────────────────────────────────────────

function SrvStatusDot({ status }: { status: UnifiedHealth['status'] }) {
    const cls = status === 'online'
        ? 'bg-[#16c060] shadow-[0_0_0_2.5px_rgba(22,192,96,0.18)]'
        : status === 'offline'
            ? 'bg-[#f14c4c] shadow-[0_0_0_2.5px_rgba(241,76,76,0.18)]'
            : 'bg-[#e5a92b] animate-pulse shadow-[0_0_0_2.5px_rgba(229,169,43,0.18)]';
    return <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${cls}`} />;
}

function KindBadge({ kind }: { kind: ServerKind }) {
    const cfg: Record<ServerKind, { label: string; cls: string }> = {
        local:     { label: 'Local',  cls: 'bg-[#0078d4]/10 text-[#0078d4] dark:bg-[#3794ff]/10 dark:text-[#3794ff]' },
        url:       { label: 'URL',    cls: 'bg-[#16c060]/10 text-[#16a060] dark:text-[#16c060]' },
        devtunnel: { label: 'Tunnel', cls: 'bg-[#c586c0]/10 text-[#9a4e9a] dark:text-[#c586c0]' },
        ssh:       { label: 'SSH',    cls: 'bg-[#16a3b8]/10 text-[#0e7c8c] dark:text-[#3bc9db]' },
    };
    const { label, cls } = cfg[kind];
    return (
        <span className={`inline-flex items-center h-[18px] px-1.5 rounded text-[10px] font-semibold uppercase tracking-wide flex-shrink-0 font-mono ${cls}`}>
            {label}
        </span>
    );
}

function ActionBtn({
    onClick, disabled, danger, children,
}: {
    onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={`inline-flex items-center gap-1.5 h-7 px-3 rounded text-xs font-medium border transition-colors disabled:opacity-40 ${
                danger
                    ? 'bg-[#f3f3f3] border-[#e0e0e0] text-[#1e1e1e] hover:text-[#f14c4c] hover:border-[#f14c4c] dark:bg-[#252526] dark:border-[#3c3c3c] dark:text-[#cccccc] dark:hover:text-[#f48771] dark:hover:border-[#f48771]'
                    : 'bg-[#f3f3f3] border-[#e0e0e0] text-[#1e1e1e] hover:bg-[#e8e8e8] dark:bg-[#252526] dark:border-[#3c3c3c] dark:text-[#cccccc] dark:hover:bg-[#2d2d30] dark:hover:text-[#e8e8e8]'
            }`}
        >
            {children}
        </button>
    );
}

// ─── Header ───────────────────────────────────────────────────────────────────

function HeaderBar({
    totalCount, onlineCount, offlineCount,
    filter, onFilter,
    search, onSearch,
    view, onView,
    onAdd,
}: {
    totalCount: number;
    onlineCount: number;
    offlineCount: number;
    filter: FilterMode;
    onFilter: (f: FilterMode) => void;
    search: string;
    onSearch: (s: string) => void;
    view: ViewMode;
    onView: (v: ViewMode) => void;
    onAdd: () => void;
}) {
    const filters: [FilterMode, string, number | null][] = [
        ['all',       'All',    totalCount],
        ['online',    'Online', onlineCount],
        ['offline',   'Offline', offlineCount],
        ['local',     'Local',  null],
        ['url',       'URL',    null],
        ['devtunnel', 'Tunnel', null],
    ];

    return (
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] gap-3 flex-shrink-0">
            <div className="flex items-center gap-4 min-w-0 overflow-x-auto shrink">
                {/* Title */}
                <div className="flex items-center gap-2 font-semibold text-[#1e1e1e] dark:text-[#cccccc] text-sm whitespace-nowrap flex-shrink-0">
                    <Svg d={ICON.servers} size={16} />
                    <span>Servers</span>
                    <span className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full bg-[#e8e8e8] dark:bg-[#2d2d30] text-[#848484] dark:text-[#9d9d9d] text-[11px] font-semibold font-mono">
                        {totalCount}
                    </span>
                </div>
                {/* Filters */}
                <div className="flex gap-0.5 flex-shrink-0">
                    {filters.map(([id, label, n]) => (
                        <button
                            key={id}
                            onClick={() => onFilter(id)}
                            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                                filter === id
                                    ? 'bg-[#e8e8e8] dark:bg-[#2d2d30] text-[#1e1e1e] dark:text-[#e8e8e8]'
                                    : 'text-[#848484] dark:text-[#9d9d9d] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                            }`}
                        >
                            {label}
                            {n != null && (
                                <span className={`font-mono text-[10px] px-1 rounded ${
                                    filter === id
                                        ? 'text-[#1e1e1e] dark:text-[#cccccc]'
                                        : 'text-[#999] dark:text-[#6e6e6e] bg-black/[0.04] dark:bg-white/[0.04]'
                                }`}>
                                    {n}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
                {/* Search */}
                <div className="flex items-center gap-1.5 h-7 px-2.5 bg-white dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded text-[#848484] dark:text-[#9d9d9d] focus-within:border-[#0078d4] dark:focus-within:border-[#3794ff] transition-colors w-44">
                    <Svg d={ICON.search} size={12} />
                    <input
                        placeholder="Search…"
                        value={search}
                        onChange={e => onSearch(e.target.value)}
                        className="flex-1 bg-transparent border-none outline-none text-[#1e1e1e] dark:text-[#e8e8e8] placeholder:text-[#999] dark:placeholder:text-[#6e6e6e] text-xs min-w-0"
                    />
                    {search && (
                        <button onClick={() => onSearch('')} className="text-[#999] dark:text-[#6e6e6e] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]">
                            <Svg d={ICON.cross} size={11} />
                        </button>
                    )}
                </div>

                {/* View toggle */}
                <div className="flex bg-white dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded overflow-hidden">
                    {([['split', ICON.viewSplit], ['grid', ICON.viewGrid], ['list', ICON.viewList]] as [ViewMode, string][]).map(([v, icon]) => (
                        <button
                            key={v}
                            title={v}
                            onClick={() => onView(v)}
                            className={`w-7 h-[26px] flex items-center justify-center transition-colors ${
                                view === v
                                    ? 'bg-[#e8e8e8] dark:bg-[#2d2d30] text-[#1e1e1e] dark:text-[#e8e8e8]'
                                    : 'text-[#848484] dark:text-[#9d9d9d] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                            }`}
                        >
                            <Svg d={icon} size={14} />
                        </button>
                    ))}
                </div>

                {/* Add button */}
                <button
                    data-testid="servers-view-add-btn"
                    onClick={onAdd}
                    className="inline-flex items-center gap-1.5 h-7 px-3 rounded text-xs font-semibold bg-[#0078d4] dark:bg-[#3794ff] text-white hover:bg-[#006bbf] dark:hover:bg-[#2c84ee] transition-colors whitespace-nowrap"
                >
                    <Svg d={ICON.plus} size={13} />
                    Add server
                </button>
            </div>
        </div>
    );
}

// ─── Summary Strip ────────────────────────────────────────────────────────────

function SummaryStrip({ online, offline, total, procs, tunnels, sshTunnels }: {
    online: number; offline: number; total: number; procs: number; tunnels: number; sshTunnels: number;
}) {
    return (
        <div data-testid="summary-strip" className="grid grid-cols-5 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex-shrink-0 gap-px bg-[#e0e0e0] dark:bg-[#3c3c3c]">
            {[
                { label: 'Online',       value: online,     sub: `/${total}`, color: '#16c060' },
                { label: 'Offline',      value: offline,    sub: `/${total}`, color: offline > 0 ? '#f14c4c' : undefined },
                { label: 'Active tasks', value: procs,      sub: null,        color: undefined },
                { label: 'DevTunnels',   value: tunnels,    sub: `/${total}`, color: '#c586c0' },
                { label: 'SSH tunnels',  value: sshTunnels, sub: `/${total}`, color: '#16a3b8' },
            ].map(t => (
                <div key={t.label} className="bg-white dark:bg-[#1e1e1e] px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-[#999] dark:text-[#6e6e6e] mb-1.5">
                        {t.label}
                    </div>
                    <div
                        className="text-2xl font-semibold font-mono leading-none text-[#1e1e1e] dark:text-[#cccccc]"
                        style={t.color ? { color: t.color } : undefined}
                    >
                        {t.value}
                        {t.sub && (
                            <span className="text-sm text-[#999] dark:text-[#6e6e6e] font-normal ml-0.5">{t.sub}</span>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

// ─── Server Row (split + list views) ─────────────────────────────────────────

function QuickAction({ title, onClick, danger, disabled, testId, children }: {
    title: string;
    onClick: React.MouseEventHandler<HTMLButtonElement>;
    danger?: boolean;
    disabled?: boolean;
    testId?: string;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            title={title}
            onClick={onClick}
            disabled={disabled}
            data-testid={testId}
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                danger
                    ? 'text-[#848484] dark:text-[#9d9d9d] hover:text-[#f14c4c] dark:hover:text-[#f48771] hover:bg-[#f14c4c]/10'
                    : 'text-[#848484] dark:text-[#9d9d9d] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.06] dark:hover:bg-white/[0.06]'
            }`}
        >
            {children}
        </button>
    );
}

function ServerRow({
    health, selected, onClick,
    onOpen, onReconnect, onCopy, onEdit, onRemove, onRestart, reconnecting, restarting,
}: {
    health: UnifiedHealth;
    selected?: boolean;
    onClick: () => void;
    onOpen: () => void;
    onReconnect?: () => void;
    onCopy: () => void;
    onEdit?: () => void;
    onRemove?: () => void;
    onRestart?: () => void;
    reconnecting?: boolean;
    restarting?: boolean;
}) {
    const { server, status, uptime, processCount, kind, isLocal } = health;
    return (
        <div
            onClick={onClick}
            className={`group relative flex items-center gap-2.5 px-4 py-3 border-b border-[#ebebeb] dark:border-[#333334] cursor-default transition-colors min-h-[54px] ${
                selected
                    ? 'bg-[#ebebeb] dark:bg-[#2c2d30]'
                    : 'hover:bg-black/[0.04] dark:hover:bg-[#2a2a2d]'
            }`}
        >
            {selected && (
                <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-[#0078d4] dark:bg-[#3794ff]" />
            )}

            <SrvStatusDot status={status} />

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-[13px] text-[#1e1e1e] dark:text-[#e8e8e8] truncate">{server.label}</span>
                    <KindBadge kind={kind} />
                    {isLocal && (
                        <span className="text-[10px] font-medium text-[#0078d4] dark:text-[#3794ff] bg-[#0078d4]/10 dark:bg-[#3794ff]/10 px-1.5 py-px rounded uppercase tracking-wide flex-shrink-0">
                            you're here
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1.5 text-[11.5px] text-[#848484] dark:text-[#9d9d9d] font-mono min-w-0 overflow-hidden">
                    {restarting && (
                        <span className="text-[#e5a92b] flex-shrink-0" data-testid="server-row-restarting">restarting…</span>
                    )}
                    {health.serverName && (
                        <span className="text-[#424242] dark:text-[#cccccc] truncate shrink">{health.serverName}</span>
                    )}
                    {status === 'online' && (
                        <>
                            {health.serverName && <span className="text-[#999] dark:text-[#6e6e6e] flex-shrink-0">·</span>}
                            <span className="flex-shrink-0">{processCount ?? 0} {processCount === 1 ? 'task' : 'tasks'}</span>
                            {uptime !== undefined && (
                                <>
                                    <span className="text-[#999] dark:text-[#6e6e6e] flex-shrink-0">·</span>
                                    <span className="flex-shrink-0">up {formatUptime(uptime)}</span>
                                </>
                            )}
                        </>
                    )}
                    {status === 'offline' && (
                        <span className="text-[#f14c4c] flex-shrink-0">
                            offline{health.lastChecked ? ` · last seen ${timeAgo(health.lastChecked)}` : ''}
                        </span>
                    )}
                    {status === 'checking' && (
                        <span className="text-[#e5a92b] flex-shrink-0">probing…</span>
                    )}
                </div>
                {/* Hidden for test compatibility */}
                {kind === 'devtunnel' && 'tunnelId' in server && (
                    <span className="sr-only">Tunnel: {(server as { tunnelId?: string }).tunnelId}</span>
                )}
            </div>

            <div className={`flex items-center gap-0.5 flex-shrink-0 transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                <QuickAction title="Open dashboard" onClick={e => { e.stopPropagation(); onOpen(); }}>
                    <Svg d={ICON.external} size={13} />
                </QuickAction>
                {supportsReconnect(kind) && onReconnect && (
                    <QuickAction
                        title={reconnecting ? 'Reconnecting…' : 'Reconnect'}
                        onClick={e => { e.stopPropagation(); onReconnect(); }}
                    >
                        <Svg d={ICON.reconnect} size={13} />
                    </QuickAction>
                )}
                {!isLocal && onRestart && (
                    <QuickAction
                        testId="server-row-restart"
                        title={
                            restarting ? 'Restarting…'
                                : status !== 'online' ? 'Restart is available only when the server is online'
                                : 'Restart remote server'
                        }
                        disabled={status !== 'online' || restarting}
                        onClick={e => { e.stopPropagation(); onRestart(); }}
                    >
                        <Svg d={ICON.restart} size={13} />
                    </QuickAction>
                )}
                <QuickAction title="Copy URL" onClick={e => { e.stopPropagation(); onCopy(); }}>
                    <Svg d={ICON.copy} size={13} />
                </QuickAction>
                {!isLocal && onEdit && (
                    <QuickAction title="Edit" onClick={e => { e.stopPropagation(); onEdit(); }}>
                        <Svg d={ICON.edit} size={13} />
                    </QuickAction>
                )}
                {!isLocal && onRemove && (
                    <QuickAction title="Remove" danger onClick={e => { e.stopPropagation(); onRemove(); }}>
                        <Svg d={ICON.remove} size={13} />
                    </QuickAction>
                )}
            </div>
        </div>
    );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function StatTile({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
    return (
        <div className="bg-white dark:bg-[#1e1e1e] border border-[#ebebeb] dark:border-[#333334] rounded px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-wide text-[#999] dark:text-[#6e6e6e] mb-1">{label}</div>
            <div
                className="text-base font-semibold font-mono text-[#1e1e1e] dark:text-[#e8e8e8]"
                style={tone ? { color: tone } : undefined}
            >
                {String(value)}
            </div>
        </div>
    );
}

function ConnectionRows({ health }: { health: UnifiedHealth }) {
    const { server, kind, effectiveUrl, tunnelId, localPort, publicUrl, serverName } = health;
    const rows: [string, string][] = [];

    if (kind === 'local') {
        rows.push(['Hostname', serverName ?? '—']);
    } else if (kind === 'url') {
        const url = 'url' in server ? (server as { url: string }).url : effectiveUrl ?? '—';
        rows.push(['URL', url]);
        rows.push(['Hostname', serverName ?? '—']);
    } else if (kind === 'ssh') {
        const host = 'host' in server ? (server as { host?: string }).host ?? '—' : '—';
        rows.push(['SSH host', host]);
        const port = localPort ?? ('localPort' in server ? (server as { localPort?: number }).localPort : undefined);
        rows.push(['Local port', port ? `localhost:${port}` : '—']);
        if (effectiveUrl) { rows.push(['Endpoint', effectiveUrl]); }
    } else {
        if (publicUrl) { rows.push(['Public URL', publicUrl]); }
        rows.push(['Local port', localPort ? `localhost:${localPort}` : '—']);
        if (effectiveUrl) { rows.push(['Endpoint', effectiveUrl]); }
    }
    if (health.version) { rows.push(['Version', `CoC v${health.version}`]); }

    return (
        <>
            {rows.map(([k, v]) => (
                <div
                    key={k}
                    className="grid items-center gap-2 px-3.5 py-2 bg-white dark:bg-[#252526]"
                    style={{ gridTemplateColumns: '90px 1fr auto' }}
                >
                    <span className="text-[10px] uppercase tracking-wide text-[#999] dark:text-[#6e6e6e] font-semibold">{k}</span>
                    <span className="font-mono text-xs text-[#424242] dark:text-[#cccccc] truncate" title={v}>{v}</span>
                    <button
                        type="button"
                        onClick={() => { try { void navigator.clipboard?.writeText(v); } catch { /* best-effort */ } }}
                        title="Copy"
                        className="w-5 h-5 flex items-center justify-center rounded text-[#999] dark:text-[#6e6e6e] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors"
                    >
                        <Svg d={ICON.copy} size={11} />
                    </button>
                </div>
            ))}
        </>
    );
}

function DetailPanel({
    health,
    onOpen, onReconnect, onCopy, onEdit, onRemove, onRestart, reconnecting, restarting,
}: {
    health: UnifiedHealth;
    onOpen: () => void;
    onReconnect?: () => void;
    onCopy: () => void;
    onEdit?: () => void;
    onRemove?: () => void;
    onRestart?: () => void;
    reconnecting?: boolean;
    restarting?: boolean;
}) {
    const { server, status, version, uptime, processCount, kind, isLocal, error, lastChecked } = health;
    const endpoint = getEndpoint(health);

    return (
        <div className="overflow-y-auto bg-white dark:bg-[#1e1e1e] h-full">
            <div className="p-6 max-w-3xl">
                {/* Head */}
                <div data-testid="server-detail-head" className="flex items-start justify-between gap-4 pb-5 border-b border-[#ebebeb] dark:border-[#333334] mb-5 flex-wrap">
                    <div className="min-w-0 flex-[1_1_240px]">
                        <div className="flex items-center gap-2.5 mb-1.5 min-w-0">
                            <SrvStatusDot status={status} />
                            <h2
                                data-testid="server-detail-title"
                                title={server.label}
                                className="min-w-0 truncate text-[22px] font-semibold tracking-tight text-[#1e1e1e] dark:text-[#e8e8e8]"
                            >
                                {server.label}
                            </h2>
                            <KindBadge kind={kind} />
                        </div>
                        <div className="flex items-center gap-2 text-xs font-mono text-[#848484] dark:text-[#9d9d9d] flex-wrap">
                            {health.serverName && <span>{health.serverName}</span>}
                            {health.serverName && version && <span className="text-[#999] dark:text-[#6e6e6e]">·</span>}
                            {version && <span>v{version}</span>}
                            {status === 'online' && uptime !== undefined && (
                                <>
                                    <span className="text-[#999] dark:text-[#6e6e6e]">·</span>
                                    <span>up {formatUptime(uptime)}</span>
                                </>
                            )}
                        </div>
                    </div>
                    <div data-testid="server-detail-actions" className="flex items-center gap-1.5 flex-wrap flex-shrink-0">
                        {endpoint && (
                            <a
                                href={endpoint}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 h-7 px-3 rounded text-xs font-semibold bg-[#0078d4] dark:bg-[#3794ff] text-white hover:bg-[#006bbf] dark:hover:bg-[#2c84ee] transition-colors"
                            >
                                <Svg d={ICON.external} size={12} />
                                Open dashboard
                            </a>
                        )}
                        {supportsReconnect(kind) && onReconnect && (
                            <ActionBtn onClick={onReconnect} disabled={reconnecting}>
                                <Svg d={ICON.reconnect} size={12} />
                                {reconnecting ? 'Reconnecting…' : 'Reconnect'}
                            </ActionBtn>
                        )}
                        {!isLocal && onRestart && (
                            <ActionBtn
                                onClick={onRestart}
                                disabled={status !== 'online' || restarting}
                            >
                                <Svg d={ICON.restart} size={12} />
                                {restarting ? 'Restarting…' : 'Restart'}
                            </ActionBtn>
                        )}
                        <ActionBtn onClick={onCopy}>
                            <Svg d={ICON.copy} size={12} />
                            Copy URL
                        </ActionBtn>
                        {!isLocal && onEdit && (
                            <ActionBtn onClick={onEdit}>
                                <Svg d={ICON.edit} size={12} />
                                Edit
                            </ActionBtn>
                        )}
                        {!isLocal && onRemove && (
                            <ActionBtn danger onClick={onRemove}>
                                <Svg d={ICON.remove} size={12} />
                                Remove
                            </ActionBtn>
                        )}
                    </div>
                </div>

                {/* Banners */}
                {status === 'offline' && (
                    <div className="flex items-start gap-3 px-4 py-3 rounded-md border border-[#f14c4c]/30 bg-[#f14c4c]/[0.08] text-[#f14c4c] dark:text-[#f48771] text-xs mb-4">
                        <Svg d={ICON.cross} size={14} />
                        <div className="flex-1">
                            <div className="font-semibold">Server unreachable</div>
                            <div className="text-[#848484] dark:text-[#9d9d9d] mt-0.5">
                                {error || 'Health probe failed.'}
                                {lastChecked ? ` Last seen ${timeAgo(lastChecked)}.` : ''}
                            </div>
                        </div>
                        {onReconnect && (
                            <ActionBtn onClick={onReconnect}>
                                <Svg d={ICON.reconnect} size={12} /> Retry
                            </ActionBtn>
                        )}
                    </div>
                )}
                {status === 'checking' && (
                    <div className="flex items-center gap-3 px-4 py-3 rounded-md border border-[#e5a92b]/30 bg-[#e5a92b]/[0.08] text-[#e5a92b] text-xs mb-4">
                        <span className="inline-block w-3 h-3 rounded-full border-[1.5px] border-current border-t-transparent animate-spin flex-shrink-0" />
                        <div>
                            <div className="font-semibold">Probing host</div>
                            <div className="text-[#848484] dark:text-[#9d9d9d] mt-0.5">
                                Establishing connection to verify reachability.
                            </div>
                        </div>
                    </div>
                )}

                {/* Stats + Connection */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <section className="bg-[#f3f3f3] dark:bg-[#252526] border border-[#ebebeb] dark:border-[#333334] rounded-md overflow-hidden">
                        <header className="flex items-center justify-between px-3.5 py-2.5 border-b border-[#ebebeb] dark:border-[#333334]">
                            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#848484] dark:text-[#9d9d9d]">Stats</h3>
                            <span
                                className="text-[11px] font-mono font-semibold"
                                style={{
                                    color: status === 'online' ? '#16c060'
                                        : status === 'offline' ? '#f14c4c'
                                        : '#e5a92b',
                                }}
                            >
                                {status}
                            </span>
                        </header>
                        <div className="p-3.5 grid grid-cols-2 gap-2.5">
                            <StatTile label="Tasks running" value={processCount ?? 0} />
                            <StatTile label="Uptime" value={status === 'online' && uptime !== undefined ? formatUptime(uptime) : '—'} />
                            <StatTile label="Version" value={version ? `v${version}` : '—'} />
                            <StatTile label="Kind" value={kind} />
                        </div>
                    </section>

                    <section className="bg-[#f3f3f3] dark:bg-[#252526] border border-[#ebebeb] dark:border-[#333334] rounded-md overflow-hidden">
                        <header className="px-3.5 py-2.5 border-b border-[#ebebeb] dark:border-[#333334]">
                            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#848484] dark:text-[#9d9d9d]">Connection</h3>
                        </header>
                        <div className="divide-y divide-[#ebebeb] dark:divide-[#333334]">
                            <ConnectionRows health={health} />
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function ServersView() {
    const [servers, setServers] = useState<RemoteServer[]>([]);
    const [addOpen, setAddOpen] = useState(false);
    const [editServerId, setEditServerId] = useState<string | undefined>();
    const [reconnectingId, setReconnectingId] = useState<string | undefined>();
    const [restartConfirmId, setRestartConfirmId] = useState<string | undefined>();
    const [restartPending, setRestartPending] = useState(false);
    const [restartError, setRestartError] = useState<string | undefined>();
    // Servers showing the optimistic "Restarting…" indicator. Outlives the in-flight
    // request: set on confirm, cleared once polling settles the offline→online cycle
    // (or by the RESTART_OPTIMISTIC_MAX_MS backstop).
    const [restartingIds, setRestartingIds] = useState<Set<string>>(() => new Set());
    // Per-id record of whether polling has observed the restart blip (offline/checking)
    // since the restart began, so we only clear once it is genuinely back online.
    const sawOfflineRef = useRef<Set<string>>(new Set());
    const restartTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const [loadError, setLoadError] = useState<string | undefined>();
    const [view, setView] = useState<ViewMode>('split');
    const [filter, setFilter] = useState<FilterMode>('all');
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string>('local');

    useEffect(() => {
        let cancelled = false;
        listRemoteServers()
            .then(result => { if (!cancelled) { setServers(result); setLoadError(undefined); } })
            .catch(error => { if (!cancelled) { setLoadError(error instanceof Error ? error.message : String(error)); } });
        return () => { cancelled = true; };
    }, []);

    const { healthStates: remoteHealthStates, refetch: refetchHealth } = useRemoteServerHealth(servers);
    const editServer = editServerId ? servers.find(s => s.id === editServerId) : undefined;

    const [localHealth, setLocalHealth] = useState<ServerCardHealth>(() => ({
        server: { id: 'local', label: 'This Server', url: '' },
        status: 'checking',
        serverName: getHostname(),
    }));

    useEffect(() => {
        let cancelled = false;

        const poll = async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
            try {
                const client = getSpaCocClient();
                const [health, ver] = await Promise.all([
                    client.health.get({ signal: controller.signal }),
                    client.admin.getVersion({ signal: controller.signal }),
                ]);
                clearTimeout(timer);
                if (cancelled) { return; }
                setLocalHealth(prev => ({
                    ...prev,
                    status: 'online',
                    uptime: typeof health?.uptime === 'number' ? health.uptime : undefined,
                    processCount: typeof health?.processCount === 'number' ? health.processCount : undefined,
                    version: typeof ver?.version === 'string' ? ver.version : undefined,
                    lastChecked: Date.now(),
                    error: undefined,
                }));
            } catch (e) {
                clearTimeout(timer);
                if (cancelled) { return; }
                setLocalHealth(prev => ({
                    ...prev, status: 'offline', lastChecked: Date.now(),
                    error: e instanceof Error ? e.message : 'Unknown error',
                }));
            }
        };

        void poll();
        const id = setInterval(() => { void poll(); }, LOCAL_POLL_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(id); };
    }, []);

    const localUnified: UnifiedHealth = useMemo(() => ({
        ...localHealth,
        isLocal: true,
        kind: 'local' as const,
    }), [localHealth]);

    const remoteUnified: UnifiedHealth[] = useMemo(() =>
        remoteHealthStates.map(h => ({
            ...h,
            isLocal: false,
            kind: h.server.kind,
        })),
    [remoteHealthStates]);

    const allHealthStates = useMemo(() => [localUnified, ...remoteUnified], [localUnified, remoteUnified]);

    const counts = useMemo(() => ({
        total:      allHealthStates.length,
        online:     allHealthStates.filter(h => h.status === 'online').length,
        offline:    allHealthStates.filter(h => h.status === 'offline').length,
        procs:      allHealthStates.reduce((a, h) => a + (h.processCount ?? 0), 0),
        tunnels:    allHealthStates.filter(h => h.kind === 'devtunnel').length,
        sshTunnels: allHealthStates.filter(h => h.kind === 'ssh').length,
    }), [allHealthStates]);

    const filtered = useMemo(() => allHealthStates.filter(h => {
        if (filter === 'online'    && h.status !== 'online')  { return false; }
        if (filter === 'offline'   && h.status !== 'offline') { return false; }
        if (filter === 'local'     && !h.isLocal)             { return false; }
        if (filter === 'url'       && h.kind !== 'url')       { return false; }
        if (filter === 'devtunnel' && h.kind !== 'devtunnel') { return false; }
        if (search.trim()) {
            const q = search.toLowerCase();
            const srv = h.server;
            const url = ('url' in srv ? (srv as { url: string }).url : '') ?? '';
            const tunnelId = ('tunnelId' in srv ? (srv as { tunnelId: string }).tunnelId : '') ?? '';
            const host = ('host' in srv ? (srv as { host: string }).host : '') ?? '';
            return [srv.label, h.serverName ?? '', url, tunnelId, host, h.effectiveUrl ?? '']
                .some(v => v.toLowerCase().includes(q));
        }
        return true;
    }), [allHealthStates, filter, search]);

    const selectedHealth = allHealthStates.find(h => h.server.id === selectedId) ?? allHealthStates[0];
    const restartTarget = restartConfirmId
        ? allHealthStates.find(h => h.server.id === restartConfirmId)
        : undefined;

    const handleAdd = async (fields: RemoteServerInput) => {
        await addRemoteServer(fields);
        setServers(await listRemoteServers());
    };

    const handleRemove = async (id: string) => {
        await removeRemoteServer(id);
        setServers(await listRemoteServers());
    };

    const handleReconnect = async (id: string) => {
        setReconnectingId(id);
        try {
            await reconnectServer(id);
            setServers(await listRemoteServers());
        } finally {
            setReconnectingId(undefined);
        }
    };

    // Restart targets the *remote* process (POST /api/servers/:id/restart). Distinct
    // from Reconnect, which only re-spawns the local tunnel. Always gated by an
    // explicit confirmation dialog before any request fires.
    const requestRestart = (id: string) => {
        setRestartError(undefined);
        setRestartConfirmId(id);
    };

    const cancelRestart = () => {
        setRestartConfirmId(undefined);
        setRestartError(undefined);
    };

    const clearRestarting = useCallback((id: string) => {
        sawOfflineRef.current.delete(id);
        const timer = restartTimersRef.current.get(id);
        if (timer) { clearTimeout(timer); restartTimersRef.current.delete(id); }
        setRestartingIds(prev => {
            if (!prev.has(id)) { return prev; }
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    }, []);

    const beginRestarting = useCallback((id: string) => {
        sawOfflineRef.current.delete(id);
        const existing = restartTimersRef.current.get(id);
        if (existing) { clearTimeout(existing); }
        restartTimersRef.current.set(id, setTimeout(() => clearRestarting(id), RESTART_OPTIMISTIC_MAX_MS));
        setRestartingIds(prev => {
            const next = new Set(prev);
            next.add(id);
            return next;
        });
    }, [clearRestarting]);

    const confirmRestart = async () => {
        const id = restartConfirmId;
        if (!id) { return; }
        setRestartPending(true);
        setRestartError(undefined);
        try {
            await restartServer(id);
            setRestartConfirmId(undefined);
            // Optimistic transient that outlives the request, plus an immediate
            // re-poll so the offline→online cycle surfaces without the 30s wait.
            beginRestarting(id);
            refetchHealth();
        } catch (e) {
            // Restart never fired: clear any transient and surface the error inline.
            clearRestarting(id);
            setRestartError(e instanceof Error ? e.message : 'Restart request failed');
        } finally {
            setRestartPending(false);
        }
    };

    // Clear the optimistic "Restarting…" indicator once polling settles: a server
    // must be observed offline/checking (the restart blip) and then back online.
    useEffect(() => {
        if (restartingIds.size === 0) { return; }
        for (const h of remoteHealthStates) {
            if (!restartingIds.has(h.server.id)) { continue; }
            if (h.status === 'offline' || h.status === 'checking') {
                sawOfflineRef.current.add(h.server.id);
            } else if (h.status === 'online' && sawOfflineRef.current.has(h.server.id)) {
                clearRestarting(h.server.id);
            }
        }
    }, [remoteHealthStates, restartingIds, clearRestarting]);

    // Drop pending restart timers on unmount.
    useEffect(() => {
        const timers = restartTimersRef.current;
        return () => {
            for (const timer of timers.values()) { clearTimeout(timer); }
            timers.clear();
        };
    }, []);

    const isRestarting = (id: string) => restartingIds.has(id) || (restartPending && restartConfirmId === id);

    const handleEdit = async (fields: RemoteServerInput) => {
        if (!editServer) { throw new Error('Remote server is no longer available'); }
        await updateRemoteServer(editServer.id, inputToPatch(fields));
        setServers(await listRemoteServers());
    };

    const handleCopy = (h: UnifiedHealth) => {
        const url = getEndpoint(h);
        if (url) { try { void navigator.clipboard?.writeText(url); } catch { /* best-effort */ } }
    };

    const handleOpen = (h: UnifiedHealth) => {
        const url = getEndpoint(h);
        if (url) { window.open(url, '_blank', 'noopener,noreferrer'); }
    };

    const rowProps = (h: UnifiedHealth) => ({
        health: h,
        selected: selectedHealth?.server.id === h.server.id,
        onClick: () => setSelectedId(h.server.id),
        onOpen: () => handleOpen(h),
        onReconnect: (!h.isLocal && supportsReconnect(h.kind))
            ? () => { void handleReconnect(h.server.id); }
            : undefined,
        onCopy: () => handleCopy(h),
        onEdit:   !h.isLocal ? () => setEditServerId(h.server.id) : undefined,
        onRemove: !h.isLocal ? () => { void handleRemove(h.server.id); } : undefined,
        onRestart: !h.isLocal ? () => requestRestart(h.server.id) : undefined,
        reconnecting: reconnectingId === h.server.id,
        restarting: isRestarting(h.server.id),
    });

    return (
        <div className="flex flex-col h-full bg-white dark:bg-[#1e1e1e] overflow-hidden" data-testid="servers-view">
            <HeaderBar
                totalCount={counts.total}
                onlineCount={counts.online}
                offlineCount={counts.offline}
                filter={filter}
                onFilter={setFilter}
                search={search}
                onSearch={setSearch}
                view={view}
                onView={setView}
                onAdd={() => setAddOpen(true)}
            />

            <SummaryStrip
                online={counts.online}
                offline={counts.offline}
                total={counts.total}
                procs={counts.procs}
                tunnels={counts.tunnels}
                sshTunnels={counts.sshTunnels}
            />

            {loadError && (
                <div
                    className="mx-4 mt-3 px-3 py-2 rounded border border-[#f14c4c]/40 bg-[#f14c4c]/10 text-xs text-[#f14c4c] flex-shrink-0"
                    data-testid="servers-view-load-error"
                >
                    {loadError}
                </div>
            )}

            <div className="flex-1 min-h-0 overflow-hidden">
                {/* ── Grid view ── */}
                {view === 'grid' && (
                    <div className="h-full overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 content-start bg-white dark:bg-[#1e1e1e]">
                        {filtered.map(h => (
                            <ServerCard
                                key={h.server.id}
                                health={h}
                                isLocal={h.isLocal}
                                onRemove={h.isLocal ? undefined : handleRemove}
                                onEdit={h.isLocal ? undefined : setEditServerId}
                                onReconnect={h.isLocal ? undefined : handleReconnect}
                                reconnecting={reconnectingId === h.server.id}
                                onRestart={h.isLocal ? undefined : requestRestart}
                                restarting={isRestarting(h.server.id)}
                            />
                        ))}
                    </div>
                )}

                {/* ── Split view ── */}
                {view === 'split' && (
                    <div
                        className="h-full grid"
                        style={{ gridTemplateColumns: 'minmax(300px, 380px) 1fr' }}
                    >
                        <div className="border-r border-[#e0e0e0] dark:border-[#3c3c3c] overflow-y-auto bg-white dark:bg-[#1e1e1e]">
                            {filtered.length === 0 && (
                                <div className="p-6 text-center text-xs text-[#999] dark:text-[#6e6e6e]">
                                    No servers match the current filter.
                                </div>
                            )}
                            {filtered.map(h => <ServerRow key={h.server.id} {...rowProps(h)} />)}
                        </div>
                        <div className="overflow-hidden">
                            {selectedHealth ? (
                                <DetailPanel
                                    health={selectedHealth}
                                    onOpen={() => handleOpen(selectedHealth)}
                                    onReconnect={!selectedHealth.isLocal && supportsReconnect(selectedHealth.kind)
                                        ? () => { void handleReconnect(selectedHealth.server.id); }
                                        : undefined}
                                    onCopy={() => handleCopy(selectedHealth)}
                                    onEdit={!selectedHealth.isLocal ? () => setEditServerId(selectedHealth.server.id) : undefined}
                                    onRemove={!selectedHealth.isLocal ? () => { void handleRemove(selectedHealth.server.id); } : undefined}
                                    onRestart={!selectedHealth.isLocal ? () => requestRestart(selectedHealth.server.id) : undefined}
                                    reconnecting={reconnectingId === selectedHealth.server.id}
                                    restarting={isRestarting(selectedHealth.server.id)}
                                />
                            ) : (
                                <div className="h-full flex items-center justify-center text-xs text-[#999] dark:text-[#6e6e6e]">
                                    Select a server to inspect.
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── List view ── */}
                {view === 'list' && (
                    <div className="h-full overflow-y-auto bg-white dark:bg-[#1e1e1e] p-3">
                        {filtered.map(h => (
                            <div key={h.server.id} className="border border-[#ebebeb] dark:border-[#333334] rounded-md mb-1.5 overflow-hidden">
                                <ServerRow {...rowProps(h)} />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <AddServerDialog
                open={addOpen}
                onClose={() => setAddOpen(false)}
                onAdd={handleAdd}
            />
            <EditServerDialog
                open={!!editServer}
                server={editServer}
                onClose={() => setEditServerId(undefined)}
                onSave={handleEdit}
            />

            <Dialog
                open={!!restartConfirmId}
                onClose={cancelRestart}
                title="Restart server"
                id="restart-confirm-dialog"
                footer={
                    <>
                        <Button
                            variant="secondary"
                            data-testid="restart-confirm-cancel"
                            onClick={cancelRestart}
                            disabled={restartPending}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="danger"
                            data-testid="restart-confirm-submit"
                            onClick={() => { void confirmRestart(); }}
                            loading={restartPending}
                        >
                            Restart server
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-3" data-testid="restart-confirm-body">
                    <p>
                        Restart{' '}
                        <strong>{restartTarget?.server.label ?? 'this server'}</strong>?
                    </p>
                    <p className="text-[#848484] dark:text-[#9d9d9d]">
                        This restarts the remote server process. Any tasks or processes
                        currently running on it will be interrupted. The server only comes
                        back if it runs under a process manager (pm2, systemd, or a wrapper
                        that relaunches it) — otherwise it stays offline until you start it
                        again manually.
                    </p>
                    {restartError && (
                        <div
                            data-testid="restart-confirm-error"
                            className="px-3 py-2 rounded border border-[#f14c4c]/40 bg-[#f14c4c]/10 text-xs text-[#f14c4c]"
                        >
                            {restartError}
                        </div>
                    )}
                </div>
            </Dialog>
        </div>
    );
}
