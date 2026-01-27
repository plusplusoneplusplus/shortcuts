/**
 * Follow Prompt Dialog Handler
 * 
 * Manages the modal dialog for Follow Prompt execution options
 * (execution mode and AI model selection).
 */

import { state } from './state';
import { AIModelOption, FollowPromptDialogOptions } from './types';

/** Current dialog state */
interface DialogState {
    isOpen: boolean;
    promptFilePath: string;
    promptName: string;
    skillName?: string;
    resolve?: (options: FollowPromptDialogOptions | null) => void;
}

let dialogState: DialogState = {
    isOpen: false,
    promptFilePath: '',
    promptName: ''
};

/**
 * Initialize the Follow Prompt dialog handlers
 */
export function initFollowPromptDialog(): void {
    const dialog = document.getElementById('followPromptDialog');
    const closeBtn = document.getElementById('fpCloseBtn');
    const cancelBtn = document.getElementById('fpCancelBtn');
    const executeBtn = document.getElementById('fpExecuteBtn');

    if (!dialog || !closeBtn || !cancelBtn || !executeBtn) {
        console.warn('[FollowPromptDialog] Dialog elements not found');
        return;
    }

    // Close button handler
    closeBtn.addEventListener('click', () => closeDialog(null));
    
    // Cancel button handler
    cancelBtn.addEventListener('click', () => closeDialog(null));
    
    // Execute button handler
    executeBtn.addEventListener('click', () => {
        const options = getDialogOptions();
        closeDialog(options);
    });
    
    // Close on overlay click (outside dialog)
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) {
            closeDialog(null);
        }
    });
    
    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dialogState.isOpen) {
            closeDialog(null);
        }
    });
    
    // Execute on Ctrl+Enter
    const contextInput = document.getElementById('fpAdditionalContext') as HTMLTextAreaElement;
    if (contextInput) {
        contextInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                const options = getDialogOptions();
                closeDialog(options);
            }
        });
    }
    
    console.log('[FollowPromptDialog] Initialized');
}

/**
 * Show the Follow Prompt dialog
 */
export function showFollowPromptDialog(
    promptName: string,
    promptFilePath: string,
    skillName: string | undefined,
    availableModels: AIModelOption[],
    defaults: { mode: 'interactive' | 'background'; model: string }
): void {
    const dialog = document.getElementById('followPromptDialog');
    const promptNameEl = document.getElementById('fpPromptName');
    const contextInput = document.getElementById('fpAdditionalContext') as HTMLTextAreaElement;
    const modelSelect = document.getElementById('fpModelSelect') as HTMLSelectElement;

    if (!dialog || !promptNameEl || !contextInput || !modelSelect) {
        console.error('[FollowPromptDialog] Required elements not found');
        return;
    }

    // Update dialog state
    dialogState = {
        isOpen: true,
        promptFilePath,
        promptName,
        skillName
    };

    // Set prompt name (show skill name if applicable)
    promptNameEl.textContent = skillName ? `Skill: ${skillName}` : promptName;

    // Clear additional context
    contextInput.value = '';

    // Set default execution mode
    const interactiveRadio = document.querySelector('input[name="fpMode"][value="interactive"]') as HTMLInputElement;
    const backgroundRadio = document.querySelector('input[name="fpMode"][value="background"]') as HTMLInputElement;
    if (interactiveRadio && backgroundRadio) {
        if (defaults.mode === 'background') {
            backgroundRadio.checked = true;
        } else {
            interactiveRadio.checked = true;
        }
    }

    // Populate model select
    modelSelect.innerHTML = '';
    for (const model of availableModels) {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.label + (model.description ? ` ${model.description}` : '');
        if (model.id === defaults.model) {
            option.selected = true;
        }
        modelSelect.appendChild(option);
    }

    // Show dialog
    dialog.style.display = 'flex';

    // Focus the context input
    setTimeout(() => contextInput.focus(), 50);

    console.log('[FollowPromptDialog] Shown for:', promptName);
}

/**
 * Close the dialog and send result to extension
 */
function closeDialog(options: FollowPromptDialogOptions | null): void {
    const dialog = document.getElementById('followPromptDialog');
    if (dialog) {
        dialog.style.display = 'none';
    }

    if (options) {
        // Send result to extension
        try {
            state.vscode.postMessage({
                type: 'followPromptDialogResult',
                promptFilePath: dialogState.promptFilePath,
                skillName: dialogState.skillName,
                options
            });
        } catch (e) {
            console.error('[FollowPromptDialog] Failed to send message:', e);
        }
    }

    // Reset dialog state
    dialogState = {
        isOpen: false,
        promptFilePath: '',
        promptName: ''
    };

    console.log('[FollowPromptDialog] Closed', options ? 'with options' : 'cancelled');
}

/**
 * Get current dialog options
 */
function getDialogOptions(): FollowPromptDialogOptions {
    const contextInput = document.getElementById('fpAdditionalContext') as HTMLTextAreaElement;
    const modelSelect = document.getElementById('fpModelSelect') as HTMLSelectElement;
    const modeRadio = document.querySelector('input[name="fpMode"]:checked') as HTMLInputElement;

    return {
        mode: (modeRadio?.value === 'background' ? 'background' : 'interactive') as 'interactive' | 'background',
        model: modelSelect?.value || 'claude-sonnet-4.5',
        additionalContext: contextInput?.value?.trim() || undefined
    };
}

/**
 * Check if dialog is currently open
 */
export function isDialogOpen(): boolean {
    return dialogState.isOpen;
}
