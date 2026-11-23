import type { ContextMenuItem } from '../../../tasks/comments/ContextMenu';
import { ToastContainer, useToast } from '../../../ui/Toast';
import { copyToClipboard } from '../../../utils/format';

/** Copies changed-file paths with shared toast and screen-reader feedback. */
export function useCopyChangedFilePath() {
    const { toasts, addToast, removeToast } = useToast();
    function copy(path: string) {
        void copyToClipboard(path).then(
            () => addToast('Path copied.', 'success'),
            () => addToast('Failed to copy file path.', 'error'),
        );
    }
    /** The caller supplies the row's repository-relative path, without display prefixes. */
    function menuItem(path: string): ContextMenuItem {
        return {
            label: 'Copy path', icon: '📋', title: `Copy repository-relative path: ${path}`,
            onClick: () => copy(path.replace(/\\/g, '/')),
        };
    }
    /** Icon button that copies `path` exactly as given (the full, untruncated header path). */
    function button(path: string, testId?: string) {
        return <button type="button" onClick={() => copy(path)} title={`Copy path: ${path}`} aria-label="Copy file path"
            className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-[#848484] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#0078d4]"
            data-testid={testId}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15V5a1 1 0 0 1 1-1h10" />
            </svg>
        </button>;
    }
    return { menuItem, button, feedback: <><ToastContainer toasts={toasts} removeToast={removeToast} />
        <span role={toasts.length ? 'status' : undefined} aria-live="polite" className="sr-only">{toasts.map(toast => toast.message).join(' ')}</span></> };
}
