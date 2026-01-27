/**
 * Update Document Dialog Handler
 * 
 * Manages the modal dialog for document-level AI instructions.
 * The user enters a message describing changes they want to make,
 * which is then sent to an interactive AI session with the full document context.
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
 * Initialize the Update Document dialog handlers
 */
export function initUpdateDocumentDialog(): void {
    const dialog = document.getElementById('updateDocumentDialog');
    const closeBtn = document.getElementById('udCloseBtn');
    const cancelBtn = document.getElementById('udCancelBtn');
    const submitBtn = document.getElementById('udSubmitBtn');
    const instructionInput = document.getElementById('udInstruction') as HTMLTextAreaElement;

    if (!dialog || !closeBtn || !cancelBtn || !submitBtn || !instructionInput) {
        console.warn('[UpdateDocumentDialog] Dialog elements not found');
        return;
    }

    // Close button handler
    closeBtn.addEventListener('click', () => closeDialog());
    
    // Cancel button handler
    cancelBtn.addEventListener('click', () => closeDialog());
    
    // Submit button handler
    submitBtn.addEventListener('click', () => {
        const instruction = instructionInput.value.trim();
        if (instruction) {
            submitInstruction(instruction);
        }
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
    instructionInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            const instruction = instructionInput.value.trim();
            if (instruction) {
                submitInstruction(instruction);
            }
        }
    });
    
    console.log('[UpdateDocumentDialog] Initialized');
}

/**
 * Show the Update Document dialog
 */
export function showUpdateDocumentDialog(): void {
    const dialog = document.getElementById('updateDocumentDialog');
    const instructionInput = document.getElementById('udInstruction') as HTMLTextAreaElement;

    if (!dialog || !instructionInput) {
        console.error('[UpdateDocumentDialog] Required elements not found');
        return;
    }

    // Update dialog state
    dialogState = {
        isOpen: true
    };

    // Clear previous instruction
    instructionInput.value = '';

    // Show dialog
    dialog.style.display = 'flex';

    // Focus the instruction input
    setTimeout(() => instructionInput.focus(), 50);

    console.log('[UpdateDocumentDialog] Shown');
}

/**
 * Close the dialog
 */
function closeDialog(): void {
    const dialog = document.getElementById('updateDocumentDialog');
    if (dialog) {
        dialog.style.display = 'none';
    }

    // Reset dialog state
    dialogState = {
        isOpen: false
    };

    console.log('[UpdateDocumentDialog] Closed');
}

/**
 * Submit the instruction to the extension
 */
function submitInstruction(instruction: string): void {
    // Send message to extension
    try {
        state.vscode.postMessage({
            type: 'updateDocument',
            instruction
        });
        console.log('[UpdateDocumentDialog] Sent instruction:', instruction.substring(0, 50) + '...');
    } catch (e) {
        console.error('[UpdateDocumentDialog] Failed to send message:', e);
    }

    // Close the dialog
    closeDialog();
}

/**
 * Check if dialog is currently open
 */
export function isUpdateDocumentDialogOpen(): boolean {
    return dialogState.isOpen;
}
