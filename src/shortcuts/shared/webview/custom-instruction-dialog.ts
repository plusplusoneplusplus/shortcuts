/**
 * Shared Custom Instruction Dialog
 * 
 * Dialog component for entering custom AI instructions.
 * Used by both markdown review editor and git diff review editor.
 */

import {
    AICommandMode,
    CustomInstructionDialogCallbacks,
    CustomInstructionDialogConfig
} from './context-menu-types';

/**
 * Default dialog configuration
 */
const DEFAULT_DIALOG_CONFIG: CustomInstructionDialogConfig = {
    title: '🤖 Custom AI Instruction',
    placeholder: "Enter your instruction for the AI (e.g., 'Explain the security implications')",
    submitLabel: 'Ask AI',
    cancelLabel: 'Cancel'
};

/**
 * Custom Instruction Dialog Manager
 * 
 * Manages the custom instruction dialog for AI commands that require user input.
 */
export class CustomInstructionDialog {
    private config: CustomInstructionDialogConfig;
    private callbacks: CustomInstructionDialogCallbacks;

    // DOM element references
    private dialog: HTMLElement | null = null;
    private closeButton: HTMLElement | null = null;
    private selectionPreview: HTMLElement | null = null;
    private inputTextarea: HTMLTextAreaElement | null = null;
    private cancelButton: HTMLElement | null = null;
    private submitButton: HTMLElement | null = null;
    private overlay: HTMLElement | null = null;

    // State
    private pendingCommandId: string = 'custom';
    private pendingCommandMode: AICommandMode = 'comment';
    private selectedText: string = '';
    private isInitialized: boolean = false;
    private pendingPromptFilePath: string | undefined = undefined;
    private pendingSkillName: string | undefined = undefined;
    private titleElement: HTMLElement | null = null;

    constructor(
        config: CustomInstructionDialogConfig = DEFAULT_DIALOG_CONFIG,
        callbacks: CustomInstructionDialogCallbacks
    ) {
        this.config = { ...DEFAULT_DIALOG_CONFIG, ...config };
        this.callbacks = callbacks;
    }

    /**
     * Initialize the dialog manager
     * Finds DOM elements and sets up event listeners
     */
    init(): void {
        if (this.isInitialized) return;

        this.findElements();
        this.setupEventListeners();
        this.isInitialized = true;
    }

    /**
     * Find and cache DOM element references
     */
    private findElements(): void {
        this.dialog = document.getElementById('customInstructionDialog') ||
            document.getElementById('custom-instruction-dialog');
        this.closeButton = document.getElementById('customInstructionClose') ||
            document.getElementById('custom-instruction-close');
        this.selectionPreview = document.getElementById('customInstructionSelection') ||
            document.getElementById('custom-instruction-selection');
        this.inputTextarea = (document.getElementById('customInstructionInput') ||
            document.getElementById('custom-instruction-input')) as HTMLTextAreaElement;
        this.cancelButton = document.getElementById('customInstructionCancelBtn') ||
            document.getElementById('custom-instruction-cancel');
        this.submitButton = document.getElementById('customInstructionSubmitBtn') ||
            document.getElementById('custom-instruction-submit');
        this.titleElement = this.dialog?.querySelector('.custom-instruction-title') || null;
    }

    /**
     * Setup event listeners for dialog controls
     */
    private setupEventListeners(): void {
        // Close button
        this.closeButton?.addEventListener('click', () => this.hide());

        // Cancel button
        this.cancelButton?.addEventListener('click', () => this.hide());

        // Submit button
        this.submitButton?.addEventListener('click', () => this.handleSubmit());

        // Keyboard shortcuts in textarea
        this.inputTextarea?.addEventListener('keydown', (e) => {
            // Ctrl+Enter or Cmd+Enter to submit
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                this.handleSubmit();
            }
            // Escape to close
            if (e.key === 'Escape') {
                this.hide();
            }
        });
    }

    /**
     * Show the dialog with the given context
     * @param selectedText - The text that was selected when the dialog was triggered
     * @param commandId - The AI command ID that will be used
     * @param mode - The AI command mode ('comment' or 'interactive')
     */
    show(selectedText: string, commandId: string = 'custom', mode: AICommandMode = 'comment'): void {
        if (!this.dialog) {
            console.error('Custom instruction dialog not found');
            return;
        }

        this.selectedText = selectedText;
        this.pendingCommandId = commandId;
        this.pendingCommandMode = mode;
        
        // Reset prompt file and skill state (these may be set later via setPromptFilePath/setSkillName)
        this.pendingPromptFilePath = undefined;
        this.pendingSkillName = undefined;

        // Reset title to default
        if (this.titleElement) {
            this.titleElement.textContent = this.config.title || '🤖 Custom AI Instruction';
        }

        // Create and show overlay
        this.createOverlay();

        // Show selected text preview (truncated if needed)
        if (this.selectionPreview) {
            const truncatedText = selectedText.length > 100
                ? selectedText.substring(0, 100) + '...'
                : selectedText;
            this.selectionPreview.textContent = truncatedText;
        }

        // Clear previous input
        if (this.inputTextarea) {
            this.inputTextarea.value = '';
        }

        // Show dialog
        this.dialog.style.display = 'block';
        this.dialog.classList.remove('hidden');

        // Focus the input after a short delay
        setTimeout(() => this.inputTextarea?.focus(), 50);
    }

    /**
     * Hide the dialog
     */
    hide(): void {
        if (this.dialog) {
            this.dialog.style.display = 'none';
            this.dialog.classList.add('hidden');
        }

        this.removeOverlay();
        this.callbacks.onCancel?.();
    }

    /**
     * Check if the dialog is currently visible
     */
    isVisible(): boolean {
        return this.dialog !== null && this.dialog.style.display !== 'none';
    }

    /**
     * Handle submit button click
     */
    private handleSubmit(): void {
        const instruction = this.inputTextarea?.value.trim();

        if (!instruction) {
            // Focus input if empty
            this.inputTextarea?.focus();
            return;
        }

        // Capture prompt file and skill info before hiding (which may reset them)
        const promptFilePath = this.pendingPromptFilePath;
        const skillName = this.pendingSkillName;

        // Hide dialog and call callback with all context
        this.hide();
        this.callbacks.onSubmit(instruction, this.pendingCommandId, this.pendingCommandMode, promptFilePath, skillName);
    }

    /**
     * Create overlay element
     */
    private createOverlay(): void {
        this.removeOverlay();

        this.overlay = document.createElement('div');
        this.overlay.className = 'custom-instruction-overlay';
        this.overlay.addEventListener('click', () => this.hide());
        document.body.appendChild(this.overlay);
    }

    /**
     * Remove overlay element
     */
    private removeOverlay(): void {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
    }

    /**
     * Get the current selected text
     */
    getSelectedText(): string {
        return this.selectedText;
    }

    /**
     * Get the pending command ID
     */
    getPendingCommandId(): string {
        return this.pendingCommandId;
    }

    /**
     * Get the pending command mode
     */
    getPendingCommandMode(): AICommandMode {
        return this.pendingCommandMode;
    }

    /**
     * Update the dialog title
     */
    updateTitle(title: string): void {
        if (this.titleElement) {
            this.titleElement.textContent = title;
        }
    }

    /**
     * Set the prompt file path for this request
     */
    setPromptFilePath(path: string | undefined): void {
        this.pendingPromptFilePath = path;
    }

    /**
     * Get the pending prompt file path
     */
    getPromptFilePath(): string | undefined {
        return this.pendingPromptFilePath;
    }

    /**
     * Set the skill name for this request
     */
    setSkillName(skillName: string | undefined): void {
        this.pendingSkillName = skillName;
    }

    /**
     * Get the pending skill name
     */
    getSkillName(): string | undefined {
        return this.pendingSkillName;
    }
}
