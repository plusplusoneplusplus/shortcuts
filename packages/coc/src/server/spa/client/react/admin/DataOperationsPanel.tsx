/**
 * DataOperationsPanel — the admin Data tab: storage backend summary, JSON
 * backup (export / preview / import), and the destructive Danger Zone (wipe).
 *
 * Import and wipe are two-step, token-confirmed flows; that state machine and
 * every button id live here, isolated from the routine settings cards so a
 * change to one high-risk operation can't perturb the other tabs.
 */
import { Suspense, lazy, useCallback, useState } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import { Spinner } from '../ui';
import { AdminRow, AdminSeg } from './adminControls';

const StorageSection = lazy(() => import('./StorageSection'));

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, i);
    return value.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

export interface DataOperationsPanelProps {
    addToast: (message: string, type: 'success' | 'error') => void;
    /** Called after a successful import or wipe so the host can refresh stats. */
    onDataChanged: () => void;
}

export function DataOperationsPanel({ addToast, onDataChanged }: DataOperationsPanelProps) {
    // Export
    const [exportStatus, setExportStatus] = useState<string>('');
    // Import
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace');
    const [importPreview, setImportPreview] = useState<string | null>(null);
    const [importStatus, setImportStatus] = useState<string>('');
    // Wipe
    const [wipeToken, setWipeToken] = useState<string | null>(null);
    const [includeWikis, setIncludeWikis] = useState(false);
    const [wipeStatus, setWipeStatus] = useState<string>('');
    const [wipePreview, setWipePreview] = useState<string | null>(null);

    const handleExport = useCallback(async () => {
        setExportStatus('Exporting…');
        try {
            const res = await getSpaCocClient().admin.exportData();
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                const message = typeof body === 'object' && body !== null && 'error' in body ? String(body.error) : res.statusText;
                throw new Error(message);
            }
            const disposition = res.headers.get('Content-Disposition') || '';
            const match = disposition.match(/filename="([^"]+)"/);
            const filename = match ? match[1] : `coc-export-${new Date().toISOString().replace(/:/g, '-')}.json`;
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setExportStatus('Exported successfully.');
        } catch (err: unknown) {
            setExportStatus('Export failed: ' + getSpaCocClientErrorMessage(err, 'Network error'));
        }
    }, []);

    const handlePreviewImport = useCallback(async () => {
        if (!importFile) { setImportStatus('Please select a JSON file first.'); return; }
        setImportStatus('Loading preview…');
        try {
            const text = await importFile.text();
            const payload = JSON.parse(text);
            const data = await getSpaCocClient().admin.previewImport(payload);
            if (!data.valid) {
                setImportPreview('Preview failed: ' + (data?.error || 'Invalid file'));
                setImportStatus('Preview failed.');
                return;
            }
            const p = data.preview;
            const lines: string[] = [];
            if (p.processCount != null) lines.push('Processes: ' + p.processCount);
            if (p.workspaceCount != null) lines.push('Workspaces: ' + p.workspaceCount);
            if (p.wikiCount != null) lines.push('Wikis: ' + p.wikiCount);
            setImportPreview(lines.length ? lines.join('\n') : JSON.stringify(p, null, 2));
            setImportStatus('Preview loaded.');
        } catch (err: unknown) {
            if (err instanceof SyntaxError) {
                setImportPreview(null);
                setImportStatus('Invalid JSON file.');
            } else {
                setImportPreview('Preview failed: ' + getSpaCocClientErrorMessage(err, 'Invalid file'));
                setImportStatus('Preview failed.');
            }
        }
    }, [importFile]);

    const handleImport = useCallback(async () => {
        if (!importFile) { setImportStatus('Please select a JSON file first.'); return; }
        setImportStatus('Requesting confirmation token…');
        let payload: unknown;
        try {
            const text = await importFile.text();
            payload = JSON.parse(text);
        } catch (err: unknown) {
            setImportStatus('Import failed: ' + getSpaCocClientErrorMessage(err, 'Invalid JSON file.'));
            return;
        }
        let tokenRes: { token?: string } | null = null;
        try {
            tokenRes = await getSpaCocClient().admin.getImportToken();
        } catch {
            setImportStatus('Failed to get import token.');
            return;
        }
        if (!tokenRes?.token) { setImportStatus('Failed to get import token.'); return; }
        setImportStatus('Importing…');
        try {
            await getSpaCocClient().admin.importData(payload, { token: tokenRes.token, mode: importMode });
            setImportStatus('Import complete.');
            addToast('Import complete', 'success');
            onDataChanged();
        } catch (err: unknown) {
            setImportStatus('Import failed: ' + getSpaCocClientErrorMessage(err, 'Network error'));
        }
    }, [importFile, importMode, addToast, onDataChanged]);

    const handlePreviewWipe = useCallback(async () => {
        try {
            const data = await getSpaCocClient().admin.getDataStats({ includeWikis });
            const lines: string[] = [];
            if (data.processCount != null) lines.push('Processes: ' + data.processCount);
            if (data.wikiCount != null) lines.push('Wikis: ' + data.wikiCount);
            if (data.totalBytes != null) lines.push('Disk: ' + formatBytes(data.totalBytes));
            setWipePreview(lines.length ? lines.join('\n') : JSON.stringify(data, null, 2));
        } catch {
            setWipePreview('Failed to load preview.');
        }
    }, [includeWikis]);

    const handleWipeStep1 = useCallback(async () => {
        setWipeStatus('Requesting confirmation token…');
        try {
            const data = await getSpaCocClient().admin.getWipeToken();
            if (!data.token) throw new Error('No token received');
            setWipeToken(data.token);
            setWipeStatus('');
        } catch (err: unknown) {
            const detail = getSpaCocClientErrorMessage(err, '');
            setWipeStatus(detail ? `Failed to get wipe token: ${detail}` : 'Failed to get wipe token');
        }
    }, []);

    const handleWipeConfirm = useCallback(async () => {
        if (!wipeToken) return;
        setWipeStatus('Wiping data…');
        try {
            await getSpaCocClient().admin.wipeData({ token: wipeToken, includeWikis });
            setWipeStatus('Data wiped successfully.');
            addToast('Data wiped', 'success');
            setWipeToken(null);
            onDataChanged();
        } catch (err: unknown) {
            setWipeStatus('Wipe failed: ' + getSpaCocClientErrorMessage(err, 'Network error'));
        }
    }, [wipeToken, includeWikis, addToast, onDataChanged]);

    const handleWipeCancel = useCallback(() => {
        setWipeToken(null);
        setWipeStatus('Cancelled.');
    }, []);

    return (
        <>
            <section className="ar-card">
                <div style={{ padding: 4 }}>
                    <Suspense fallback={<div className="ar-section ar-hstack ar-muted"><Spinner size="sm" /> Loading…</div>}>
                        <StorageSection />
                    </Suspense>
                </div>
            </section>

            <section className="ar-card">
                <header className="ar-card-head">
                    <div className="min-w-0 flex-1">
                        <h3>Backup</h3>
                        <p className="ar-card-desc">Export everything as JSON or restore from a previous export.</p>
                    </div>
                </header>
                <div className="ar-card-body">
                    <AdminRow
                        name="Export all data"
                        hint="Includes processes, workspaces, wikis, and preferences. Tokens are not exported."
                    >
                        <button id="admin-export-btn" type="button" className="ar-btn ar-btn-secondary ar-btn-sm" onClick={handleExport}>
                            Export JSON ↓
                        </button>
                        {exportStatus && <span id="admin-export-status" className="ar-muted" style={{ fontSize: 12 }}>{exportStatus}</span>}
                    </AdminRow>
                    <AdminRow
                        name="Import from JSON"
                        hint="Replace wipes existing rows; merge adds and updates only."
                    >
                        <div className="ar-hstack">
                            <AdminSeg<'replace' | 'merge'>
                                value={importMode}
                                onChange={setImportMode}
                                aria-label="Import mode"
                                options={[
                                    { value: 'replace', label: 'Replace', testId: 'import-mode-replace' },
                                    { value: 'merge', label: 'Merge', testId: 'import-mode-merge' },
                                ]}
                            />
                            <input
                                id="admin-import-file"
                                type="file"
                                accept=".json,application/json"
                                className="ar-input"
                                style={{ padding: '4px 8px', fontSize: 12 }}
                                onChange={e => setImportFile(e.target.files?.[0] ?? null)}
                            />
                            <button id="admin-import-preview-btn" type="button" className="ar-btn ar-btn-ghost ar-btn-sm" onClick={handlePreviewImport}>Preview</button>
                            <button id="admin-import-btn" type="button" className="ar-btn ar-btn-primary ar-btn-sm" onClick={handleImport}>Import</button>
                            {importStatus && <span id="admin-import-status" className="ar-muted" style={{ fontSize: 12 }}>{importStatus}</span>}
                        </div>
                    </AdminRow>
                    {importPreview && (
                        <div className="ar-section">
                            <pre id="admin-import-preview" className="ar-pre">{importPreview}</pre>
                        </div>
                    )}
                </div>
            </section>

            <section className="ar-card is-danger">
                <header className="ar-card-head">
                    <div className="min-w-0 flex-1">
                        <h3>Danger Zone</h3>
                        <p className="ar-card-desc">Permanent destructive operations. Always preview before confirming.</p>
                    </div>
                    <div className="ar-badge-row">
                        <span className="ar-badge ar-badge-danger">Irreversible</span>
                    </div>
                </header>
                <div className="ar-card-body">
                    <AdminRow
                        name="Erase everything"
                        hint="Deletes every process, conversation, and workspace. Tokens and preferences are kept."
                    >
                        <label className="ar-hstack" style={{ fontSize: 12, color: 'var(--ar-text-mute)', cursor: 'pointer' }}>
                            <input
                                id="admin-include-wikis"
                                type="checkbox"
                                checked={includeWikis}
                                onChange={e => setIncludeWikis(e.target.checked)}
                                style={{ accentColor: 'var(--ar-danger)' }}
                            />
                            Include wikis
                        </label>
                        <button id="admin-preview-wipe" type="button" className="ar-btn ar-btn-ghost ar-btn-sm" onClick={handlePreviewWipe}>Preview</button>
                        {wipeToken === null ? (
                            <button id="admin-wipe-btn" type="button" className="ar-btn ar-btn-danger-outline ar-btn-sm" onClick={handleWipeStep1}>Wipe Data</button>
                        ) : (
                            <>
                                <button id="admin-wipe-confirm" type="button" className="ar-btn ar-btn-danger ar-btn-sm" onClick={handleWipeConfirm}>Confirm Wipe</button>
                                <button id="admin-wipe-cancel" type="button" className="ar-btn ar-btn-ghost ar-btn-sm" onClick={handleWipeCancel}>Cancel</button>
                            </>
                        )}
                        {wipeStatus && <span id="admin-wipe-status" className="ar-muted" style={{ fontSize: 12 }}>{wipeStatus}</span>}
                    </AdminRow>
                    {wipePreview && (
                        <div className="ar-section">
                            <pre id="admin-wipe-preview" className="ar-pre">{wipePreview}</pre>
                        </div>
                    )}
                </div>
            </section>
        </>
    );
}
