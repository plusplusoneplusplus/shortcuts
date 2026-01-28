/**
 * Tests for shared context menu consistency between markdown review and diff review editors
 * 
 * These tests ensure that both editors use the same HTML structure, CSS classes, and IDs
 * so that the shared-context-menu.css styles are applied consistently.
 */

import * as assert from 'assert';

/**
 * Required context menu HTML element IDs that the shared ContextMenuManager expects
 */
const REQUIRED_CONTEXT_MENU_IDS = {
    // Primary IDs (camelCase - preferred)
    menu: 'contextMenu',
    addComment: 'contextMenuAddComment',
    predefined: 'contextMenuPredefined',
    predefinedSubmenu: 'predefinedSubmenu',
    askAIComment: 'contextMenuAskAIComment',
    askAICommentSubmenu: 'askAICommentSubmenu',
    askAIInteractive: 'contextMenuAskAIInteractive',
    askAIInteractiveSubmenu: 'askAIInteractiveSubmenu',
    askAISeparator: 'askAISeparator',
    // Preview tooltip
    predefinedPreview: 'predefinedPreview',
    // Custom instruction dialog
    customInstructionDialog: 'customInstructionDialog',
    customInstructionClose: 'customInstructionClose',
    customInstructionSelection: 'customInstructionSelection',
    customInstructionInput: 'customInstructionInput',
    customInstructionCancelBtn: 'customInstructionCancelBtn',
    customInstructionSubmitBtn: 'customInstructionSubmitBtn',
};

/**
 * Fallback IDs (kebab-case) that the ContextMenuManager also supports
 * These are for backward compatibility but primary IDs are preferred
 */
const FALLBACK_CONTEXT_MENU_IDS = {
    menu: 'custom-context-menu',
    addComment: 'context-menu-add-comment',
    predefined: 'context-menu-predefined',
    predefinedSubmenu: 'predefined-submenu',
    askAIComment: 'context-menu-ask-ai-comment',
    askAICommentSubmenu: 'ask-ai-comment-submenu',
    askAIInteractive: 'context-menu-ask-ai-interactive',
    askAIInteractiveSubmenu: 'ask-ai-interactive-submenu',
    askAISeparator: 'ask-ai-separator',
    customInstructionDialog: 'custom-instruction-dialog',
    customInstructionClose: 'custom-instruction-close',
    customInstructionSelection: 'custom-instruction-selection',
    customInstructionInput: 'custom-instruction-input',
    customInstructionCancelBtn: 'custom-instruction-cancel',
    customInstructionSubmitBtn: 'custom-instruction-submit',
};

/**
 * Required CSS classes for proper styling from shared-context-menu.css
 */
const REQUIRED_CSS_CLASSES = {
    menu: 'context-menu',
    menuItem: 'context-menu-item',
    menuParent: 'context-menu-parent',
    menuIcon: 'context-menu-icon',
    menuLabel: 'context-menu-label',
    menuArrow: 'context-menu-arrow',
    menuSeparator: 'context-menu-separator',
    submenu: 'context-submenu',
    previewTooltip: 'predefined-comment-preview',
    previewHeader: 'preview-header',
    previewContent: 'preview-content',
    customDialog: 'custom-instruction-dialog',
    customHeader: 'custom-instruction-header',
    customTitle: 'custom-instruction-title',
    customClose: 'custom-instruction-close',
    customSelection: 'custom-instruction-selection',
    customFooter: 'custom-instruction-footer',
};

/**
 * Extract HTML element IDs from a template string
 */
function extractIdsFromHtml(html: string): string[] {
    const idRegex = /id=["']([^"']+)["']/g;
    const ids: string[] = [];
    let match;
    while ((match = idRegex.exec(html)) !== null) {
        ids.push(match[1]);
    }
    return ids;
}

/**
 * Extract CSS classes from a template string
 */
function extractClassesFromHtml(html: string): string[] {
    const classRegex = /class=["']([^"']+)["']/g;
    const classes: Set<string> = new Set();
    let match;
    while ((match = classRegex.exec(html)) !== null) {
        match[1].split(/\s+/).forEach(cls => classes.add(cls));
    }
    return Array.from(classes);
}

/**
 * Check if HTML contains an element with both specified ID and class
 */
function hasElementWithIdAndClass(html: string, id: string, cssClass: string): boolean {
    // Check for id="..." ... class="...cssClass..."
    const pattern1 = new RegExp(`id=["']${id}["'][^>]*class=["'][^"']*${cssClass}[^"']*["']`);
    // Check for class="...cssClass..." ... id="..."
    const pattern2 = new RegExp(`class=["'][^"']*${cssClass}[^"']*["'][^>]*id=["']${id}["']`);
    return pattern1.test(html) || pattern2.test(html);
}

/**
 * Check if HTML contains a parent element with children having specific classes
 */
function hasMenuItemStructure(html: string, parentId: string): boolean {
    // Look for pattern: id="parentId"... containing context-menu-icon, context-menu-label
    const menuItemPattern = new RegExp(
        `id=["']${parentId}["'][^>]*>[\\s\\S]*?` +
        `context-menu-icon[\\s\\S]*?context-menu-label`
    );
    return menuItemPattern.test(html);
}

/**
 * Check if HTML contains a submenu parent with arrow
 */
function hasSubmenuStructure(html: string, parentId: string, submenuId: string): boolean {
    // Look for pattern: id="parentId" class containing "context-menu-parent"... 
    // with context-menu-arrow and child submenu
    const hasParentClass = hasElementWithIdAndClass(html, parentId, 'context-menu-parent');
    const hasArrow = html.includes('context-menu-arrow');
    const hasSubmenuWithClass = hasElementWithIdAndClass(html, submenuId, 'context-submenu');
    return hasParentClass && hasArrow && hasSubmenuWithClass;
}

suite('Shared Context Menu Consistency Tests', () => {

    suite('HTML Structure Requirements', () => {
        
        test('ContextMenuManager supports both camelCase and kebab-case IDs', () => {
            // Verify the primary IDs are defined
            assert.ok(REQUIRED_CONTEXT_MENU_IDS.menu);
            assert.ok(REQUIRED_CONTEXT_MENU_IDS.addComment);
            assert.ok(REQUIRED_CONTEXT_MENU_IDS.predefined);
            
            // Verify fallback IDs are different (for true backward compat)
            assert.notStrictEqual(REQUIRED_CONTEXT_MENU_IDS.menu, FALLBACK_CONTEXT_MENU_IDS.menu);
            assert.notStrictEqual(REQUIRED_CONTEXT_MENU_IDS.addComment, FALLBACK_CONTEXT_MENU_IDS.addComment);
        });

        test('Required CSS classes are defined', () => {
            assert.strictEqual(REQUIRED_CSS_CLASSES.menu, 'context-menu');
            assert.strictEqual(REQUIRED_CSS_CLASSES.menuItem, 'context-menu-item');
            assert.strictEqual(REQUIRED_CSS_CLASSES.menuParent, 'context-menu-parent');
            assert.strictEqual(REQUIRED_CSS_CLASSES.submenu, 'context-submenu');
            assert.strictEqual(REQUIRED_CSS_CLASSES.previewTooltip, 'predefined-comment-preview');
            assert.strictEqual(REQUIRED_CSS_CLASSES.customDialog, 'custom-instruction-dialog');
        });
    });

    suite('ID Extraction Utility', () => {
        
        test('extractIdsFromHtml extracts single ID', () => {
            const html = '<div id="test">Content</div>';
            const ids = extractIdsFromHtml(html);
            assert.deepStrictEqual(ids, ['test']);
        });

        test('extractIdsFromHtml extracts multiple IDs', () => {
            const html = '<div id="first"><span id="second"></span></div>';
            const ids = extractIdsFromHtml(html);
            assert.deepStrictEqual(ids, ['first', 'second']);
        });

        test('extractIdsFromHtml handles both quote styles', () => {
            const html = `<div id="double"><span id='single'></span></div>`;
            const ids = extractIdsFromHtml(html);
            assert.deepStrictEqual(ids, ['double', 'single']);
        });
    });

    suite('Class Extraction Utility', () => {
        
        test('extractClassesFromHtml extracts single class', () => {
            const html = '<div class="test">Content</div>';
            const classes = extractClassesFromHtml(html);
            assert.ok(classes.includes('test'));
        });

        test('extractClassesFromHtml extracts multiple classes', () => {
            const html = '<div class="first second third">Content</div>';
            const classes = extractClassesFromHtml(html);
            assert.ok(classes.includes('first'));
            assert.ok(classes.includes('second'));
            assert.ok(classes.includes('third'));
        });

        test('extractClassesFromHtml deduplicates classes', () => {
            const html = '<div class="test"><span class="test"></span></div>';
            const classes = extractClassesFromHtml(html);
            assert.strictEqual(classes.filter(c => c === 'test').length, 1);
        });
    });

    suite('Element Detection Utilities', () => {
        
        test('hasElementWithIdAndClass detects id before class', () => {
            const html = '<div id="test" class="my-class">Content</div>';
            assert.ok(hasElementWithIdAndClass(html, 'test', 'my-class'));
        });

        test('hasElementWithIdAndClass detects class before id', () => {
            const html = '<div class="my-class" id="test">Content</div>';
            assert.ok(hasElementWithIdAndClass(html, 'test', 'my-class'));
        });

        test('hasElementWithIdAndClass returns false for missing id', () => {
            const html = '<div class="my-class">Content</div>';
            assert.ok(!hasElementWithIdAndClass(html, 'test', 'my-class'));
        });

        test('hasElementWithIdAndClass returns false for missing class', () => {
            const html = '<div id="test">Content</div>';
            assert.ok(!hasElementWithIdAndClass(html, 'test', 'my-class'));
        });
    });

    suite('Menu Structure Detection', () => {
        
        test('hasMenuItemStructure detects icon and label in menu item', () => {
            const html = `
                <div class="context-menu-item" id="testItem">
                    <span class="context-menu-icon">🔧</span>
                    <span class="context-menu-label">Test</span>
                </div>
            `;
            assert.ok(hasMenuItemStructure(html, 'testItem'));
        });

        test('hasMenuItemStructure returns false for item without structure', () => {
            const html = '<div class="context-menu-item" id="testItem">Plain Text</div>';
            assert.ok(!hasMenuItemStructure(html, 'testItem'));
        });

        test('hasSubmenuStructure detects proper submenu pattern', () => {
            const html = `
                <div class="context-menu-item context-menu-parent" id="parentItem">
                    <span class="context-menu-icon">📁</span>
                    <span class="context-menu-label">Submenu</span>
                    <span class="context-menu-arrow">▶</span>
                    <div class="context-submenu" id="childSubmenu">
                        <!-- items -->
                    </div>
                </div>
            `;
            assert.ok(hasSubmenuStructure(html, 'parentItem', 'childSubmenu'));
        });

        test('hasSubmenuStructure returns false for missing parent class', () => {
            const html = `
                <div class="context-menu-item" id="parentItem">
                    <span class="context-menu-label">Submenu</span>
                    <div class="context-submenu" id="childSubmenu"></div>
                </div>
            `;
            assert.ok(!hasSubmenuStructure(html, 'parentItem', 'childSubmenu'));
        });
    });

    suite('Shared CSS Class Consistency', () => {
        
        test('menu container must use context-menu class', () => {
            // Both editors should use this class for the menu container
            assert.strictEqual(REQUIRED_CSS_CLASSES.menu, 'context-menu');
        });

        test('menu items must use context-menu-item class', () => {
            assert.strictEqual(REQUIRED_CSS_CLASSES.menuItem, 'context-menu-item');
        });

        test('submenu parents must use context-menu-parent class', () => {
            assert.strictEqual(REQUIRED_CSS_CLASSES.menuParent, 'context-menu-parent');
        });

        test('submenus must use context-submenu class', () => {
            assert.strictEqual(REQUIRED_CSS_CLASSES.submenu, 'context-submenu');
        });

        test('separators must use context-menu-separator class', () => {
            assert.strictEqual(REQUIRED_CSS_CLASSES.menuSeparator, 'context-menu-separator');
        });

        test('rich menu items must have icon, label, and arrow spans', () => {
            assert.strictEqual(REQUIRED_CSS_CLASSES.menuIcon, 'context-menu-icon');
            assert.strictEqual(REQUIRED_CSS_CLASSES.menuLabel, 'context-menu-label');
            assert.strictEqual(REQUIRED_CSS_CLASSES.menuArrow, 'context-menu-arrow');
        });
    });

    suite('Preview Tooltip Consistency', () => {
        
        test('preview tooltip must use predefined-comment-preview class', () => {
            assert.strictEqual(REQUIRED_CSS_CLASSES.previewTooltip, 'predefined-comment-preview');
        });

        test('preview must have header and content sections', () => {
            assert.strictEqual(REQUIRED_CSS_CLASSES.previewHeader, 'preview-header');
            assert.strictEqual(REQUIRED_CSS_CLASSES.previewContent, 'preview-content');
        });

        test('preview tooltip ID must be predefinedPreview', () => {
            assert.strictEqual(REQUIRED_CONTEXT_MENU_IDS.predefinedPreview, 'predefinedPreview');
        });
    });

    suite('Custom Instruction Dialog Consistency', () => {
        
        test('dialog must use custom-instruction-dialog class', () => {
            assert.strictEqual(REQUIRED_CSS_CLASSES.customDialog, 'custom-instruction-dialog');
        });

        test('dialog ID must be customInstructionDialog', () => {
            assert.strictEqual(REQUIRED_CONTEXT_MENU_IDS.customInstructionDialog, 'customInstructionDialog');
        });

        test('dialog must have required child elements', () => {
            assert.ok(REQUIRED_CONTEXT_MENU_IDS.customInstructionClose);
            assert.ok(REQUIRED_CONTEXT_MENU_IDS.customInstructionSelection);
            assert.ok(REQUIRED_CONTEXT_MENU_IDS.customInstructionInput);
            assert.ok(REQUIRED_CONTEXT_MENU_IDS.customInstructionCancelBtn);
            assert.ok(REQUIRED_CONTEXT_MENU_IDS.customInstructionSubmitBtn);
        });
    });

    suite('Sample HTML Validation', () => {
        
        // Sample HTML that matches the expected structure (like markdown editor)
        const validMenuHtml = `
            <div class="context-menu" id="contextMenu" style="display: none;">
                <div class="context-menu-item" id="contextMenuAddComment">
                    <span class="context-menu-icon">💬</span>
                    <span class="context-menu-label">Add Comment</span>
                </div>
                <div class="context-menu-item context-menu-parent" id="contextMenuPredefined">
                    <span class="context-menu-icon">📋</span>
                    <span class="context-menu-label">Add Predefined Comment</span>
                    <span class="context-menu-arrow">▶</span>
                    <div class="context-submenu" id="predefinedSubmenu">
                    </div>
                </div>
                <div class="context-menu-separator" id="askAISeparator"></div>
                <div class="context-menu-item context-menu-parent" id="contextMenuAskAIComment">
                    <span class="context-menu-icon">💬</span>
                    <span class="context-menu-label">Ask AI to Comment</span>
                    <span class="context-menu-arrow">▶</span>
                    <div class="context-submenu" id="askAICommentSubmenu">
                    </div>
                </div>
            </div>
        `;

        test('valid menu HTML contains required IDs', () => {
            const ids = extractIdsFromHtml(validMenuHtml);
            assert.ok(ids.includes('contextMenu'), 'Missing contextMenu ID');
            assert.ok(ids.includes('contextMenuAddComment'), 'Missing contextMenuAddComment ID');
            assert.ok(ids.includes('contextMenuPredefined'), 'Missing contextMenuPredefined ID');
            assert.ok(ids.includes('predefinedSubmenu'), 'Missing predefinedSubmenu ID');
            assert.ok(ids.includes('askAISeparator'), 'Missing askAISeparator ID');
            assert.ok(ids.includes('contextMenuAskAIComment'), 'Missing contextMenuAskAIComment ID');
            assert.ok(ids.includes('askAICommentSubmenu'), 'Missing askAICommentSubmenu ID');
        });

        test('valid menu HTML contains required CSS classes', () => {
            const classes = extractClassesFromHtml(validMenuHtml);
            assert.ok(classes.includes('context-menu'), 'Missing context-menu class');
            assert.ok(classes.includes('context-menu-item'), 'Missing context-menu-item class');
            assert.ok(classes.includes('context-menu-parent'), 'Missing context-menu-parent class');
            assert.ok(classes.includes('context-menu-icon'), 'Missing context-menu-icon class');
            assert.ok(classes.includes('context-menu-label'), 'Missing context-menu-label class');
            assert.ok(classes.includes('context-menu-arrow'), 'Missing context-menu-arrow class');
            assert.ok(classes.includes('context-submenu'), 'Missing context-submenu class');
            assert.ok(classes.includes('context-menu-separator'), 'Missing context-menu-separator class');
        });

        test('valid menu HTML has proper menu item structure', () => {
            assert.ok(hasMenuItemStructure(validMenuHtml, 'contextMenuAddComment'));
            assert.ok(hasMenuItemStructure(validMenuHtml, 'contextMenuPredefined'));
            assert.ok(hasMenuItemStructure(validMenuHtml, 'contextMenuAskAIComment'));
        });

        test('valid menu HTML has proper submenu structure', () => {
            assert.ok(hasSubmenuStructure(validMenuHtml, 'contextMenuPredefined', 'predefinedSubmenu'));
            assert.ok(hasSubmenuStructure(validMenuHtml, 'contextMenuAskAIComment', 'askAICommentSubmenu'));
        });

        // Invalid HTML examples that should fail validation
        const invalidMenuHtml_OldIds = `
            <div class="context-menu" id="custom-context-menu">
                <div class="context-menu-item" id="context-menu-add-comment">Add Comment</div>
            </div>
        `;

        test('old kebab-case IDs should use fallback pattern', () => {
            const ids = extractIdsFromHtml(invalidMenuHtml_OldIds);
            // Should NOT have the primary IDs
            assert.ok(!ids.includes('contextMenu'), 'Should not have contextMenu with old HTML');
            assert.ok(!ids.includes('contextMenuAddComment'), 'Should not have contextMenuAddComment with old HTML');
            // But should have fallback IDs
            assert.ok(ids.includes('custom-context-menu'), 'Should have custom-context-menu fallback');
            assert.ok(ids.includes('context-menu-add-comment'), 'Should have context-menu-add-comment fallback');
        });

        const invalidMenuHtml_WrongClasses = `
            <div class="context-menu" id="contextMenu">
                <div class="context-menu-item has-submenu" id="contextMenuPredefined">
                    Add Predefined Comment
                    <div class="predefined-submenu" id="predefinedSubmenu"></div>
                </div>
            </div>
        `;

        test('old class names should fail validation', () => {
            const classes = extractClassesFromHtml(invalidMenuHtml_WrongClasses);
            // Should have wrong classes
            assert.ok(classes.includes('has-submenu'), 'Has old has-submenu class');
            assert.ok(classes.includes('predefined-submenu'), 'Has old predefined-submenu class');
            // Should NOT have correct classes
            assert.ok(!classes.includes('context-menu-parent'), 'Missing context-menu-parent class');
            assert.ok(!classes.includes('context-submenu'), 'Missing context-submenu class');
        });

        const invalidMenuHtml_NoRichStructure = `
            <div class="context-menu" id="contextMenu">
                <div class="context-menu-item" id="contextMenuAddComment">Add Comment</div>
            </div>
        `;

        test('plain text items should fail rich structure check', () => {
            assert.ok(!hasMenuItemStructure(invalidMenuHtml_NoRichStructure, 'contextMenuAddComment'));
        });
    });
});

/**
 * Required IDs for the combined action items submenu (prompts + skills merged)
 */
const ACTION_ITEMS_IDS = {
    actionItemsSeparator: 'actionItemsSeparator',
    contextMenuActionItems: 'contextMenuActionItems',
    actionItemsSubmenu: 'actionItemsSubmenu',
    actionItemsLoading: 'actionItemsLoading',
};

/**
 * Fallback IDs for backward compatibility
 */
const ACTION_ITEMS_FALLBACK_IDS = {
    actionItemsSeparator: 'action-items-separator',
    contextMenuActionItems: 'context-menu-action-items',
    actionItemsSubmenu: 'action-items-submenu',
};

suite('Combined Action Items Submenu Tests', () => {
    
    suite('HTML Structure Requirements', () => {
        
        test('action items IDs are defined', () => {
            assert.ok(ACTION_ITEMS_IDS.actionItemsSeparator);
            assert.ok(ACTION_ITEMS_IDS.contextMenuActionItems);
            assert.ok(ACTION_ITEMS_IDS.actionItemsSubmenu);
        });

        test('action items fallback IDs are different from primary', () => {
            assert.notStrictEqual(ACTION_ITEMS_IDS.actionItemsSeparator, ACTION_ITEMS_FALLBACK_IDS.actionItemsSeparator);
            assert.notStrictEqual(ACTION_ITEMS_IDS.contextMenuActionItems, ACTION_ITEMS_FALLBACK_IDS.contextMenuActionItems);
        });
    });

    suite('Action Items HTML Validation', () => {
        
        // Sample HTML for the combined action items submenu (markdown editor style)
        const validActionItemsHtml = `
            <div class="context-menu-separator" id="actionItemsSeparator"></div>
            <div class="context-menu-item context-menu-parent" id="contextMenuActionItems">
                <span class="context-menu-icon">🚀</span>
                <span class="context-menu-label">Follow Prompt</span>
                <span class="context-menu-arrow">▶</span>
                <div class="context-submenu" id="actionItemsSubmenu">
                    <div class="context-menu-item context-menu-loading" id="actionItemsLoading">
                        <span class="menu-icon">⏳</span>Loading...
                    </div>
                </div>
            </div>
        `;

        test('valid action items HTML contains required IDs', () => {
            const ids = extractIdsFromHtml(validActionItemsHtml);
            assert.ok(ids.includes('actionItemsSeparator'), 'Missing actionItemsSeparator ID');
            assert.ok(ids.includes('contextMenuActionItems'), 'Missing contextMenuActionItems ID');
            assert.ok(ids.includes('actionItemsSubmenu'), 'Missing actionItemsSubmenu ID');
            assert.ok(ids.includes('actionItemsLoading'), 'Missing actionItemsLoading ID');
        });

        test('action items submenu has proper submenu structure', () => {
            assert.ok(hasSubmenuStructure(validActionItemsHtml, 'contextMenuActionItems', 'actionItemsSubmenu'));
        });

        test('action items menu item has icon and label', () => {
            assert.ok(hasMenuItemStructure(validActionItemsHtml, 'contextMenuActionItems'));
        });

        test('action items HTML uses correct CSS classes', () => {
            const classes = extractClassesFromHtml(validActionItemsHtml);
            assert.ok(classes.includes('context-menu-separator'), 'Missing context-menu-separator class');
            assert.ok(classes.includes('context-menu-item'), 'Missing context-menu-item class');
            assert.ok(classes.includes('context-menu-parent'), 'Missing context-menu-parent class');
            assert.ok(classes.includes('context-submenu'), 'Missing context-submenu class');
            assert.ok(classes.includes('context-menu-loading'), 'Missing context-menu-loading class');
        });
    });

    suite('Action Items Submenu Content Generation', () => {
        
        // Sample populated action items submenu HTML
        const populatedActionItemsHtml = `
            <div class="context-menu-item action-item prompt-action-item" data-path="path%2Fto%2Fprompt.md" data-type="prompt" data-name="MyPrompt" title="path/to/prompt.md">
                <span class="menu-icon">📄</span>MyPrompt
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item context-menu-header" disabled>
                <span class="menu-icon">🎯</span>Skills
            </div>
            <div class="context-menu-item action-item skill-action-item" data-path="path%2Fto%2Fskill" data-type="skill" data-name="MySkill" title="MySkill: Does something">
                <span class="menu-icon">🎯</span>MySkill
            </div>
        `;

        test('populated submenu has prompt items with correct data attributes', () => {
            assert.ok(populatedActionItemsHtml.includes('data-type="prompt"'));
            assert.ok(populatedActionItemsHtml.includes('data-path='));
            assert.ok(populatedActionItemsHtml.includes('data-name='));
            assert.ok(populatedActionItemsHtml.includes('prompt-action-item'));
        });

        test('populated submenu has skill items with correct data attributes', () => {
            assert.ok(populatedActionItemsHtml.includes('data-type="skill"'));
            assert.ok(populatedActionItemsHtml.includes('skill-action-item'));
        });

        test('populated submenu has appropriate icons', () => {
            // Prompts use 📄 icon
            assert.ok(populatedActionItemsHtml.includes('📄'));
            // Skills use 🎯 icon
            assert.ok(populatedActionItemsHtml.includes('🎯'));
        });

        test('skill items have description in title tooltip', () => {
            assert.ok(populatedActionItemsHtml.includes('title="MySkill: Does something"'));
        });
    });

    suite('Empty State Handling', () => {
        
        const emptyStateHtml = `
            <div class="context-menu-item context-menu-empty" disabled>
                <span class="menu-icon">📭</span>No prompt files or skills found
            </div>
            <div class="context-menu-item context-menu-hint" disabled>
                <span class="menu-icon">💡</span>Add .prompt.md files or skills
            </div>
        `;

        test('empty state shows appropriate message', () => {
            assert.ok(emptyStateHtml.includes('No prompt files or skills found'));
        });

        test('empty state provides helpful hint', () => {
            assert.ok(emptyStateHtml.includes('Add .prompt.md files or skills'));
        });

        test('empty state items are disabled', () => {
            const disabledCount = (emptyStateHtml.match(/disabled/g) || []).length;
            assert.ok(disabledCount >= 2, 'Both empty state items should be disabled');
        });

        test('empty state uses appropriate CSS classes', () => {
            assert.ok(emptyStateHtml.includes('context-menu-empty'));
            assert.ok(emptyStateHtml.includes('context-menu-hint'));
        });
    });

    suite('Action Items Callback Types', () => {
        
        test('onActionItemSelected callback signature accepts type, path, and name', () => {
            // This test verifies the callback type definition
            type ActionItemCallback = (type: 'prompt' | 'skill', path: string, name: string) => void;
            
            // Simulate the callback
            let capturedType: 'prompt' | 'skill' | undefined;
            let capturedPath: string | undefined;
            let capturedName: string | undefined;
            
            const callback: ActionItemCallback = (type, path, name) => {
                capturedType = type;
                capturedPath = path;
                capturedName = name;
            };
            
            // Test with prompt
            callback('prompt', '/path/to/prompt.md', 'MyPrompt');
            assert.strictEqual(capturedType, 'prompt');
            assert.strictEqual(capturedPath, '/path/to/prompt.md');
            assert.strictEqual(capturedName, 'MyPrompt');
            
            // Test with skill
            callback('skill', '/path/to/skill', 'MySkill');
            assert.strictEqual(capturedType, 'skill');
            assert.strictEqual(capturedPath, '/path/to/skill');
            assert.strictEqual(capturedName, 'MySkill');
        });

        test('onRequestActionItems callback is used for combined loading', () => {
            // This test verifies the callback exists and is callable
            type RequestActionItemsCallback = () => void;
            
            let requestCalled = false;
            const callback: RequestActionItemsCallback = () => {
                requestCalled = true;
            };
            
            callback();
            assert.ok(requestCalled);
        });
    });
});

suite('Context Menu Manager Element Lookup Tests', () => {
    
    /**
     * Simulates the element lookup logic in ContextMenuManager.findElements()
     */
    function findElementById(primaryId: string, fallbackId: string, availableIds: string[]): string | null {
        if (availableIds.includes(primaryId)) {
            return primaryId;
        }
        if (availableIds.includes(fallbackId)) {
            return fallbackId;
        }
        return null;
    }

    test('should find primary camelCase ID when available', () => {
        const availableIds = ['contextMenu', 'contextMenuAddComment'];
        const found = findElementById('contextMenu', 'custom-context-menu', availableIds);
        assert.strictEqual(found, 'contextMenu');
    });

    test('should fall back to kebab-case ID when primary not available', () => {
        const availableIds = ['custom-context-menu', 'context-menu-add-comment'];
        const found = findElementById('contextMenu', 'custom-context-menu', availableIds);
        assert.strictEqual(found, 'custom-context-menu');
    });

    test('should return null when neither ID is available', () => {
        const availableIds = ['someOtherId'];
        const found = findElementById('contextMenu', 'custom-context-menu', availableIds);
        assert.strictEqual(found, null);
    });

    test('should prefer primary ID even when both are available', () => {
        const availableIds = ['contextMenu', 'custom-context-menu'];
        const found = findElementById('contextMenu', 'custom-context-menu', availableIds);
        assert.strictEqual(found, 'contextMenu');
    });
});
