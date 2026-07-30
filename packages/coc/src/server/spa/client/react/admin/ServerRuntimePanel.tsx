/**
 * ServerRuntimePanel — the admin Server tab: runtime metadata, display-name
 * save, container-link setup, and the rebuild-and-restart lifecycle control.
 *
 * Restart state is owned by `useServerRuntime` in the host (the sidebar shares
 * the same restart action). The desktop-shell guard hides the restart row here
 * because exit-75 restart has no supervisor in the Electron shell.
 */
import { Suspense, lazy } from 'react';
import { Spinner } from '../ui';
import { AdminRow, SourceBadge } from './adminControls';

const ContainerLinkSection = lazy(() => import('./ContainerLinkSection').then(m => ({ default: m.ContainerLinkSection })));

export interface ServerRuntimePanelProps {
    config: any;
    resolved: any;
    versionInfo: { version: string; commit: string } | null;
    isContainer: boolean;
    isDesktop: boolean;
    sources: Record<string, string>;
    isDefaultValue: (key: string) => boolean | undefined;
    addToast: (message: string, type: 'success' | 'error') => void;
    serverName: string;
    setServerName: (value: string) => void;
    handleSaveServerName: () => void;
    restarting: boolean;
    restartStatus: string;
    handleRestart: () => void;
}

export function ServerRuntimePanel({
    config,
    resolved,
    versionInfo,
    isContainer,
    isDesktop,
    sources,
    isDefaultValue,
    addToast,
    serverName,
    setServerName,
    handleSaveServerName,
    restarting,
    restartStatus,
    handleRestart,
}: ServerRuntimePanelProps) {
    return (
        <>
            <section className="ar-card">
                <header className="ar-card-head">
                    <div className="min-w-0 flex-1">
                        <h3>Runtime</h3>
                        <p className="ar-card-desc">Live information about this server process.</p>
                    </div>
                    <div className="ar-badge-row">
                        <span className="ar-pill"><span className="ar-pill-dot" /> Healthy</span>
                    </div>
                </header>
                <div className="ar-card-body">
                    {config?.configFilePath && (
                        <AdminRow name="Config file">
                            <code className="ar-code">{config.configFilePath}</code>
                        </AdminRow>
                    )}
                    <AdminRow name="Listening on">
                        <code className="ar-code">{resolved.serve?.host ?? '127.0.0.1'}:{resolved.serve?.port ?? '4000'}</code>
                    </AdminRow>
                    {resolved.serve?.dataDir && (
                        <AdminRow name="Data directory">
                            <code className="ar-code">{resolved.serve.dataDir}</code>
                        </AdminRow>
                    )}
                    {versionInfo && (
                        <AdminRow name="Version">
                            <code className="ar-code">{versionInfo.version}</code>
                            <span className="ar-muted" style={{ fontSize: 12 }}>commit</span>
                            <code className="ar-code" title={versionInfo.commit}>{versionInfo.commit.slice(0, 7)}</code>
                        </AdminRow>
                    )}
                </div>
            </section>

            <section className="ar-card">
                <header className="ar-card-head">
                    <div className="min-w-0 flex-1">
                        <h3>Display name</h3>
                        <p className="ar-card-desc">
                            Short name shown in the dashboard title bar (e.g. <code className="ar-code">MBP</code>). Leave blank to use the auto-shortened hostname. Takes effect on next page reload.
                        </p>
                    </div>
                </header>
                <div className="ar-card-body">
                    <AdminRow name="Name">
                        <input
                            id="admin-server-name"
                            type="text"
                            maxLength={64}
                            placeholder={resolved.serve?.host ? `auto (${resolved.serve.host})` : 'auto'}
                            value={serverName}
                            onChange={e => setServerName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleSaveServerName(); }}
                            className="ar-input ar-long ar-mono"
                        />
                        <SourceBadge source={sources['serve.serverName']} isDefault={isDefaultValue('serve.serverName')} />
                        <button id="admin-server-name-save" type="button" className="ar-btn ar-btn-primary ar-btn-sm" onClick={handleSaveServerName}>Save</button>
                    </AdminRow>
                </div>
            </section>

            {!isContainer && (
                <section className="ar-card">
                    <header className="ar-card-head">
                        <div className="min-w-0 flex-1">
                            <h3>Container Link</h3>
                            <p className="ar-card-desc">
                                Connect this agent to a container server using the call-home pattern. The agent connects outbound via WebSocket — no inbound port required.
                            </p>
                        </div>
                    </header>
                    <Suspense fallback={<div style={{ padding: 16 }}><Spinner size="sm" /></div>}>
                        <ContainerLinkSection onError={msg => addToast(msg, 'error')} />
                    </Suspense>
                </section>
            )}

            <section className="ar-card">
                <header className="ar-card-head">
                    <div className="min-w-0 flex-1">
                        <h3>Lifecycle</h3>
                        <p className="ar-card-desc">Rebuild and restart the CoC server process. Active sessions reconnect automatically.</p>
                    </div>
                </header>
                <div className="ar-card-body">
                    {/* Hidden in the Electron desktop shell: exit-75 restart has no
                        supervisor there, so the server never comes back. Drop the
                        whole row rather than leave an empty one. */}
                    {!isDesktop && (
                        <AdminRow
                            name="Rebuild & restart"
                            hint="Runs npm rebuild and re-launches the server."
                        >
                            <button
                                id="admin-restart-btn"
                                type="button"
                                className="ar-btn ar-btn-secondary ar-btn-sm"
                                onClick={handleRestart}
                                disabled={restarting}
                            >
                                {restarting && <Spinner size="sm" />}
                                {restarting ? 'Restarting…' : 'Rebuild & Restart'}
                            </button>
                            {restartStatus && <span id="admin-restart-status" className="ar-muted" style={{ fontSize: 12 }}>{restartStatus}</span>}
                        </AdminRow>
                    )}
                </div>
            </section>
        </>
    );
}
