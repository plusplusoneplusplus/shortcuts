/**
 * PreviewPane — renders file content using Monaco Editor for code files,
 * with image display, binary/empty file handling, and save support.
 *
 * Fetches blob content from the API and supports loading/error/retry states.
 * Cancels in-flight requests when the file path changes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchApi } from '../../hooks/useApi';
import { Spinner, Button } from '../../shared';
import { MonacoFileEditor, getMonacoLanguage } from './MonacoFileEditor';

export interface PreviewPaneProps {
    repoId: string;
    /** Relative path from repo root, e.g. "src/index.ts" */
    filePath: string;
    /** File name for language detection, e.g. "index.ts" */
    fileName: string;
    /** Called when the user clicks the close button */
    onClose?: () => void;
}

interface BlobResponse {
    content: string;
    encoding: 'utf-8' | 'base64';
    mimeType: string;
}

const MAX_PREVIEW_SIZE = 512 * 1024; // 512 KB

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} bytes`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Breadcrumb-style path header with close button and optional save controls. */
function PathHeader({ filePath, fileName, onClose, isDirty, isSaving, onSave }: {
    filePath: string;
    fileName: string;
    onClose?: () => void;
    isDirty?: boolean;
    isSaving?: boolean;
    onSave?: () => void;
}) {
    const segments = filePath.split('/');
    return (
        <div
            className="flex items-center gap-1 px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526] min-h-[36px]"
            data-testid="preview-header"
        >
            <div className="flex-1 flex items-center gap-1 text-xs font-mono text-[#616161] dark:text-[#999] overflow-hidden">
                {segments.map((seg, i) => (
                    <span key={i} className="flex items-center gap-1 min-w-0">
                        {i > 0 && <span className="text-[#848484] flex-shrink-0">/</span>}
                        <span className={i === segments.length - 1 ? 'font-semibold text-[#1e1e1e] dark:text-[#cccccc] truncate' : 'truncate'}>
                            {seg}
                        </span>
                    </span>
                ))}
                {isDirty && (
                    <span className="ml-1 w-2 h-2 rounded-full bg-[#f59e0b] flex-shrink-0" title="Unsaved changes" data-testid="dirty-indicator" />
                )}
            </div>
            {isDirty && onSave && (
                <button
                    className="flex-shrink-0 text-xs px-2 py-0.5 rounded bg-[#0078d4] text-white hover:bg-[#106ebe] disabled:opacity-50 transition-colors"
                    onClick={onSave}
                    disabled={isSaving}
                    data-testid="save-btn"
                >
                    {isSaving ? 'Saving…' : 'Save'}
                </button>
            )}
            {onClose && (
                <button
                    className="flex-shrink-0 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-sm px-1 transition-colors"
                    onClick={onClose}
                    title="Close preview"
                    data-testid="preview-close-btn"
                >
                    ×
                </button>
            )}
        </div>
    );
}

export function PreviewPane({ repoId, filePath, fileName, onClose }: PreviewPaneProps) {
    const [blob, setBlob] = useState<BlobResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editedContent, setEditedContent] = useState<string>('');
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveFlash, setSaveFlash] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    // Fetch blob on mount or path change; cancel in-flight on change
    useEffect(() => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);
        setError(null);
        setBlob(null);
        setIsDirty(false);
        setEditedContent('');

        fetchApi(
            `/repos/${encodeURIComponent(repoId)}/blob?path=${encodeURIComponent(filePath)}`,
            { signal: controller.signal },
        )
            .then((data: BlobResponse) => {
                if (!controller.signal.aborted) {
                    setBlob(data);
                    if (data.encoding === 'utf-8') {
                        setEditedContent(data.content);
                    }
                }
            })
            .catch((err: Error) => {
                if (!controller.signal.aborted) {
                    setError(err.message || 'Failed to load file');
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });

        return () => controller.abort();
    }, [repoId, filePath]);

    const doRetry = () => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setLoading(true);
        setError(null);
        setBlob(null);
        setIsDirty(false);
        setEditedContent('');
        fetchApi(
            `/repos/${encodeURIComponent(repoId)}/blob?path=${encodeURIComponent(filePath)}`,
            { signal: controller.signal },
        )
            .then((data: BlobResponse) => {
                if (!controller.signal.aborted) {
                    setBlob(data);
                    if (data.encoding === 'utf-8') {
                        setEditedContent(data.content);
                    }
                }
            })
            .catch((err: Error) => {
                if (!controller.signal.aborted) {
                    setError(err.message || 'Failed to load file');
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
    };

    const handleEditorChange = useCallback((value: string) => {
        setEditedContent(value);
        setIsDirty(true);
    }, []);

    const handleSave = useCallback(async () => {
        setIsSaving(true);
        try {
            await fetchApi(
                `/repos/${encodeURIComponent(repoId)}/blob?path=${encodeURIComponent(filePath)}`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: editedContent }),
                },
            );
            setIsDirty(false);
            setSaveFlash(true);
            setTimeout(() => setSaveFlash(false), 1500);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setIsSaving(false);
        }
    }, [repoId, filePath, editedContent]);

    const isImage = blob?.encoding === 'base64' && blob.mimeType.startsWith('image/');
    const isBinary = blob?.encoding === 'base64' && !isImage;
    const isOversized = blob?.encoding === 'utf-8' && blob.content.length > MAX_PREVIEW_SIZE;

    const displayContent = useMemo(() => {
        if (!blob || blob.encoding !== 'utf-8') return '';
        if (isOversized) return blob.content.slice(0, MAX_PREVIEW_SIZE);
        return blob.content;
    }, [blob, isOversized]);

    const monacoLanguage = useMemo(
        () => getMonacoLanguage(fileName),
        [fileName],
    );

    // Show Monaco for text files
    const showMonaco = blob && blob.encoding === 'utf-8' && blob.content !== '';

    return (
        <div className="flex flex-col h-full overflow-hidden" data-testid="preview-pane">
            <PathHeader
                filePath={filePath}
                fileName={fileName}
                onClose={onClose}
                isDirty={isDirty}
                isSaving={isSaving}
                onSave={showMonaco ? handleSave : undefined}
            />

            <div className="flex-1 overflow-hidden" data-testid="preview-body">
                {loading ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-xs text-[#848484]" data-testid="preview-loading">
                        <Spinner size="sm" /> Loading {fileName}…
                    </div>
                ) : error ? (
                    <div className="flex items-center gap-2 px-4 py-4" data-testid="preview-error">
                        <span className="text-xs text-[#d32f2f] dark:text-[#f48771]">{error}</span>
                        <Button variant="secondary" size="sm" onClick={doRetry} data-testid="preview-retry-btn">Retry</Button>
                    </div>
                ) : blob && blob.encoding === 'utf-8' && blob.content === '' ? (
                    <div className="flex items-center justify-center py-8 text-sm text-[#848484] italic" data-testid="preview-empty">
                        (empty file)
                    </div>
                ) : isImage ? (
                    <div className="flex items-center justify-center p-4" data-testid="preview-image">
                        <img
                            src={`data:${blob!.mimeType};base64,${blob!.content}`}
                            alt={fileName}
                            className="max-w-full max-h-[80vh] object-contain"
                        />
                    </div>
                ) : isBinary ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-8 text-sm text-[#848484]" data-testid="preview-binary">
                        <span className="text-2xl">📄</span>
                        <span>Binary file — {formatFileSize(blob!.content.length)} bytes</span>
                    </div>
                ) : showMonaco ? (
                    <div className="h-full flex flex-col">
                        {isOversized && (
                            <div className="px-4 py-2 bg-[#fff3cd] dark:bg-[#664d03] text-xs text-[#856404] dark:text-[#ffc107]" data-testid="preview-truncated-banner">
                                File too large to preview (showing first 512 KB)
                            </div>
                        )}
                        {saveFlash && (
                            <div className="px-4 py-1 bg-[#d4edda] dark:bg-[#155724] text-xs text-[#155724] dark:text-[#d4edda]" data-testid="save-flash">
                                Saved
                            </div>
                        )}
                        <div className="flex-1" data-testid="monaco-container">
                            <MonacoFileEditor
                                value={isOversized ? displayContent : editedContent}
                                language={monacoLanguage}
                                onChange={handleEditorChange}
                                onSave={handleSave}
                            />
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
