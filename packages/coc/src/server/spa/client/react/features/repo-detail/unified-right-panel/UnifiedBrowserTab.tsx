import { useEffect, useState } from 'react';
import { normalizeBrowserUrl } from './unifiedBrowserTabs';

export interface UnifiedBrowserTabProps {
    tabId: string;
    /** The tab's current URL; absent for a blank tab. */
    url?: string;
    /** Record a new URL (and its provisional label) on the tab descriptor. */
    onNavigate: (id: string, url: string) => void;
}

const toolbarButton = 'rounded px-2 py-1 hover:bg-[#e8e8e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007acc] disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-[#37373d]';

/**
 * A general web browser tab. The address field accepts an http(s) URL or a
 * bare domain; anything else is rejected inline and never searched.
 */
export function UnifiedBrowserTab({ tabId, url, onNavigate }: UnifiedBrowserTabProps) {
    const [address, setAddress] = useState(url ?? '');
    const [error, setError] = useState<string | null>(null);

    // The page's own navigation moves the address unless the user is editing.
    useEffect(() => {
        setAddress(url ?? '');
        setError(null);
    }, [url]);

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        const result = normalizeBrowserUrl(address);
        if (!result.ok) {
            setError(result.reason);
            return;
        }
        setError(null);
        setAddress(result.url);
        onNavigate(tabId, result.url);
    };

    const openExternal = () => {
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-white text-[#1f1f1f] dark:bg-[#1e1e1e] dark:text-[#cccccc]">
            <form
                className="flex flex-shrink-0 items-center gap-1 border-b border-[#e5e5e5] px-2 py-1 text-xs dark:border-[#333]"
                onSubmit={submit}
            >
                <input
                    type="text"
                    value={address}
                    onChange={event => { setAddress(event.target.value); setError(null); }}
                    placeholder="Enter a URL"
                    aria-label="Address"
                    aria-invalid={error !== null}
                    spellCheck={false}
                    autoFocus={!url}
                    className="min-w-0 flex-1 rounded border border-[#c8c8c8] bg-transparent px-2 py-1 outline-none focus:border-[#007acc] dark:border-[#3c3c3c]"
                    data-testid="browser-address"
                />
                <button
                    className={toolbarButton}
                    type="button"
                    disabled={!url}
                    onClick={openExternal}
                    data-testid="browser-open-external"
                >
                    Open in system browser
                </button>
            </form>
            {error && (
                <div role="alert" className="px-3 py-1.5 text-[11px] text-[#a1260d] dark:text-[#f48771]" data-testid="browser-address-error">
                    {error}
                </div>
            )}
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-xs text-[#616161] dark:text-[#9d9d9d]" data-testid="browser-web-fallback">
                {url ? (
                    <>
                        <p>Embedded browsing is available in the CoC desktop app.</p>
                        <button className={toolbarButton} type="button" onClick={openExternal}>
                            Open {url} in system browser
                        </button>
                    </>
                ) : (
                    <p>Enter a web address above.</p>
                )}
            </div>
        </div>
    );
}
