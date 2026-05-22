/**
 * StorageSection — displays current storage backend info and drives
 * the SQLite migration flow (confirm → stream progress → done/error).
 * Also provides "Import History from Directory" for SQLite backends.
 *
 * Loaded lazily in AdminPanel via React.lazy.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button, Spinner } from '../ui';
import { Dialog } from '../ui/Dialog';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StorageStatus {
    backend: 'file' | 'sqlite';
    stats: { processes: number; workspaces: number };
    dbPath?: string;
}

type Phase = 'status' | 'confirm' | 'migrating' | 'done' | 'error';

type PhaseState = 'pending' | 'running' | 'complete' | 'error' | 'skipped';

interface MigrationPhase {
    label: string;
    state: PhaseState;
    progress?: { current: number; total: number };
}

interface MigrationResult {
    success: boolean;
    processes?: number;
    archivedProcesses?: number;
    workspaces?: number;
    wikis?: number;
    backupPath?: string;
    backupSizeBytes?: number;
    error?: string;
    failedPhase?: number;
    failedMessage?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PHASE_LABELS = [
    'Backing up data',
    'Creating database schema',
    'Migrating processes',
    'Migrating workspaces & wikis',
    'Validating migrated data',
    'Cleanup & restart',
];

const sectionHeadClass = 'text-xs font-semibold text-[#616161] dark:text-[#999] uppercase tracking-wide mb-2';
const statusTextClass = 'text-xs text-[#848484]';
const logPreClass = 'text-xs bg-black/5 dark:bg-white/5 p-2 rounded whitespace-pre-wrap max-h-48 overflow-y-auto font-mono';

function phaseIcon(state: PhaseState): string {
    switch (state) {
        case 'complete': return '✓';
        case 'error': return '❌';
        case 'running': return '⏳';
        case 'skipped': return '⊘';
        default: return '○';
    }
}

// ---------------------------------------------------------------------------
// Directory Import Types
// ---------------------------------------------------------------------------

type DirImportPhase = 'idle' | 'scanning' | 'preview' | 'importing' | 'done' | 'error';

interface MatchedWorkspace {
    workspaceId: string;
    activeCount: number;
    archivedCount: number;
    archivedBuckets: string[];
    registeredName: string;
    registeredRootPath: string;
}

interface UnmatchedWorkspace {
    workspaceId: string;
    activeCount: number;
    archivedCount: number;
}

interface DirMatchResult {
    matched: MatchedWorkspace[];
    unmatched: UnmatchedWorkspace[];
    totalProcesses: number;
    totalMatchedProcesses: number;
}

interface DirImportSummary {
    imported: number;
    skipped: number;
    failed: number;
    perWorkspace: { workspaceId: string; name: string; imported: number; skipped: number }[];
}

// ---------------------------------------------------------------------------
// DirectoryImportSection
// ---------------------------------------------------------------------------

function DirectoryImportSection() {
    const [phase, setPhase] = useState<DirImportPhase>('idle');
    const [dirPath, setDirPath] = useState('');
    const [scanning, setScanning] = useState(false);
    const [matchResult, setMatchResult] = useState<DirMatchResult | null>(null);
    const [summary, setSummary] = useState<DirImportSummary | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const logRef = useRef<HTMLPreElement>(null);

    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [logs]);

    const handleScan = async () => {
        if (!dirPath.trim()) return;
        setScanning(true);
        setError(null);
        try {
            const data = await getSpaCocClient().admin.scanStorageDirectory({ path: dirPath.trim() });
            setMatchResult(data);
            setPhase('preview');
        } catch (err: unknown) {
            setError(getSpaCocClientErrorMessage(err, 'Scan failed'));
        } finally {
            setScanning(false);
        }
    };

    const handleImport = async () => {
        setPhase('importing');
        setLogs([]);
        setSummary(null);
        setError(null);

        try {
            const tokenData = await getSpaCocClient().admin.getStorageImportDirectoryToken();
            const res = await getSpaCocClient().admin.importStorageDirectoryStream({
                token: tokenData.token,
                path: dirPath.trim(),
            });

            if (!res.ok) {
                const text = await res.text();
                setError(text);
                setPhase('error');
                return;
            }

            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            // eslint-disable-next-line no-constant-condition
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.type === 'done') {
                            if (data.success) {
                                setSummary(data.summary);
                                setPhase('done');
                            } else {
                                setError(data.error ?? 'Import failed');
                                setPhase('error');
                            }
                        } else if (data.type === 'error') {
                            setError(data.message ?? 'Import error');
                            setPhase('error');
                        } else if (data.message) {
                            setLogs(prev => [...prev, data.message]);
                        }
                    } catch { /* ignore malformed */ }
                }
            }
        } catch (err: unknown) {
            setError(getSpaCocClientErrorMessage(err, 'Network error'));
            setPhase('error');
        }
    };

    const handleReset = () => {
        setPhase('idle');
        setMatchResult(null);
        setSummary(null);
        setLogs([]);
        setError(null);
    };

    return (
        <div className="mt-4 pt-3 border-t border-[#e0e0e0] dark:border-[#333]">
            <div className={sectionHeadClass}>Import History from Directory</div>
            <p className={statusTextClass + ' mb-2'}>
                Import file-based chat history from a previous CoC data directory into the current SQLite database.
            </p>

            {/* Phase: idle — input */}
            {phase === 'idle' && (
                <div className="flex flex-col gap-2">
                    <div className="flex gap-2 items-end">
                        <div className="flex-1">
                            <label className="text-xs text-[#616161] dark:text-[#999] block mb-1">
                                Directory path (repos/ folder or parent)
                            </label>
                            <input
                                type="text"
                                value={dirPath}
                                onChange={(e) => setDirPath(e.target.value)}
                                placeholder="e.g. ~/.coc/repos/ or /backup/coc-data/"
                                className="w-full px-2 py-1 text-xs rounded border border-[#d0d0d0] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#ccc] font-mono"
                            />
                        </div>
                        <Button variant="secondary" size="sm" loading={scanning} disabled={!dirPath.trim()} onClick={handleScan}>
                            Scan
                        </Button>
                    </div>
                    {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
                </div>
            )}

            {/* Phase: preview — scan results */}
            {phase === 'preview' && matchResult && (
                <div className="flex flex-col gap-2">
                    {matchResult.matched.length > 0 && (
                        <div>
                            <div className="text-xs font-medium text-[#1e1e1e] dark:text-[#ccc] mb-1">
                                Matched workspaces ({matchResult.matched.length})
                            </div>
                            <div className="border border-[#e0e0e0] dark:border-[#444] rounded overflow-hidden">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="bg-[#f5f5f5] dark:bg-[#2a2a2a]">
                                            <th className="text-left px-2 py-1 font-medium">Workspace</th>
                                            <th className="text-right px-2 py-1 font-medium">Active</th>
                                            <th className="text-right px-2 py-1 font-medium">Archived</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {matchResult.matched.map(ws => (
                                            <tr key={ws.workspaceId} className="border-t border-[#e0e0e0] dark:border-[#444]">
                                                <td className="px-2 py-1">{ws.registeredName}</td>
                                                <td className="text-right px-2 py-1">{ws.activeCount}</td>
                                                <td className="text-right px-2 py-1">{ws.archivedCount}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {matchResult.unmatched.length > 0 && (
                        <div>
                            <div className="text-xs font-medium text-[#a0a0a0] mb-1">
                                Unmatched directories ({matchResult.unmatched.length}) — no matching workspace registered
                            </div>
                            <div className="text-xs text-[#a0a0a0] space-y-0.5">
                                {matchResult.unmatched.map(ws => (
                                    <div key={ws.workspaceId} className="font-mono">{ws.workspaceId} ({ws.activeCount + ws.archivedCount} processes)</div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className={statusTextClass}>
                        {matchResult.totalMatchedProcesses} processes from {matchResult.matched.length} workspaces ready to import.
                        {' '}Duplicates will be skipped automatically.
                    </div>

                    <div className="flex gap-2">
                        <Button variant="secondary" size="sm" onClick={handleReset}>Cancel</Button>
                        <Button variant="primary" size="sm" disabled={matchResult.matched.length === 0} onClick={handleImport}>
                            Import
                        </Button>
                    </div>
                </div>
            )}

            {/* Phase: importing — progress */}
            {phase === 'importing' && (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-xs">
                        <Spinner size="sm" />
                        <span>Importing processes…</span>
                    </div>
                    {logs.length > 0 && (
                        <pre ref={logRef} className={logPreClass}>
                            {logs.join('\n')}
                        </pre>
                    )}
                </div>
            )}

            {/* Phase: done — summary */}
            {phase === 'done' && summary && (
                <div className="flex flex-col gap-2">
                    <div className="text-xs text-[#1e1e1e] dark:text-[#ccc]">
                        <p>✅ Import complete</p>
                        <ul className="list-disc pl-5 space-y-0.5 mt-1">
                            <li>{summary.imported} processes imported</li>
                            {summary.skipped > 0 && <li>{summary.skipped} duplicates skipped</li>}
                            {summary.failed > 0 && <li>{summary.failed} files failed (corrupt/unreadable)</li>}
                        </ul>
                        {summary.perWorkspace.length > 0 && (
                            <div className="mt-2">
                                <div className="font-medium mb-1">Per workspace:</div>
                                {summary.perWorkspace.map(ws => (
                                    <div key={ws.workspaceId} className="text-[#848484]">
                                        {ws.name}: {ws.imported} imported{ws.skipped > 0 ? `, ${ws.skipped} skipped` : ''}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    {logs.length > 0 && (
                        <pre ref={logRef} className={logPreClass}>
                            {logs.join('\n')}
                        </pre>
                    )}
                    <Button variant="secondary" size="sm" onClick={handleReset}>Close</Button>
                </div>
            )}

            {/* Phase: error */}
            {phase === 'error' && (
                <div className="flex flex-col gap-2">
                    <p className="text-xs text-red-600 dark:text-red-400">❌ {error ?? 'Import failed'}</p>
                    {logs.length > 0 && (
                        <pre ref={logRef} className={logPreClass}>
                            {logs.join('\n')}
                        </pre>
                    )}
                    <Button variant="secondary" size="sm" onClick={handleReset}>Close</Button>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function StorageSection() {
    const [phase, setPhase] = useState<Phase>('status');
    const [status, setStatus] = useState<StorageStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [acquiringToken, setAcquiringToken] = useState(false);
    const [token, setToken] = useState<string | null>(null);
    const [migrationPhases, setMigrationPhases] = useState<MigrationPhase[]>([]);
    const [logs, setLogs] = useState<string[]>([]);
    const [result, setResult] = useState<MigrationResult | null>(null);
    const [polling, setPolling] = useState(false);
    const [skipValidation, setSkipValidation] = useState(false);

    const abortRef = useRef<AbortController | null>(null);
    const logRef = useRef<HTMLPreElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // -----------------------------------------------------------------------
    // Fetch status on mount (and on reset)
    // -----------------------------------------------------------------------

    const loadStatus = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getSpaCocClient().admin.getStorageStatus();
            setStatus(data);
        } catch {
            // silently ignore — status section will show a loading state
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadStatus(); }, [loadStatus]);

    // Auto-scroll log area
    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [logs]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            abortRef.current?.abort();
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, []);

    // -----------------------------------------------------------------------
    // Confirmation flow
    // -----------------------------------------------------------------------

    const handleMigrateClick = async () => {
        setPhase('confirm');
        setAcquiringToken(true);
        try {
            const data = await getSpaCocClient().admin.getStorageMigrateToken();
            setToken(data.token);
        } catch {
            setToken(null);
        } finally {
            setAcquiringToken(false);
        }
    };

    const handleConfirm = async () => {
        if (!token) return;

        // Initialize phase checklist
        setMigrationPhases(PHASE_LABELS.map(label => ({ label, state: 'pending' })));
        setLogs([]);
        setResult(null);
        setPhase('migrating');

        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const res = await getSpaCocClient().admin.migrateStorageStream({
                token,
                skipValidation,
                signal: controller.signal,
            });

            if (!res.ok) {
                const text = await res.text();
                setResult({ success: false, error: text });
                setPhase('error');
                return;
            }

            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            // eslint-disable-next-line no-constant-condition
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const data = JSON.parse(line.slice(6));
                        handleSSEEvent(data);
                    } catch { /* ignore malformed */ }
                }
            }
        } catch (err: unknown) {
            if (err instanceof DOMException && err.name === 'AbortError') {
                // User cancelled — handled by handleCancel
                return;
            }
            setResult({ success: false, error: getSpaCocClientErrorMessage(err, 'Network error') });
            setPhase('error');
        }
    };

    const handleSSEEvent = (data: any) => {
        if (data.type === 'done') {
            if (data.success) {
                // Mark all phases complete
                setMigrationPhases(prev => prev.map(p => ({ ...p, state: 'complete' })));
                setResult({
                    success: true,
                    processes: data.processes,
                    archivedProcesses: data.archivedProcesses,
                    workspaces: data.workspaces,
                    wikis: data.wikis,
                    backupPath: data.backupPath,
                    backupSizeBytes: data.backupSizeBytes,
                });
                setPhase('done');
                // Server restarts automatically — start polling immediately
                startPolling();
            } else {
                setResult({ success: false, error: data.error ?? data.message ?? 'Migration failed' });
                setPhase('error');
            }
            return;
        }

        if (data.type === 'error') {
            const phaseIdx = (data.phase ?? 1) - 1;
            setMigrationPhases(prev => prev.map((p, i) =>
                i === phaseIdx ? { ...p, state: 'error' } : p
            ));
            setLogs(prev => [...prev, `❌ ${data.message || 'Error'}`]);
            setResult({
                success: false,
                failedPhase: data.phase,
                failedMessage: data.message,
                error: data.message,
            });
            return;
        }

        // MigrationProgress events: { phase, status, message, progress? }
        const phaseIdx = (data.phase ?? 1) - 1;

        if (data.status === 'running') {
            const isSkipped = data.message?.includes('skipped');
            setMigrationPhases(prev => prev.map((p, i) => {
                if (i === phaseIdx) return { ...p, state: isSkipped ? 'skipped' : 'running', progress: data.progress };
                if (i < phaseIdx && p.state !== 'complete' && p.state !== 'skipped') return { ...p, state: 'complete' };
                return p;
            }));
            if (data.message) {
                setLogs(prev => [...prev, data.message]);
            }
        } else if (data.status === 'complete') {
            setMigrationPhases(prev => prev.map((p, i) =>
                i === phaseIdx ? { ...p, state: 'complete' } : p
            ));
            if (data.message) {
                setLogs(prev => [...prev, `✓ ${data.message}`]);
            }
        } else if (data.status === 'error') {
            setMigrationPhases(prev => prev.map((p, i) =>
                i === phaseIdx ? { ...p, state: 'error' } : p
            ));
            if (data.message) {
                setLogs(prev => [...prev, `❌ ${data.message}`]);
            }
        }
    };

    // -----------------------------------------------------------------------
    // Cancel
    // -----------------------------------------------------------------------

    const currentPhaseNumber = migrationPhases.findIndex(p => p.state === 'running') + 1;

    const handleCancel = async () => {
        abortRef.current?.abort();
        try {
            await getSpaCocClient().admin.cancelStorageMigration();
        } catch { /* ignore */ }
        setLogs(prev => [...prev, 'Migration cancelled. Rolling back…']);
        setResult({ success: false, error: 'Migration cancelled by user' });
        setPhase('error');
    };

    // -----------------------------------------------------------------------
    // Restart polling (success state)
    // -----------------------------------------------------------------------

    const startPolling = () => {
        if (pollRef.current) return; // already polling
        setPolling(true);
        const poll = setInterval(async () => {
            try {
                await getSpaCocClient().admin.getStorageStatus();
                clearInterval(poll);
                pollRef.current = null;
                window.location.reload();
            } catch {
                // server not back yet
            }
        }, 3000);
        pollRef.current = poll;
    };

    // -----------------------------------------------------------------------
    // Error → reset
    // -----------------------------------------------------------------------

    const handleCloseError = () => {
        setPhase('status');
        loadStatus();
    };

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

    // Status display
    if (phase === 'status') {
        return (
            <div>
                <div className={sectionHeadClass}>Storage Backend</div>
                {loading ? (
                    <Spinner size="sm" />
                ) : status ? (
                    <div className="flex flex-col gap-1">
                        <span className={statusTextClass}>
                            Current: {status.backend === 'sqlite' ? 'SQLite' : 'JSON files'}
                            {' '}({status.stats?.processes ?? 0} processes, {status.stats?.workspaces ?? 0} workspaces)
                        </span>
                        {status.backend === 'sqlite' && status.dbPath && (
                            <span className={statusTextClass}>Database: {status.dbPath}</span>
                        )}
                        {status.backend === 'file' && (
                            <div className="mt-1">
                                <Button variant="secondary" size="sm" onClick={handleMigrateClick}>
                                    Migrate to SQLite
                                </Button>
                            </div>
                        )}
                        {status.backend === 'sqlite' && <DirectoryImportSection />}
                    </div>
                ) : (
                    <span className={statusTextClass}>Unable to load storage status</span>
                )}
            </div>
        );
    }

    // Confirmation dialog
    if (phase === 'confirm') {
        return (
            <>
                <div>
                    <div className={sectionHeadClass}>Storage Backend</div>
                    <span className={statusTextClass}>
                        Current: JSON files ({status?.stats.processes ?? 0} processes, {status?.stats.workspaces ?? 0} workspaces)
                    </span>
                </div>
                <Dialog
                    open={true}
                    onClose={() => setPhase('status')}
                    title="Migrate to SQLite"
                    footer={
                        <>
                            <Button variant="secondary" onClick={() => setPhase('status')}>Cancel</Button>
                            <Button variant="primary" loading={acquiringToken} disabled={!token} onClick={handleConfirm}>
                                Confirm Migration
                            </Button>
                        </>
                    }
                >
                    <p className="mb-2">This will:</p>
                    <ul className="list-disc pl-5 space-y-1 text-xs">
                        <li>Copy {status?.stats.processes ?? 0} processes, {status?.stats.workspaces ?? 0} workspaces into a SQLite database</li>
                        <li>Validate all migrated data</li>
                        <li>Switch the server to use SQLite</li>
                        <li>Clean up old JSON files</li>
                    </ul>
                    <p className="mt-2 text-xs text-[#848484]">The server will restart after migration. Running tasks will be re-queued.</p>
                    <label className="mt-3 flex items-start gap-2 text-xs text-[#848484] cursor-pointer">
                        <input
                            type="checkbox"
                            checked={skipValidation}
                            onChange={(e) => setSkipValidation(e.target.checked)}
                            className="mt-0.5"
                        />
                        <span>Skip validation (use only if migration keeps failing due to validation errors)</span>
                    </label>
                </Dialog>
            </>
        );
    }

    // Migration progress dialog
    if (phase === 'migrating') {
        return (
            <>
                <div>
                    <div className={sectionHeadClass}>Storage Backend</div>
                    <span className={statusTextClass}>Migration in progress…</span>
                </div>
                <Dialog
                    open={true}
                    onClose={() => {}}
                    title="Migrating to SQLite…"
                    disableClose={true}
                    footer={
                        <Button
                            variant="danger"
                            size="sm"
                            disabled={currentPhaseNumber >= 4}
                            onClick={handleCancel}
                        >
                            Cancel
                        </Button>
                    }
                >
                    <div className="space-y-1 mb-3">
                        {migrationPhases.map((mp, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                                {mp.state === 'running' ? (
                                    <Spinner size="sm" />
                                ) : (
                                    <span className="w-4 text-center">{phaseIcon(mp.state)}</span>
                                )}
                                <span className={mp.state === 'running' ? 'text-[#1e1e1e] dark:text-[#cccccc]' : mp.state === 'skipped' ? 'line-through text-[#a0a0a0]' : statusTextClass}>
                                    Phase {i + 1}/{PHASE_LABELS.length}: {mp.label}
                                    {mp.progress ? ` (${mp.progress.current}/${mp.progress.total})` : ''}
                                    {mp.state === 'running' ? '…' : ''}
                                    {mp.state === 'skipped' ? ' — Skipped' : ''}
                                </span>
                            </div>
                        ))}
                    </div>
                    {logs.length > 0 && (
                        <pre ref={logRef} className={logPreClass}>
                            {logs.join('\n')}
                        </pre>
                    )}
                </Dialog>
            </>
        );
    }

    // Success
    if (phase === 'done') {
        return (
            <>
                <div>
                    <div className={sectionHeadClass}>Storage Backend</div>
                    <span className={statusTextClass}>Migration complete</span>
                </div>
                <Dialog
                    open={true}
                    onClose={() => {}}
                    disableClose={true}
                    title="Migration Complete"
                >
                    <div className="space-y-1 text-xs text-[#1e1e1e] dark:text-[#cccccc]">
                        <p>✅ Successfully migrated to SQLite</p>
                        <ul className="list-disc pl-5 space-y-0.5 mt-2">
                            {result?.processes != null && <li>{result.processes} processes migrated</li>}
                            {(result?.workspaces != null || result?.wikis != null) && (
                                <li>{result?.workspaces ?? 0} workspaces{result?.wikis ? `, ${result.wikis} wikis` : ''}</li>
                            )}
                            {result?.archivedProcesses != null && result.archivedProcesses > 0 && (
                                <li>{result.archivedProcesses} archived processes preserved</li>
                            )}
                            {result?.backupPath && (
                                <li>Backup saved to: <code className="text-[10px] break-all">{result.backupPath}</code></li>
                            )}
                            <li>JSON files cleaned up</li>
                        </ul>
                        <p className="mt-2 flex items-center gap-2">
                            <Spinner size="sm" />
                            Waiting for server restart…
                        </p>
                    </div>
                </Dialog>
            </>
        );
    }

    // Error
    return (
        <>
            <div>
                <div className={sectionHeadClass}>Storage Backend</div>
                <span className={statusTextClass}>Migration failed</span>
            </div>
            <Dialog
                open={true}
                onClose={handleCloseError}
                title="Migration Failed"
                footer={
                    <Button variant="secondary" onClick={handleCloseError}>Close</Button>
                }
            >
                <div className="space-y-2 text-xs text-[#1e1e1e] dark:text-[#cccccc]">
                    <p>❌ Migration failed</p>
                    {result?.failedPhase && (
                        <p>Phase {result.failedPhase}: {result.failedMessage ?? 'Unknown error'}</p>
                    )}
                    {result?.error && !result.failedPhase && (
                        <p>{result.error}</p>
                    )}
                    <p className="text-[#848484]">No changes were made. JSON files are untouched.</p>
                </div>
                {logs.length > 0 && (
                    <pre ref={logRef} className={logPreClass + ' mt-2'}>
                        {logs.join('\n')}
                    </pre>
                )}
            </Dialog>
        </>
    );
}
