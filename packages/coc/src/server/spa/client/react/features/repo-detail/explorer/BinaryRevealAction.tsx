/**
 * BinaryRevealAction — the "Open in Explorer" button under a binary file's
 * placeholder (`features.binaryFileReveal`).
 *
 * It only asks the file's owning server to reveal the repo-relative path in its
 * OS file manager through `explorerApi.reveal` — the same route the Explorer
 * tree's "Reveal in File Explorer" uses. It never opens or runs the file. Paths
 * the reveal route cannot address (trusted absolute paths, workspace previews)
 * get a disabled button rather than a request.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { resolveCloneRoute } from '../../../repos/cloneRegistry';
import { explorerApi } from './explorerApi';

export interface BinaryRevealActionProps {
    repoId: string;
    routingRef?: string | null;
    /** Repo-relative path, exactly as the blob was read. */
    path: string;
    /** False when the reveal route cannot address this path. */
    available: boolean;
}

function FolderRevealIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
            <path d="M1 4a1 1 0 0 1 1-1h3l1 1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4z" />
        </svg>
    );
}

export function BinaryRevealAction({ repoId, routingRef, path, available }: BinaryRevealActionProps) {
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<{ message: string; error: boolean } | null>(null);
    const unavailableId = useId();
    const live = useRef(true);
    useEffect(() => {
        live.current = true;
        return () => { live.current = false; };
    }, []);

    const reveal = async () => {
        setBusy(true);
        setResult(null);
        const remote = resolveCloneRoute(routingRef === undefined ? repoId : routingRef).kind !== 'local';
        try {
            await (routingRef === undefined
                ? explorerApi.reveal(repoId, path)
                : explorerApi.reveal(repoId, path, routingRef));
            if (live.current) {
                setResult({
                    message: remote ? 'Shown in the file manager on the remote server.' : 'Shown in the system file manager.',
                    error: false,
                });
            }
        } catch (err) {
            if (live.current) {
                setResult({
                    message: `Could not open in Explorer: ${err instanceof Error ? err.message : String(err)}`,
                    error: true,
                });
            }
        } finally {
            if (live.current) setBusy(false);
        }
    };

    return (
        <div className="flex flex-col items-center gap-1" data-testid="preview-binary-reveal">
            <button
                type="button"
                onClick={reveal}
                disabled={!available || busy}
                title={available ? 'Show this file in the system file manager' : undefined}
                aria-describedby={available ? undefined : unavailableId}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-white dark:bg-[#2d2d2d] border border-[#c8c8c8] dark:border-[#555] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f0f0f0] dark:hover:bg-[#3c3c3c] disabled:opacity-50 disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0078d4]"
                data-testid="preview-binary-reveal-btn"
            >
                <FolderRevealIcon />
                {busy ? 'Opening…' : 'Open in Explorer'}
            </button>
            {!available && (
                <span id={unavailableId} className="text-xs" data-testid="preview-binary-reveal-unavailable">
                    Only files inside the workspace can be opened in Explorer.
                </span>
            )}
            {result && (
                <span
                    role={result.error ? 'alert' : 'status'}
                    className={`text-xs ${result.error ? 'text-[#d32f2f] dark:text-[#f48771]' : ''}`}
                    data-testid="preview-binary-reveal-result"
                >
                    {result.message}
                </span>
            )}
        </div>
    );
}
