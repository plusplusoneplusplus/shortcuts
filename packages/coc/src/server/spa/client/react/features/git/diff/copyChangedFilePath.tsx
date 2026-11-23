import type { ContextMenuItem } from '../../../tasks/comments/ContextMenu';
import { ToastContainer, useToast } from '../../../ui/Toast';
import { copyToClipboard } from '../../../utils/format';

/** The caller supplies the row's repository-relative path, without display prefixes. */
export function useCopyChangedFilePath() {
    const { toasts, addToast, removeToast } = useToast();
    function menuItem(path: string): ContextMenuItem {
        return {
            label: 'Copy path', icon: '📋', title: `Copy repository-relative path: ${path}`,
            onClick: () => {
                void copyToClipboard(path.replace(/\\/g, '/')).then(
                    () => addToast('Path copied.', 'success'),
                    () => addToast('Failed to copy file path.', 'error'),
                );
            },
        };
    }
    return { menuItem, feedback: <><ToastContainer toasts={toasts} removeToast={removeToast} />
        <span role={toasts.length ? 'status' : undefined} aria-live="polite" className="sr-only">{toasts.map(toast => toast.message).join(' ')}</span></> };
}
