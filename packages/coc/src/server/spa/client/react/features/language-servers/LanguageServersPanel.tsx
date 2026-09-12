/**
 * LanguageServersPanel — workspace settings for language support.
 *
 * Renders the master enable toggle, the effective definition list (presets
 * layered with workspace overrides), and an editor for custom standard LSP
 * definitions. Nothing here is TypeScript-specific: presets arrive from the
 * server like any other definition.
 *
 * A rejected write returns field-level errors anchored on
 * `definitions.<index>.<field>` plus the untouched on-disk config. The editor
 * stays open with those messages attached to their inputs, and the last valid
 * configuration is restored from the echoed config.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LanguageServerDefinition, LanguageServerRuntimeState } from '@plusplusoneplusplus/coc-client';
import { languageServersApi, parseLanguageServerRejection } from './languageServersApi';

interface LanguageServersPanelProps {
    workspaceId: string;
}

/** Editable projection of a definition — list fields become comma-separated text. */
interface DefinitionDraft {
    id: string;
    displayName: string;
    command: string;
    args: string;
    filePatterns: string;
    languageIds: string;
    rootMarkers: string;
    /** Set when editing a definition that already exists in the effective list. */
    originalId: string | null;
    builtIn: boolean;
}

const EMPTY_DRAFT: DefinitionDraft = {
    id: '',
    displayName: '',
    command: '',
    args: '',
    filePatterns: '',
    languageIds: '',
    rootMarkers: '',
    originalId: null,
    builtIn: false,
};

function splitList(value: string): string[] {
    return value.split(',').map(part => part.trim()).filter(part => part.length > 0);
}

function toDraft(def: LanguageServerDefinition): DefinitionDraft {
    return {
        id: def.id,
        displayName: def.displayName,
        command: def.command,
        args: def.args.join(', '),
        filePatterns: def.filePatterns.join(', '),
        languageIds: def.languageIds.join(', '),
        rootMarkers: def.rootMarkers.join(', '),
        originalId: def.id,
        builtIn: !!def.builtIn,
    };
}

function fromDraft(draft: DefinitionDraft, base: LanguageServerDefinition | undefined): LanguageServerDefinition {
    return {
        ...base,
        id: draft.id.trim(),
        displayName: draft.displayName.trim(),
        command: draft.command.trim(),
        args: splitList(draft.args),
        filePatterns: splitList(draft.filePatterns),
        languageIds: splitList(draft.languageIds),
        rootMarkers: splitList(draft.rootMarkers),
        enabled: base?.enabled ?? true,
    };
}

/** Replace the entry with `id`, or append when the workspace has no override yet. */
function upsert(
    definitions: LanguageServerDefinition[],
    id: string | null,
    next: LanguageServerDefinition,
): LanguageServerDefinition[] {
    const index = id === null ? -1 : definitions.findIndex(d => d.id === id);
    if (index < 0) {
        return [...definitions, next];
    }
    const copy = [...definitions];
    copy[index] = next;
    return copy;
}

/** Field errors for the definition submitted at `index`, keyed by field name. */
function fieldErrorsFor(
    rejection: { errors: { field: string; message: string }[] },
    index: number,
): { fields: Record<string, string>; other: string[] } {
    const fields: Record<string, string> = {};
    const other: string[] = [];
    const prefix = `definitions.${index}.`;
    for (const err of rejection.errors) {
        if (err.field.startsWith(prefix)) {
            fields[err.field.slice(prefix.length)] = err.message;
        } else {
            other.push(err.message);
        }
    }
    return { fields, other };
}

const INPUT_CLASS =
    'w-full text-xs font-mono border border-[#e0e0e0] dark:border-[#3c3c3c] rounded px-2 py-1 bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] placeholder-[#999]';

function runtimeSummary(runtimes: LanguageServerRuntimeState[]): string {
    if (runtimes.length === 0) return 'Not started';
    const counts = { ready: 0, starting: 0, setup: 0, failed: 0, notStarted: 0 };
    for (const runtime of runtimes) {
        if (runtime.status === 'ready') counts.ready++;
        else if (runtime.status === 'starting' || runtime.status === 'reconnecting' || runtime.status === 'indexing') counts.starting++;
        else if (runtime.status === 'unavailable') counts.setup++;
        else if (runtime.status === 'failed' || runtime.status === 'timeout') counts.failed++;
        else counts.notStarted++;
    }
    const parts: string[] = [];
    const add = (label: string, count: number) => {
        if (count > 0) parts.push(`${label} in ${count} root${count === 1 ? '' : 's'}`);
    };
    add('Ready', counts.ready);
    add('Starting', counts.starting);
    add('Needs setup', counts.setup);
    add('Failed', counts.failed);
    add('Not started', counts.notStarted);
    return parts.join(' · ') || 'Not started';
}

export function LanguageServersPanel({ workspaceId }: LanguageServersPanelProps) {
    const [enabled, setEnabled] = useState(false);
    const [stored, setStored] = useState<LanguageServerDefinition[]>([]);
    const [effective, setEffective] = useState<LanguageServerDefinition[]>([]);
    const [warnings, setWarnings] = useState<string[]>([]);
    const [runtimes, setRuntimes] = useState<LanguageServerRuntimeState[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [draft, setDraft] = useState<DefinitionDraft | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [expandedServer, setExpandedServer] = useState<string | null>(null);
    const [retrying, setRetrying] = useState<Set<string>>(new Set());

    const applyResponse = useCallback((res: Awaited<ReturnType<typeof languageServersApi.get>>) => {
        setEnabled(res.enabled);
        setStored(res.definitions);
        setEffective(res.effective);
        setWarnings(res.warnings.map(w => w.message));
        setRuntimes(res.runtimes ?? []);
    }, []);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        languageServersApi.get(workspaceId)
            .then(res => {
                if (cancelled) return;
                applyResponse(res);
                setError(null);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : 'Failed to load language-server settings');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [workspaceId, applyResponse]);

    /**
     * Write `definitions`, reporting field errors against `draftIndex` when the
     * server rejects the body. Returns true when the write landed.
     */
    const save = useCallback(async (
        next: { enabled?: boolean; definitions?: LanguageServerDefinition[] },
        draftIndex = -1,
    ): Promise<boolean> => {
        setSaving(true);
        setError(null);
        setFieldErrors({});
        try {
            applyResponse(await languageServersApi.update(workspaceId, next));
            return true;
        } catch (err: unknown) {
            const rejection = parseLanguageServerRejection(err);
            if (rejection) {
                const { fields, other } = fieldErrorsFor(rejection, draftIndex);
                setFieldErrors(fields);
                // The echoed config is the untouched on-disk state, so the panel
                // keeps showing the last valid configuration.
                if (rejection.config) {
                    setEnabled(rejection.config.enabled);
                    setStored(rejection.config.definitions);
                }
                setError(other[0] ?? 'Fix the highlighted fields and save again.');
            } else {
                setError(err instanceof Error ? err.message : 'Failed to save language-server settings');
            }
            return false;
        } finally {
            setSaving(false);
        }
    }, [workspaceId, applyResponse]);

    const toggleSupport = useCallback(() => {
        save({ enabled: !enabled });
    }, [enabled, save]);

    const toggleDefinition = useCallback((def: LanguageServerDefinition) => {
        const next = { ...def, enabled: !(def.enabled ?? false) };
        save({ definitions: upsert(stored, def.id, next) });
    }, [stored, save]);

    const removeDefinition = useCallback((def: LanguageServerDefinition) => {
        save({ definitions: stored.filter(d => d.id !== def.id) });
    }, [stored, save]);

    const startEdit = useCallback((def: LanguageServerDefinition) => {
        setFieldErrors({});
        setError(null);
        setDraft(toDraft(def));
    }, []);

    const startCreate = useCallback(() => {
        setFieldErrors({});
        setError(null);
        setDraft({ ...EMPTY_DRAFT });
    }, []);

    const submitDraft = useCallback(async () => {
        if (!draft) return;
        const base = effective.find(d => d.id === draft.originalId);
        const next = upsert(stored, draft.originalId, fromDraft(draft, base));
        const index = next.findIndex(d => d.id === draft.id.trim());
        if (await save({ definitions: next }, index)) {
            setDraft(null);
        }
    }, [draft, effective, stored, save]);

    const storedIds = useMemo(() => new Set(stored.map(d => d.id)), [stored]);
    const runtimesByDefinition = useMemo(() => {
        const grouped = new Map<string, LanguageServerRuntimeState[]>();
        for (const runtime of runtimes) {
            const existing = grouped.get(runtime.definitionId) ?? [];
            const duplicate = existing.findIndex(item => item.projectRoot === runtime.projectRoot);
            if (duplicate < 0) existing.push(runtime);
            else if ((runtime.lastAttemptAt ?? '') > (existing[duplicate].lastAttemptAt ?? '')) existing[duplicate] = runtime;
            grouped.set(runtime.definitionId, existing);
        }
        return grouped;
    }, [runtimes]);

    const retryRuntime = useCallback(async (runtime: LanguageServerRuntimeState) => {
        setRetrying(current => new Set(current).add(runtime.sessionId));
        setError(null);
        try {
            applyResponse(await languageServersApi.retry(workspaceId, runtime.sessionId));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to retry language server');
        } finally {
            setRetrying(current => {
                const next = new Set(current);
                next.delete(runtime.sessionId);
                return next;
            });
        }
    }, [applyResponse, workspaceId]);

    if (loading) {
        return <div className="text-xs text-[#848484]" data-testid="language-servers-loading">Loading…</div>;
    }

    return (
        <div data-testid="language-servers-section">
            <label className="flex items-center gap-2 mb-3 text-xs text-[#1e1e1e] dark:text-[#cccccc]">
                <input
                    type="checkbox"
                    checked={enabled}
                    disabled={saving}
                    onChange={toggleSupport}
                    data-testid="language-support-toggle"
                />
                <span className="font-medium">Enable language support</span>
            </label>
            <div className="text-[10px] text-[#848484] mb-4">
                Language servers start on demand after you open a matching file in this workspace.
            </div>

            {warnings.map(message => (
                <div key={message} className="text-xs text-[#bf8700] dark:text-[#d29922] mb-2" data-testid="language-servers-warning">{message}</div>
            ))}

            <div className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc] mb-1.5">Servers</div>
            {effective.length === 0 ? (
                <div className="text-xs text-[#848484] mb-2" data-testid="no-language-servers">No language servers configured.</div>
            ) : (
                <div className="flex flex-col gap-1.5 mb-3">
                    {effective.map(def => {
                        const serverRuntimes = runtimesByDefinition.get(def.id) ?? [];
                        const hasFailure = serverRuntimes.some(runtime =>
                            runtime.status === 'unavailable' || runtime.status === 'failed' || runtime.status === 'timeout'
                        );
                        const expanded = expandedServer === def.id;
                        return (
                        <div
                            key={def.id}
                            className="px-2 py-1.5 text-xs border border-[#e0e0e0] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e]"
                            data-testid="language-server-row"
                            data-server-id={def.id}
                        >
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={def.enabled ?? false}
                                    disabled={saving}
                                    onChange={() => toggleDefinition(def)}
                                    aria-label={`Enable ${def.displayName}`}
                                    data-testid="language-server-enabled"
                                />
                                <span className="flex-1 min-w-0">
                                    <span className="text-[#1e1e1e] dark:text-[#cccccc]">{def.displayName}</span>
                                    <span className="block truncate font-mono text-[10px] text-[#848484]">
                                        {[def.command, ...def.args].join(' ')} · {def.filePatterns.join(' ')}
                                    </span>
                                </span>
                                <button
                                    type="button"
                                    className={hasFailure ? 'text-[#cc3333] dark:text-[#f48771]' : 'text-[#848484]'}
                                    onClick={() => hasFailure && setExpandedServer(expanded ? null : def.id)}
                                    data-testid="language-server-runtime-status"
                                    aria-expanded={hasFailure ? expanded : undefined}
                                >
                                    {runtimeSummary(serverRuntimes)}
                                </button>
                                {def.builtIn && (
                                    <span className="text-[10px] bg-[#f0f0f0] dark:bg-[#3c3c3c] text-[#848484] rounded px-1" data-testid="built-in-badge">preset</span>
                                )}
                                <button
                                    className="text-[#0078d4] hover:underline px-1"
                                    disabled={saving}
                                    onClick={() => startEdit(def)}
                                    data-testid="edit-server-btn"
                                >Edit</button>
                                {!def.builtIn && storedIds.has(def.id) && (
                                    <button
                                        className="text-[#cc3333] hover:text-red-700 px-1"
                                        title="Remove"
                                        disabled={saving}
                                        onClick={() => removeDefinition(def)}
                                        data-testid="remove-server-btn"
                                    >✕</button>
                                )}
                            </div>
                            {expanded && hasFailure && (
                                <div className="mt-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c] pt-2" data-testid="language-server-runtime-details">
                                    {serverRuntimes.filter(runtime =>
                                        runtime.status === 'unavailable' || runtime.status === 'failed' || runtime.status === 'timeout'
                                    ).map(runtime => (
                                        <div key={runtime.sessionId} className="mb-2 last:mb-0">
                                            <div className="font-medium">{runtime.projectRoot}</div>
                                            {runtime.lastAttemptAt && <div className="text-[10px] text-[#848484]">Last attempt: {new Date(runtime.lastAttemptAt).toLocaleString()}</div>}
                                            {runtime.runtime && <div className="text-[10px] text-[#848484]">{runtime.runtime}</div>}
                                            {runtime.detail && <div className="my-1">{runtime.detail}</div>}
                                            {runtime.recoveryCommand && (
                                                <div className="flex items-center gap-2 mb-1">
                                                    <code className="rounded bg-black/5 dark:bg-white/10 px-1.5 py-0.5">{runtime.recoveryCommand}</code>
                                                    <button
                                                        type="button"
                                                        className="text-[#0078d4] hover:underline"
                                                        onClick={() => { void navigator.clipboard?.writeText(runtime.recoveryCommand!); }}
                                                        data-testid="language-server-copy-command"
                                                    >Copy command</button>
                                                </div>
                                            )}
                                            <button
                                                type="button"
                                                className="text-[#0078d4] hover:underline disabled:opacity-50"
                                                disabled={retrying.has(runtime.sessionId) || runtime.status === 'starting' || runtime.status === 'reconnecting'}
                                                onClick={() => { void retryRuntime(runtime); }}
                                                data-testid="language-server-retry"
                                            >{retrying.has(runtime.sessionId) ? 'Retrying…' : 'Retry'}</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );})}
                </div>
            )}

            {draft === null ? (
                <button
                    className="text-xs px-2 py-1 rounded border border-[#0078d4] text-[#0078d4] hover:bg-[#0078d4] hover:text-white"
                    disabled={saving}
                    onClick={startCreate}
                    data-testid="add-server-btn"
                >+ Add server</button>
            ) : (
                <div className="flex flex-col gap-2 p-2 border border-[#e0e0e0] dark:border-[#3c3c3c] rounded" data-testid="server-editor">
                    {([
                        ['id', 'ID', 'my-language-server'],
                        ['displayName', 'Display name', 'My Language Server'],
                        ['command', 'Command', 'my-language-server'],
                        ['args', 'Arguments (comma separated)', '--stdio'],
                        ['filePatterns', 'File patterns (comma separated)', '**/*.my'],
                        ['languageIds', 'Language IDs (comma separated)', 'mylang'],
                        ['rootMarkers', 'Root markers (comma separated)', 'mylang.json'],
                    ] as const).map(([field, label, placeholder]) => (
                        <div key={field}>
                            <div className="text-[10px] text-[#848484] mb-0.5">{label}</div>
                            <input
                                type="text"
                                className={INPUT_CLASS}
                                value={draft[field]}
                                placeholder={placeholder}
                                disabled={saving || (field === 'id' && draft.builtIn)}
                                onChange={e => setDraft({ ...draft, [field]: e.target.value })}
                                aria-label={label}
                                data-testid={`server-field-${field}`}
                            />
                            {fieldErrors[field] && (
                                <div className="text-[10px] text-[#cc3333] mt-0.5" data-testid={`server-field-error-${field}`}>{fieldErrors[field]}</div>
                            )}
                        </div>
                    ))}
                    <div className="flex items-center gap-2">
                        <button
                            className="text-xs px-2 py-1 rounded border border-[#0078d4] text-[#0078d4] hover:bg-[#0078d4] hover:text-white"
                            disabled={saving}
                            onClick={submitDraft}
                            data-testid="save-server-btn"
                        >Save</button>
                        <button
                            className="text-xs px-2 py-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] text-[#848484]"
                            disabled={saving}
                            onClick={() => { setDraft(null); setFieldErrors({}); }}
                            data-testid="cancel-server-btn"
                        >Cancel</button>
                    </div>
                </div>
            )}

            {error && (
                <div className="text-xs text-[#cc3333] mt-2" data-testid="language-servers-error">{error}</div>
            )}
        </div>
    );
}
