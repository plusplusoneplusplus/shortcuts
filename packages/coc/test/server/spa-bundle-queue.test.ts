/**
 * SPA Dashboard Tests — queue module + conversation view
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle, generateDashboardHtml, getAllModels } from './spa-test-helpers';

// ============================================================================
// Queue panel HTML
// ============================================================================

describe('Queue panel HTML', () => {
    it('contains queue panel element', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="queue-panel"');
        expect(html).toContain('class="queue-panel"');
    });

    it('contains enqueue dialog overlay', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="enqueue-overlay"');
        expect(html).toContain('id="enqueue-form"');
        expect(html).toContain('id="enqueue-name"');
        expect(html).toContain('id="enqueue-type"');
        expect(html).toContain('id="enqueue-priority"');
        expect(html).toContain('id="enqueue-prompt"');
    });

    it('has optional task name field (not required)', () => {
        const html = generateDashboardHtml();
        // Name input should NOT have required attribute
        const nameInputMatch = html.match(/<input[^>]*id="enqueue-name"[^>]*>/);
        expect(nameInputMatch).toBeTruthy();
        expect(nameInputMatch![0]).not.toContain('required');
        // Should show optional hint
        expect(html).toContain('auto-generated if empty');
    });

    it('contains enqueue dialog with model selector', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="enqueue-model"');
        // Model field should be a <select>, not an <input>
        const modelSelectMatch = html.match(/<select[^>]*id="enqueue-model"[^>]*>/);
        expect(modelSelectMatch).toBeTruthy();
        // Should have a default empty option
        expect(html).toContain('<option value="">Default</option>');
        // Should contain model options from the registry
        expect(html).toContain('claude-sonnet-4.5');
        expect(html).toContain('Claude Sonnet 4.5');
    });

    it('model selector is not a text input', () => {
        const html = generateDashboardHtml();
        // Should NOT have an <input> with id="enqueue-model"
        const modelInputMatch = html.match(/<input[^>]*id="enqueue-model"[^>]*>/);
        expect(modelInputMatch).toBeNull();
    });

    it('model selector contains all models from registry', () => {
        const html = generateDashboardHtml();
        const models = getAllModels();
        for (const model of models) {
            expect(html).toContain(`value="${model.id}"`);
            expect(html).toContain(model.label);
        }
    });

    it('model selector includes descriptions for models that have them', () => {
        const html = generateDashboardHtml();
        const models = getAllModels();
        for (const model of models) {
            if (model.description) {
                expect(html).toContain(model.description);
            }
        }
    });

    it('model selector default option has empty value', () => {
        const html = generateDashboardHtml();
        // The default option should have value="" so submitting without selection sends no model
        expect(html).toContain('<option value="">Default</option>');
    });

    it('model selector has correct number of options (models + default)', () => {
        const html = generateDashboardHtml();
        const models = getAllModels();
        // Count option tags within the model select
        const modelSelectSection = html.match(/<select[^>]*id="enqueue-model"[^>]*>[\s\S]*?<\/select>/);
        expect(modelSelectSection).toBeTruthy();
        const optionCount = (modelSelectSection![0].match(/<option /g) || []).length;
        expect(optionCount).toBe(models.length + 1); // +1 for "Default" option
    });

    it('contains enqueue dialog with working directory field', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="enqueue-cwd"');
        const cwdInputMatch = html.match(/<input[^>]*id="enqueue-cwd"[^>]*>/);
        expect(cwdInputMatch).toBeTruthy();
        expect(cwdInputMatch![0]).not.toContain('required');
        expect(html).toContain('/path/to/project');
    });

    it('contains enqueue dialog with task type options', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('Custom');
        expect(html).toContain('AI Clarification');
        expect(html).toContain('Follow Prompt');
    });

    it('contains enqueue dialog with priority options', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('value="normal"');
        expect(html).toContain('value="high"');
        expect(html).toContain('value="low"');
    });

    it('contains Add to Queue submit button', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('Add to Queue');
    });
});

// ============================================================================
// Queue module (client bundle)
// ============================================================================

describe('client bundle — queue module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines queueState', () => {
        expect(script).toContain('queueState');
        expect(script).toContain('queued: []');
        expect(script).toContain('running: []');
        expect(script).toContain('isPaused: false');
    });

    it('defines fetchQueue function', () => {
        expect(script).toContain('fetchQueue');
        expect(script).toContain('/queue');
    });

    it('defines renderQueuePanel function', () => {
        expect(script).toContain('renderQueuePanel');
        expect(script).toContain('queue-panel');
    });

    it('defines renderQueueTask function', () => {
        expect(script).toContain('renderQueueTask');
        expect(script).toContain('queue-task');
    });

    it('defines queue control functions', () => {
        expect(script).toContain('queuePause');
        expect(script).toContain('queueResume');
        expect(script).toContain('queueClear');
        expect(script).toContain('queueCancelTask');
        expect(script).toContain('queueMoveToTop');
        expect(script).toContain('queueMoveUp');
    });

    it('defines enqueue dialog functions', () => {
        expect(script).toContain('showEnqueueDialog');
        expect(script).toContain('hideEnqueueDialog');
        expect(script).toContain('submitEnqueueForm');
    });

    it('auto-fetches queue on load', () => {
        expect(script).toContain('fetchQueue');
    });

    it('defines queue polling functions', () => {
        expect(script).toContain('startQueuePolling');
        expect(script).toContain('stopQueuePolling');
    });

    it('polls queue every 3 seconds when active', () => {
        // esbuild converts 3000 to 3e3
        expect(script).toContain('3e3');
        expect(script).toContain('queuePollInterval');
    });

    it('stops polling when no active tasks', () => {
        expect(script).toContain('stopQueuePolling');
    });

    it('starts polling after enqueue', () => {
        expect(script).toContain('startQueuePolling');
    });

    it('auto-expands history on fetchQueue when tasks complete', () => {
        expect(script).toContain('showHistory');
    });

    it('reads model select and cwd input in submitEnqueueForm', () => {
        expect(script).toContain('enqueue-model');
        expect(script).toContain('enqueue-cwd');
    });

    it('sends model in config when provided', () => {
        expect(script).toContain('config.model = model');
    });

    it('sends workingDirectory in payload for ai-clarification and follow-prompt', () => {
        expect(script).toContain('payload.workingDirectory = cwd');
    });

    it('resets model select and clears cwd input after submit', () => {
        expect(script).toContain('modelSelect');
        expect(script).toContain('cwdInput');
    });

    it('sets up enqueue form event listeners', () => {
        expect(script).toContain('enqueue-form');
        expect(script).toContain('enqueue-cancel');
        expect(script).toContain('enqueue-overlay');
    });

    it('supports priority icons', () => {
        expect(script).toContain('priorityIcon');
    });

    it('uses confirm dialog for clear', () => {
        expect(script).toContain('confirm(');
    });
});

// ============================================================================
// Queue styles
// ============================================================================

describe('Queue styles — via generateDashboardHtml', () => {
    const html = generateDashboardHtml();

    it('defines queue panel styles', () => {
        expect(html).toContain('.queue-panel');
        expect(html).toContain('.queue-header');
        expect(html).toContain('.queue-task');
    });

    it('defines queue control button styles', () => {
        expect(html).toContain('.queue-ctrl-btn');
    });

    it('defines queue task action styles', () => {
        expect(html).toContain('.queue-task-actions');
    });

    it('defines queue empty state styles', () => {
        expect(html).toContain('.queue-empty');
        expect(html).toContain('.queue-add-btn');
    });

    it('defines enqueue dialog styles', () => {
        expect(html).toContain('.enqueue-overlay');
        expect(html).toContain('.enqueue-dialog');
    });

    it('defines queue count badge styles', () => {
        expect(html).toContain('.queue-count');
    });

    it('defines optional hint style for task name label', () => {
        expect(html).toContain('.enqueue-optional');
    });
});

// ============================================================================
// Queue Task Conversation View
// ============================================================================

describe('Queue task conversation view', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    describe('detail script — conversation functions', () => {
        it('defines showQueueTaskDetail function', () => {
            expect(script).toContain('showQueueTaskDetail');
        });

        it('defines renderQueueTaskConversation function', () => {
            expect(script).toContain('renderQueueTaskConversation');
        });

        it('defines connectQueueTaskSSE function', () => {
            expect(script).toContain('connectQueueTaskSSE');
        });

        it('defines closeQueueTaskStream function', () => {
            expect(script).toContain('closeQueueTaskStream');
        });

        it('defines updateConversationContent function', () => {
            expect(script).toContain('updateConversationContent');
        });

        it('defines scrollConversationToBottom function', () => {
            expect(script).toContain('scrollConversationToBottom');
        });

        it('defines copyQueueTaskResult function', () => {
            expect(script).toContain('copyQueueTaskResult');
        });

        it('defines copyConversationOutput function', () => {
            expect(script).toContain('copyConversationOutput');
        });

        it('constructs process ID with queue- prefix', () => {
            expect(script).toContain('queue-');
        });

        it('uses EventSource for SSE streaming', () => {
            expect(script).toContain('EventSource');
        });

        it('listens for chunk events', () => {
            expect(script).toContain('chunk');
        });

        it('listens for status events', () => {
            expect(script).toContain('status');
        });

        it('listens for done events', () => {
            expect(script).toContain('done');
        });

        it('listens for heartbeat events', () => {
            expect(script).toContain('heartbeat');
        });

        it('accumulates streaming content', () => {
            expect(script).toContain('queueTaskStreamContent');
        });

        it('auto-scrolls conversation to bottom during streaming', () => {
            expect(script).toContain('scrollConversationToBottom');
        });

        it('shows streaming indicator for running tasks', () => {
            expect(script).toContain('streaming-indicator');
            expect(script).toContain('Live');
        });

        it('shows waiting message when no content yet', () => {
            expect(script).toContain('Waiting for response...');
        });

        it('closes previous SSE stream when opening new task', () => {
            expect(script).toContain('closeQueueTaskStream');
        });

        it('cleans up SSE stream on clearDetail', () => {
            expect(script).toContain('clearDetail');
            expect(script).toContain('closeQueueTaskStream');
        });

        it('fetches process data via REST API', () => {
            expect(script).toContain('/processes/');
        });

        it('renders markdown in conversation body', () => {
            expect(script).toContain('renderMarkdown');
        });

        it('retries SSE connection on error with delay', () => {
            expect(script).toContain('setTimeout');
            // esbuild converts 2000 to 2e3
            expect(script).toContain('2e3');
        });

        it('renders back button in detail header', () => {
            expect(script).toContain('detail-back-btn');
            expect(script).toContain('clearDetail');
        });

        it('renders copy result button for completed tasks', () => {
            expect(script).toContain('Copy Result');
            expect(script).toContain('copyQueueTaskResult');
        });

        it('renders prompt section when available', () => {
            expect(script).toContain('prompt-section');
            expect(script).toContain('Prompt');
        });

        it('renders error alert when process has error', () => {
            expect(script).toContain('error-alert');
        });

        it('renders model in queue task conversation metadata', () => {
            expect(script).toContain('.metadata.model');
        });

        it('renders working directory in queue task conversation metadata', () => {
            expect(script).toContain('.workingDirectory');
        });
    });

    describe('queue script — clickable tasks', () => {
        it('makes running tasks clickable with showQueueTaskDetail', () => {
            expect(script).toContain('showQueueTaskDetail');
        });

        it('makes history tasks clickable with showQueueTaskDetail', () => {
            expect(script).toContain('showQueueTaskDetail');
        });

        it('sets cursor pointer on clickable tasks', () => {
            expect(script).toContain('cursor:pointer');
        });

        it('stops event propagation on action buttons', () => {
            expect(script).toContain('event.stopPropagation()');
        });
    });

    describe('conversation styles — via generateDashboardHtml', () => {
        const styledHtml = generateDashboardHtml();

        it('defines conversation section styles', () => {
            expect(styledHtml).toContain('.conversation-section');
            expect(styledHtml).toContain('.conversation-body');
        });

        it('defines streaming indicator with pulse animation', () => {
            expect(styledHtml).toContain('.streaming-indicator');
            expect(styledHtml).toContain('@keyframes');
        });

        it('defines back button style', () => {
            expect(styledHtml).toContain('.detail-back-btn');
        });
    });
});
