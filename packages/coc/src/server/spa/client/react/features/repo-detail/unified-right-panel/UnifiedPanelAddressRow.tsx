import { useState, type ReactNode, type RefObject } from 'react';
import { BrowserAddressBar } from './BrowserAddressBar';
import { nativeViewToolbar } from './NativeViewTab';
import { parseCocAddress, type CocAddress } from './unifiedPanelAddresses';

/**
 * The `coc://` address row under the tab strip (`features.panelAddressBar`).
 * It shows the active tab's address and opens or focuses the tab a typed
 * address names; the owner always comes from the panel, never the text.
 */
export function UnifiedPanelAddressRow({ inputRef, address, ownerKey, ownerLabel, enabled, onOpenAddress, trailing }: {
    inputRef: RefObject<HTMLInputElement>;
    /** The active tab's address. */
    address: string;
    /** The active tab's identity; a change drops any draft. */
    ownerKey: string;
    /** Shown when the tab's owner is not the panel scope (a group member, a remote clone). */
    ownerLabel?: string;
    enabled: boolean;
    /** Open or focus the addressed tab; a string is an inline error. */
    onOpenAddress(address: CocAddress): string | void;
    trailing?: ReactNode;
}) {
    const [error, setError] = useState<string | null>(null);
    const [prevKey, setPrevKey] = useState(ownerKey);
    if (prevKey !== ownerKey) {
        setPrevKey(ownerKey);
        setError(null);
    }
    const open = (text: string): string | void => {
        if (text.trim() === address) return address;
        const parsed = parseCocAddress(text);
        const failure = 'error' in parsed ? parsed.error : onOpenAddress(parsed);
        setError(failure || null);
        // Success shows the current address until the opened tab reports its own.
        if (!failure) return address;
    };
    return (
        <div className={`flex min-w-0 flex-col ${nativeViewToolbar}`} data-testid="unified-panel-address-row">
            <div className="flex min-w-0 items-center gap-1.5">
                <BrowserAddressBar
                    inputRef={inputRef}
                    url={address}
                    enabled={enabled}
                    ownerKey={ownerKey}
                    invalid={error !== null}
                    onEdit={() => setError(null)}
                    onOpen={open}
                    restoreOnEscape
                    placeholder="Enter a coc:// address"
                    leading={ownerLabel ? (
                        <span
                            className="ml-0.5 max-w-[40%] flex-shrink-0 truncate rounded-full bg-[#e8e8e8] px-2 py-0.5 text-[11px] text-[#424242] dark:bg-[#37373d] dark:text-[#c5c5c5]"
                            title={ownerLabel}
                            data-testid="unified-panel-address-owner"
                        >
                            {ownerLabel}
                        </span>
                    ) : undefined}
                />
                {trailing}
            </div>
            {error && (
                <div role="alert" className="px-1 pt-1 text-[11px] text-[#a1260d] dark:text-[#f48771]" data-testid="unified-panel-address-error">
                    {error}
                </div>
            )}
        </div>
    );
}
