/**
 * Refresh Plan Dialog Handler
 * 
 * Manages the modal dialog for refreshing/regenerating plan documents.
 * The user can optionally provide additional context or background information
 * to help AI understand what has changed in the codebase.
 */

import { state } from './state';

/** Current dialog state */
interface DialogState {
    isOpen: boolean;
}

let dialogState: DialogState = {
    isOpen: false
};

/**
 * Initialize the Refresh Plan dialog handlers
 */
export function initRefreshPlanDialog(): void {
    const dialog = document.getElementById('refreshPlanDialog');
    const closeBtn = document.getElementById('rpCloseBtn');
    const cancelBtn = document.getElementById('rpCancelBtn');
    const submitBtn = document.getElementById('rpSubmitBtn');
    const contextInput = document.getElementById('rpContext') as HTMLTextAreaElement;

    if (!dialog || !closeBtn || !cancelBtn || !submitBtn || !contextInput) {
        console.warn('[RefreshPlanDialog] Dialog elements not found');
        return;
    }

    // Close button handler
    closeBtn.addEventListener('click', () => closeDialog());
    
    // Cancel button handler
    cancelBtn.addEventListener('click', () => closeDialog());
    
    // Submit button handler
    submitBtn.addEventListener('click', () => {
        // Context is optional, so we can submit even if empty
        const context = contextInput.value.trim();
        submitRefreshPlan(context);
    });
    
    // Close on overlay click (outside dialog)
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) {
            closeDialog();
        }
    });
    
    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dialogState.isOpen) {
            closeDialog();
        }
    });
    
    // Submit on Ctrl+Enter
    contextInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            const context = contextInput.value.trim();
            submitRefreshPlan(context);
        }
    });
    
    console.log('[RefreshPlanDialog] Initialized');
}

/**
 * Show the Refresh Plan dialog
 */
export function showRefreshPlanDialog(): void {
    const dialog = document.getElementById('refreshPlanDialog');
    const contextInput = document.getElementById('rpContext') as HTMLTextAreaElement;

    if (!dialog || !contextInput) {
        console.error('[RefreshPlanDialog] Required elements not found');
        return;
    }

    // Update dialog state
    dialogState = {
        isOpen: true
    };

    // Clear previous context
    contextInput.value = '';

    // Show dialog
    dialog.style.display = 'flex';

    // Focus the context input
    setTimeout(() => contextInput.focus(), 50);

    console.log('[RefreshPlanDialog] Shown');
}

/**
 * Close the dialog
 */
function closeDialog(): void {
    const dialog = document.getElementById('refreshPlanDialog');
    if (dialog) {
        dialog.style.display = 'none';
    }

    // Reset dialog state
    dialogState = {
        isOpen: false
    };

    console.log('[RefreshPlanDialog] Closed');
}

/**
 * Submit the refresh plan request to the extension
 * @param additionalContext - Optional additional context from user
 */
function submitRefreshPlan(additionalContext: string): void {
    // Send message to extension
    try {
        state.vscode.postMessage({
            type: 'refreshPlan',
            additionalContext: additionalContext || undefined
        });
        console.log('[RefreshPlanDialog] Sent refresh plan request', additionalContext ? `with context: ${additionalContext.substring(0, 50)}...` : 'without additional context');
    } catch (e) {
        console.error('[RefreshPlanDialog] Failed to send message:', e);
    }

    // Close the dialog
    closeDialog();
}

/**
 * Check if dialog is currently open
 */
export function isRefreshPlanDialogOpen(): boolean {
    return dialogState.isOpen;
}
