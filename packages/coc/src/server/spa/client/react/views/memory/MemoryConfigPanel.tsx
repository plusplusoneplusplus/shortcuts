/**
 * MemoryConfigPanel — view and save memory storage configuration.
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../../utils/config';
import { Button, Card, Spinner } from '../../shared';
import { ExploreCachePanel } from './ExploreCachePanel';

interface MemoryConfig {
    storageDir: string;
    backend: 'file' | 'sqlite' | 'vector';
    maxEntries: number;
    ttlDays: number;
    autoInject: boolean;
    recording: { enabled: boolean };
}

export function MemoryConfigPanel() {
    const [config, setConfig] = useState<MemoryConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    // Local edit state
    const [storageDir, setStorageDir] = useState('');
    const [backend, setBackend] = useState<MemoryConfig['backend']>('file');
    const [maxEntries, setMaxEntries] = useState(10000);
    const [ttlDays, setTtlDays] = useState(90);
    const [autoInject, setAutoInject] = useState(false);
    const [recordingEnabled, setRecordingEnabled] = useState(false);

    const fetchConfig = useCallback(() => {
        setLoading(true);
        setError(null);
        fetch(`${getApiBase()}/memory/config`)
            .then(r => r.json())
            .then((data: MemoryConfig) => {
                setConfig(data);
                setStorageDir(data.storageDir);
                setBackend(data.backend);
                setMaxEntries(data.maxEntries);
                setTtlDays(data.ttlDays);
                setAutoInject(data.autoInject);
                setRecordingEnabled(data.recording?.enabled ?? false);
            })
            .catch(err => {
                setError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        fetchConfig();
    }, [fetchConfig]);

    const handleSave = async () => {
        setSaving(true);
        setSaveError(null);
        setSaved(false);
        try {
            const body: MemoryConfig = {
                storageDir,
                backend,
                maxEntries: Math.max(1, Math.floor(maxEntries)),
                ttlDays: Math.max(0, Math.floor(ttlDays)),
                autoInject,
                recording: { enabled: recordingEnabled },
            };
            const res = await fetch(`${getApiBase()}/memory/config`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const updated: MemoryConfig = await res.json();
            setConfig(updated);
            // Reflect server-resolved values (e.g. ~ expansion)
            setStorageDir(updated.storageDir);
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="flex justify-center py-8"><Spinner /></div>;
    }

    if (error) {
        return <p className="p-4 text-sm text-red-500">{error}</p>;
    }

    return (
        <div className="p-4 max-w-xl space-y-4">
            <Card className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Memory Configuration</span>
                    <Button variant="ghost" size="sm" onClick={fetchConfig} disabled={loading} title="Refresh Memory Config" data-testid="memory-config-refresh-btn">
                        <span className={loading ? 'inline-block animate-spin' : 'inline-block'}>↻</span> Refresh
                    </Button>
                </div>
                {/* Storage location */}
                <div className="space-y-1">
                    <label className="block text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                        Storage directory
                    </label>
                    <input
                        type="text"
                        value={storageDir}
                        onChange={e => setStorageDir(e.target.value)}
                        placeholder="~/.coc/memory"
                        className="w-full h-8 px-3 text-sm border border-[#c8c8c8] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]"
                    />
                    {config && config.storageDir !== storageDir && (
                        <p className="text-[11px] text-[#888]">
                            Current saved: {config.storageDir}
                        </p>
                    )}
                </div>

                {/* Backend type */}
                <div className="space-y-1">
                    <label className="block text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                        Storage backend
                    </label>
                    <select
                        value={backend}
                        onChange={e => setBackend(e.target.value as MemoryConfig['backend'])}
                        className="w-full h-8 px-3 text-sm border border-[#c8c8c8] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]"
                    >
                        <option value="file">File (JSON files)</option>
                        <option value="sqlite">SQLite (single database file)</option>
                        <option value="vector">Vector (semantic search)</option>
                    </select>
                </div>

                {/* Retention policy */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                        <label className="block text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                            Max entries
                        </label>
                        <input
                            type="number"
                            min={1}
                            value={maxEntries}
                            onChange={e => setMaxEntries(Number(e.target.value))}
                            className="w-full h-8 px-3 text-sm border border-[#c8c8c8] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="block text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                            TTL (days, 0 = no limit)
                        </label>
                        <input
                            type="number"
                            min={0}
                            value={ttlDays}
                            onChange={e => setTtlDays(Number(e.target.value))}
                            className="w-full h-8 px-3 text-sm border border-[#c8c8c8] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]"
                        />
                    </div>
                </div>

                {/* Auto-inject toggle */}
                <div className="flex items-center gap-3">
                    <input
                        id="auto-inject"
                        type="checkbox"
                        checked={autoInject}
                        onChange={e => setAutoInject(e.target.checked)}
                        className="h-4 w-4 rounded border-[#c8c8c8] text-[#0078d4]"
                    />
                    <label htmlFor="auto-inject" className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">
                        Auto-inject relevant memories into AI prompts
                    </label>
                </div>

                {/* Conversation Recording */}
                <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] pt-4 space-y-2">
                    <p className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                        Conversation Recording
                    </p>
                    <div className="flex items-center gap-3">
                        <input
                            id="recording-enabled"
                            type="checkbox"
                            checked={recordingEnabled}
                            onChange={e => setRecordingEnabled(e.target.checked)}
                            className="h-4 w-4 rounded border-[#c8c8c8] text-[#0078d4]"
                            data-testid="recording-enabled-checkbox"
                        />
                        <label htmlFor="recording-enabled" className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">
                            Record messages I send in conversations
                        </label>
                    </div>
                    <p className="text-[11px] text-[#848484] ml-7">
                        Saves your input text to the repo memory feed automatically.
                    </p>
                </div>

                {/* Save button + feedback */}
                <div className="flex items-center gap-3 pt-1">
                    <Button onClick={handleSave} disabled={saving} data-testid="memory-config-save-btn">
                        {saving ? 'Saving…' : 'Save'}
                    </Button>
                    {saved && <span className="text-sm text-green-600 dark:text-green-400" data-testid="memory-config-saved-toast">Saved!</span>}
                    {saveError && <span className="text-sm text-red-500">{saveError}</span>}
                </div>
            </Card>
            <ExploreCachePanel />
        </div>
    );
}
