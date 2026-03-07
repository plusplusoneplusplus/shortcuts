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
    /** Working directory for execution */
    workingDirectory?: string;
    /** Skills selected via /slash-commands in prompt mode */
    selectedSkills?: string[];
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

        .skill-chips-container {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin-top: 4px;
        }
        .skill-chips-container:empty {
            display: none;
        }
        .skill-chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
            background: var(--vscode-badge-background, #4d4d4d);
            color: var(--vscode-badge-foreground, #ffffff);
            cursor: default;
            user-select: none;
        }
        .skill-chip .chip-icon {
            font-size: 10px;
        }
        .skill-chip .chip-remove {
            cursor: pointer;
            opacity: 0.7;
            font-size: 12px;
            line-height: 1;
            margin-left: 2px;
        }
        .skill-chip .chip-remove:hover {
            opacity: 1;
        }
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
                    <textarea id="jobPrompt" placeholder="Describe what you want the AI to do... (type /skill-name to attach a skill)" rows="5"></textarea>
                    <div id="skillChipsContainer" class="skill-chips-container"></div>
                    <div class="hint">The full prompt to send to the AI. Use /skill-name to attach skills.</div>
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
                <label for="workingDir">Working Directory <span class="optional">(Optional)</span></label>
                <input type="text" id="workingDir" placeholder="${WebviewSetupHelper.escapeHtml(workspaceRoot) || 'Workspace root'}" />
                <div class="hint">Working directory for AI execution (defaults to workspace root)</div>
            </div>
        </div>
        
        <div class="dialog-footer">
            <button class="btn btn-secondary" id="loadTemplateBtn" title="Load from a saved template">$(bookmark) Load from Saved</button>
            <span style="flex: 1;"></span>
            <button class="btn btn-secondary" id="saveTemplateBtn" title="Save current configuration as a reusable template">$(bookmark) Save as Template</button>
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
            const skillChipsContainer = document.getElementById('skillChipsContainer');
            
            // Track skills detected via /slash-commands in prompt
            var detectedSkills = [];
            
            // DOM elements - Skill mode
            const skillSelect = document.getElementById('skillSelect');
            const skillGroup = document.getElementById('skillGroup');
            const skillError = document.getElementById('skillError');
            const skillContextInput = document.getElementById('skillContext');
            
            // DOM elements - Shared
            const aiModelSelect = document.getElementById('aiModel');
            const workingDirInput = document.getElementById('workingDir');
            
            // DOM elements - Buttons
            const submitBtn = document.getElementById('submitBtn');
            const cancelBtn = document.getElementById('cancelBtn');
            const closeBtn = document.getElementById('closeBtn');
            const saveTemplateBtn = document.getElementById('saveTemplateBtn');
            const loadTemplateBtn = document.getElementById('loadTemplateBtn');
            
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
            
            // Skill chip detection from /slash-commands in prompt
            function findSlashSkills(text) {
                var found = [];
                if (!hasSkills) return found;
                var regex = /(?:^|\s)\/([\w-]+)/g;
                var match;
                while ((match = regex.exec(text)) !== null) {
                    var name = match[1];
                    if (skills.indexOf(name) !== -1 && found.indexOf(name) === -1) {
                        found.push(name);
                    }
                }
                return found;
            }

            function renderSkillChips() {
                if (!skillChipsContainer) return;
                skillChipsContainer.innerHTML = '';
                detectedSkills.forEach(function(skill) {
                    var chip = document.createElement('span');
                    chip.className = 'skill-chip';
                    chip.setAttribute('data-skill', skill);
                    chip.innerHTML = '<span class="chip-icon">🛠️</span>' +
                        '<span class="chip-name">' + skill + '</span>' +
                        '<span class="chip-remove" title="Remove skill">×</span>';
                    chip.querySelector('.chip-remove').addEventListener('click', function() {
                        removeSlashSkill(skill);
                    });
                    skillChipsContainer.appendChild(chip);
                });
            }

            function updateSkillChips() {
                var text = jobPromptInput.value;
                detectedSkills = findSlashSkills(text);
                renderSkillChips();
            }

            function removeSlashSkill(skill) {
                var text = jobPromptInput.value;
                // Remove the /skill-name from the prompt text
                var regex = new RegExp('(^|\\s)\\/' + skill.replace(/[-]/g, '\\-') + '(?=\\s|$)', 'g');
                jobPromptInput.value = text.replace(regex, '$1').replace(/^\s+/, '');
                updateSkillChips();
                updateValidation();
            }

            // Event listeners for validation
            jobPromptInput.addEventListener('input', function() {
                updateSkillChips();
                updateValidation();
            });
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
                        selectedSkills: detectedSkills.slice(),
                        model: aiModelSelect.value,
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
            
            // Save as Template
            if (saveTemplateBtn) {
                saveTemplateBtn.addEventListener('click', function() {
                    if (currentMode === 'prompt') {
                        var prompt = jobPromptInput.value.trim();
                        if (!prompt) {
                            updateValidation();
                            jobPromptInput.focus();
                            return;
                        }
                        vscode.postMessage({
                            type: 'saveAsTemplate',
                            mode: 'prompt',
                            prompt: prompt,
                            selectedSkills: detectedSkills.slice(),
                            model: aiModelSelect.value,
                            workingDirectory: workingDirInput.value.trim()
                        });
                    } else {
                        if (skillSelect && !skillSelect.value) {
                            updateValidation();
                            skillSelect.focus();
                            return;
                        }
                        vscode.postMessage({
                            type: 'saveAsTemplate',
                            mode: 'skill',
                            skillName: skillSelect ? skillSelect.value : '',
                            prompt: skillContextInput ? skillContextInput.value.trim() : '',
                            model: aiModelSelect.value,
                            workingDirectory: workingDirInput.value.trim()
                        });
                    }
                });
            }
            
            // Load from Saved Templates
            if (loadTemplateBtn) {
                loadTemplateBtn.addEventListener('click', function() {
                    vscode.postMessage({ type: 'loadTemplate' });
                });
            }
            
            // Handle messages from extension
            window.addEventListener('message', function(event) {
                var message = event.data;
                if (message && message.type === 'templateSaved') {
                    // Could show a brief notification in the webview
                    // For now, the extension handles the notification
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
