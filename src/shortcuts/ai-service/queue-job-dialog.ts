/**
 * Queue Job Dialog HTML Generation
 *
 * Generates the webview HTML content for the Queue AI Job dialog.
 * Used by QueueJobDialogService in queue-job-dialog-service.ts.
 */

import * as vscode from 'vscode';
import { getSharedDialogCSS } from '../shared/webview/dialog-styles';
import { WebviewSetupHelper } from '../shared/webview/webview-setup-helper';

// Re-export the service class for backward compatibility
export { QueueJobDialogService } from './queue-job-dialog-service';

// ============================================================================
// Types
// ============================================================================

/** Mode of queue job creation */
export type QueueJobMode = 'prompt' | 'skill';

/** Priority for queued jobs */
export type QueueJobPriority = 'high' | 'normal' | 'low';

/** Result from the queue job dialog */
export interface QueueJobDialogResult {
    /** Whether the user cancelled the dialog */
    cancelled: boolean;
    /** Options if not cancelled */
    options: QueueJobOptions | null;
}

/** Options collected from the dialog */
export interface QueueJobOptions {
    /** Which tab was active */
    mode: QueueJobMode;
    /** Freeform prompt (prompt mode) */
    prompt?: string;
    /** Selected skill name (skill mode) */
    skillName?: string;
    /** Additional context (skill mode) */
    additionalContext?: string;
    /** AI model to use */
    model: string;
    /** Job priority */
    priority: QueueJobPriority;
    /** Working directory for execution */
    workingDirectory?: string;
}

// ============================================================================
// HTML Generation
// ============================================================================

/**
 * Generate the webview HTML content for the Queue Job dialog
 */
export function getQueueJobDialogHtml(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    models: Array<{ id: string; label: string; description?: string; isDefault?: boolean }>,
    defaultModel: string,
    skills: string[],
    workspaceRoot: string,
    initialMode?: QueueJobMode
): string {
    const nonce = WebviewSetupHelper.generateNonce();
    const stylesUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'styles', 'components.css')
    );

    const modelsJson = JSON.stringify(models);
    const defaultModelJson = JSON.stringify(defaultModel);
    const skillsJson = JSON.stringify(skills);
    const initialModeJson = JSON.stringify(initialMode || 'prompt');
    const workspaceRootJson = JSON.stringify(workspaceRoot);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link href="${stylesUri}" rel="stylesheet">
    <title>Queue AI Job</title>
    <style nonce="${nonce}">
        ${getSharedDialogCSS()}
    </style>
</head>
<body>
    <div class="dialog-container">
        <div class="dialog-header">
            <h2><span class="icon">📋</span> Queue AI Job</h2>
            <button class="dialog-close-btn" id="closeBtn" title="Cancel">×</button>
        </div>
        
        <div class="mode-tabs">
            <button class="mode-tab active" id="tabPrompt" data-mode="prompt">
                <span class="tab-icon">💬</span>
                Prompt
            </button>
            <button class="mode-tab" id="tabSkill" data-mode="skill" ${skills.length === 0 ? 'disabled title="No skills found in .github/skills/"' : ''}>
                <span class="tab-icon">🛠️</span>
                Skill
            </button>
        </div>
        
        <div class="dialog-body">
            <!-- Prompt Mode Content -->
            <div class="mode-content active" id="promptContent">
                <div class="form-group" id="promptGroup">
                    <label for="jobPrompt">Prompt <span class="required">*</span></label>
                    <textarea id="jobPrompt" placeholder="Describe what you want the AI to do..." rows="5"></textarea>
                    <div class="hint">The full prompt to send to the AI</div>
                    <div class="error" id="promptError"></div>
                </div>
            </div>
            
            <!-- Skill Mode Content -->
            <div class="mode-content" id="skillContent">
                ${skills.length === 0 ? `
                <div class="form-group">
                    <div class="hint" style="padding: 16px; background: var(--vscode-inputValidation-warningBackground, rgba(255, 204, 0, 0.1)); border: 1px solid var(--vscode-inputValidation-warningBorder, #cca700); border-radius: 4px; font-size: 12px; color: var(--vscode-foreground, #cccccc);">
                        No skills found. Add skill directories to <code>.github/skills/</code> to use this mode.
                    </div>
                </div>
                ` : `
                <div class="form-group" id="skillGroup">
                    <label for="skillSelect">Skill <span class="required">*</span></label>
                    <select id="skillSelect">
                        <option value="">-- Select a skill --</option>
                    </select>
                    <div class="hint">Select a skill from .github/skills/</div>
                    <div class="error" id="skillError"></div>
                </div>
                
                <div class="form-group">
                    <label for="skillContext">Additional Context <span class="optional">(Optional)</span></label>
                    <textarea id="skillContext" placeholder="Provide any additional instructions or context for the skill..." rows="3"></textarea>
                    <div class="hint">Extra context or instructions to pass along with the skill</div>
                </div>
                `}
            </div>
            
            <hr class="form-divider" />
            
            <!-- Shared Fields -->
            <div class="form-group">
                <label for="aiModel">AI Model</label>
                <select id="aiModel">
                    <!-- Populated by JavaScript -->
                </select>
            </div>
            
            <div class="form-group">
                <label>Priority</label>
                <div class="radio-options">
                    <label class="radio-option" id="priorityHigh">
                        <input type="radio" name="priority" value="high" />
                        <div class="radio-option-content">
                            <div class="radio-option-title">🔴 High</div>
                            <div class="radio-option-desc">Execute before normal and low priority tasks</div>
                        </div>
                    </label>
                    <label class="radio-option selected" id="priorityNormal">
                        <input type="radio" name="priority" value="normal" checked />
                        <div class="radio-option-content">
                            <div class="radio-option-title">🟡 Normal</div>
                            <div class="radio-option-desc">Standard execution order</div>
                        </div>
                    </label>
                    <label class="radio-option" id="priorityLow">
                        <input type="radio" name="priority" value="low" />
                        <div class="radio-option-content">
                            <div class="radio-option-title">🟢 Low</div>
                            <div class="radio-option-desc">Execute after higher priority tasks</div>
                        </div>
                    </label>
                </div>
            </div>
            
            <div class="form-group">
                <label for="workingDir">Working Directory <span class="optional">(Optional)</span></label>
                <input type="text" id="workingDir" placeholder="${WebviewSetupHelper.escapeHtml(workspaceRoot) || 'Workspace root'}" />
                <div class="hint">Working directory for AI execution (defaults to workspace root)</div>
            </div>
        </div>
        
        <div class="dialog-footer">
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
            <button class="btn btn-primary" id="submitBtn">Queue Job</button>
        </div>
    </div>
    
    <script nonce="${nonce}">
        (function() {
            const vscode = acquireVsCodeApi();
            
            // Data from extension
            const models = ${modelsJson};
            const defaultModel = ${defaultModelJson};
            const skills = ${skillsJson};
            const initialMode = ${initialModeJson};
            const workspaceRoot = ${workspaceRootJson};
            const hasSkills = skills.length > 0;
            
            // Current mode
            let currentMode = initialMode;
            
            // DOM elements - Tabs
            const tabPrompt = document.getElementById('tabPrompt');
            const tabSkill = document.getElementById('tabSkill');
            const promptContent = document.getElementById('promptContent');
            const skillContent = document.getElementById('skillContent');
            
            // DOM elements - Prompt mode
            const jobPromptInput = document.getElementById('jobPrompt');
            const promptGroup = document.getElementById('promptGroup');
            const promptError = document.getElementById('promptError');
            
            // DOM elements - Skill mode
            const skillSelect = document.getElementById('skillSelect');
            const skillGroup = document.getElementById('skillGroup');
            const skillError = document.getElementById('skillError');
            const skillContextInput = document.getElementById('skillContext');
            
            // DOM elements - Shared
            const aiModelSelect = document.getElementById('aiModel');
            const workingDirInput = document.getElementById('workingDir');
            const priorityHigh = document.getElementById('priorityHigh');
            const priorityNormal = document.getElementById('priorityNormal');
            const priorityLow = document.getElementById('priorityLow');
            
            // DOM elements - Buttons
            const submitBtn = document.getElementById('submitBtn');
            const cancelBtn = document.getElementById('cancelBtn');
            const closeBtn = document.getElementById('closeBtn');
            
            // Populate skill dropdown
            if (hasSkills && skillSelect) {
                skills.forEach(function(skill) {
                    const option = document.createElement('option');
                    option.value = skill;
                    option.textContent = skill;
                    skillSelect.appendChild(option);
                });
            }
            
            // Populate model dropdown
            models.forEach(function(model) {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = model.label + (model.description ? ' ' + model.description : '');
                if (model.id === defaultModel) {
                    option.selected = true;
                }
                aiModelSelect.appendChild(option);
            });
            
            // Priority radio selection
            var priorityOptions = [priorityHigh, priorityNormal, priorityLow];
            priorityOptions.forEach(function(opt) {
                if (!opt) return;
                opt.addEventListener('click', function() {
                    priorityOptions.forEach(function(o) { if (o) o.classList.remove('selected'); });
                    opt.classList.add('selected');
                    opt.querySelector('input').checked = true;
                });
            });
            
            // Tab switching
            function switchMode(mode) {
                currentMode = mode;
                
                tabPrompt.classList.toggle('active', mode === 'prompt');
                tabSkill.classList.toggle('active', mode === 'skill');
                
                promptContent.classList.toggle('active', mode === 'prompt');
                skillContent.classList.toggle('active', mode === 'skill');
                
                updateValidation();
                
                if (mode === 'prompt') {
                    setTimeout(function() { jobPromptInput.focus(); }, 100);
                } else if (skillSelect) {
                    setTimeout(function() { skillSelect.focus(); }, 100);
                }
            }
            
            tabPrompt.addEventListener('click', function() { switchMode('prompt'); });
            tabSkill.addEventListener('click', function() {
                if (hasSkills) {
                    switchMode('skill');
                }
            });
            
            // Validation
            function updateValidation() {
                if (currentMode === 'prompt') {
                    var value = jobPromptInput.value.trim();
                    if (value.length === 0) {
                        if (promptGroup) promptGroup.classList.add('has-error');
                        if (promptError) promptError.textContent = 'Prompt cannot be empty';
                        submitBtn.disabled = true;
                    } else {
                        if (promptGroup) promptGroup.classList.remove('has-error');
                        if (promptError) promptError.textContent = '';
                        submitBtn.disabled = false;
                    }
                } else {
                    if (skillSelect && skillGroup && skillError) {
                        if (!skillSelect.value) {
                            skillGroup.classList.add('has-error');
                            skillError.textContent = 'Please select a skill';
                            submitBtn.disabled = true;
                        } else {
                            skillGroup.classList.remove('has-error');
                            skillError.textContent = '';
                            submitBtn.disabled = false;
                        }
                    } else {
                        submitBtn.disabled = !hasSkills;
                    }
                }
            }
            
            // Event listeners for validation
            jobPromptInput.addEventListener('input', updateValidation);
            if (skillSelect) {
                skillSelect.addEventListener('change', updateValidation);
            }
            
            // Submit
            submitBtn.addEventListener('click', function() {
                if (currentMode === 'prompt') {
                    var prompt = jobPromptInput.value.trim();
                    if (!prompt) {
                        updateValidation();
                        jobPromptInput.focus();
                        return;
                    }
                    
                    vscode.postMessage({
                        type: 'submit',
                        mode: 'prompt',
                        prompt: prompt,
                        model: aiModelSelect.value,
                        priority: document.querySelector('input[name="priority"]:checked').value,
                        workingDirectory: workingDirInput.value.trim()
                    });
                } else {
                    if (skillSelect && !skillSelect.value) {
                        updateValidation();
                        skillSelect.focus();
                        return;
                    }
                    
                    vscode.postMessage({
                        type: 'submit',
                        mode: 'skill',
                        skillName: skillSelect ? skillSelect.value : '',
                        additionalContext: skillContextInput ? skillContextInput.value.trim() : '',
                        model: aiModelSelect.value,
                        priority: document.querySelector('input[name="priority"]:checked').value,
                        workingDirectory: workingDirInput.value.trim()
                    });
                }
            });
            
            // Cancel
            cancelBtn.addEventListener('click', function() {
                vscode.postMessage({ type: 'cancel' });
            });
            
            closeBtn.addEventListener('click', function() {
                vscode.postMessage({ type: 'cancel' });
            });
            
            // Keyboard shortcuts
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    vscode.postMessage({ type: 'cancel' });
                }
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    submitBtn.click();
                }
            });
            
            // Initialize
            if (initialMode === 'skill' && hasSkills) {
                switchMode('skill');
            } else {
                switchMode('prompt');
            }
            
            // Set initial focus
            setTimeout(function() {
                if (currentMode === 'prompt') {
                    jobPromptInput.focus();
                } else if (skillSelect) {
                    skillSelect.focus();
                }
            }, 100);
        })();
    </script>
</body>
</html>`;
}
