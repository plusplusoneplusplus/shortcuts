/**
 * Tests for ActivityChatDetail component — unified task detail surface.
 *
 * Validates scroll-to-bottom, mode selector, slash commands, retry-on-error,
 * cancel/move-to-top, PendingTaskInfoPanel, conversation caching,
 * rich SSE streaming (chunk/tool events), image paste, session expiry,
 * and copy conversation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ACTIVITY_CHAT_DETAIL_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'ActivityChatDetail.tsx'
);

const PENDING_PAYLOAD_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'queue', 'PendingTaskPayload.tsx'
);

const PENDING_INFO_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'queue', 'PendingTaskInfoPanel.tsx'
);

describe('ActivityChatDetail', () => {
    let source: string;
    let payloadSource: string;
    let infoSource: string;

    beforeAll(() => {
        source = fs.readFileSync(ACTIVITY_CHAT_DETAIL_PATH, 'utf-8');
        payloadSource = fs.readFileSync(PENDING_PAYLOAD_PATH, 'utf-8');
        infoSource = fs.readFileSync(PENDING_INFO_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports ActivityChatDetail as a named export', () => {
            expect(source).toContain('export function ActivityChatDetail');
        });
    });

    describe('metadataProcess includes processDetails (session ID)', () => {
        it('merges processDetails into metadataProcess', () => {
            const metaBlock = source.substring(
                source.indexOf('const metadataProcess'),
                source.indexOf('const metadataProcess') + 400,
            );
            expect(metaBlock).toContain('processDetails');
        });

        it('spreads processDetails onto the metadata object', () => {
            const metaBlock = source.substring(
                source.indexOf('const metadataProcess'),
                source.indexOf('const metadataProcess') + 400,
            );
            expect(metaBlock).toContain('...(processDetails');
        });

        it('includes processDetails in useMemo dependency array', () => {
            const depsSection = source.substring(
                source.indexOf('const metadataProcess'),
                source.indexOf('const metadataProcess') + 600,
            );
            expect(depsSection).toMatch(/\[.*processDetails.*\]/s);
        });
    });

    describe('scroll-to-bottom on task selection', () => {
        it('declares isInitialLoadRef', () => {
            expect(source).toContain('isInitialLoadRef');
        });

        it('sets isInitialLoadRef to true when taskId changes', () => {
            const loadEffect = source.substring(
                source.indexOf('Load task + conversation on mount / taskId change'),
                source.indexOf('Load task + conversation on mount / taskId change') + 300,
            );
            expect(loadEffect).toContain('isInitialLoadRef.current = true');
        });

        it('forces scroll to bottom on initial load using requestAnimationFrame', () => {
            const scrollEffect = source.substring(
                source.indexOf('Scroll to bottom on new turns'),
                source.indexOf('Scroll to bottom on new turns') + 500,
            );
            expect(scrollEffect).toContain('isInitialLoadRef.current');
            expect(scrollEffect).toContain('requestAnimationFrame');
            expect(scrollEffect).toContain('el.scrollTop = el.scrollHeight');
        });

        it('resets isInitialLoadRef after first scroll', () => {
            const scrollEffect = source.substring(
                source.indexOf('Scroll to bottom on new turns'),
                source.indexOf('Scroll to bottom on new turns') + 500,
            );
            expect(scrollEffect).toContain('isInitialLoadRef.current = false');
        });

        it('only scrolls incrementally (near-bottom guard) for subsequent turns', () => {
            const scrollEffect = source.substring(
                source.indexOf('Scroll to bottom on new turns'),
                source.indexOf('Scroll to bottom on new turns') + 700,
            );
            expect(scrollEffect).toContain('dist < 100');
        });
    });

    describe('mode selector', () => {
        it('declares selectedMode state with autopilot default', () => {
            expect(source).toContain("useState<'ask' | 'plan' | 'autopilot'>('autopilot')");
        });

        it('renders mode selector as a dropdown', () => {
            expect(source).toContain('data-testid="mode-selector"');
            expect(source).toContain('data-testid="mode-dropdown"');
            expect(source).toContain('<select');
            expect(source).toContain('<option key={mode} value={mode}>{label}</option>');
        });

        it('renders all three mode labels', () => {
            expect(source).toContain("'ask', '💡 Ask'");
            expect(source).toContain("'plan', '📋 Plan'");
            expect(source).toContain("'autopilot', '🤖 Autopilot'");
        });

        it('sends selectedMode in follow-up message body', () => {
            const sendBlock = source.substring(
                source.indexOf('const sendFollowUp'),
                source.indexOf('const sendFollowUp') + 1800,
            );
            expect(sendBlock).toContain('mode: selectedMode');
        });

        it('initializes selectedMode from task payload mode on load', () => {
            expect(source).toContain("setSelectedMode(loadedTask.payload.mode)");
        });

        it('updates selectedMode from process metadata mode', () => {
            expect(source).toContain("setSelectedMode(processMode)");
        });

        it('cycles mode on Shift+Tab keydown', () => {
            expect(source).toContain("e.key === 'Tab' && e.shiftKey");
        });

        it('Shift+Tab prevents default tab behavior', () => {
            const keyBlock = source.substring(
                source.indexOf("e.key === 'Tab' && e.shiftKey"),
                source.indexOf("e.key === 'Tab' && e.shiftKey") + 300,
            );
            expect(keyBlock).toContain('e.preventDefault()');
        });

        it('Shift+Tab cycles through all three modes in order', () => {
            const keyBlock = source.substring(
                source.indexOf("e.key === 'Tab' && e.shiftKey"),
                source.indexOf("e.key === 'Tab' && e.shiftKey") + 500,
            );
            expect(keyBlock).toContain("'ask', 'plan', 'autopilot'");
            expect(keyBlock).toContain('% modes.length');
        });

        it('Shift+Tab uses functional state update for mode cycling', () => {
            const keyBlock = source.substring(
                source.indexOf("e.key === 'Tab' && e.shiftKey"),
                source.indexOf("e.key === 'Tab' && e.shiftKey") + 300,
            );
            expect(keyBlock).toContain('setSelectedMode(prev =>');
        });

        it('Shift+Tab handler runs after slash command menu check', () => {
            const onKeyDown = source.substring(
                source.indexOf('onKeyDown={e =>'),
                source.indexOf('onPaste={addFromPaste}'),
            );
            const slashIdx = onKeyDown.indexOf('slashCommands.handleKeyDown(e)');
            const shiftTabIdx = onKeyDown.indexOf("e.key === 'Tab' && e.shiftKey");
            expect(slashIdx).toBeGreaterThan(-1);
            expect(shiftTabIdx).toBeGreaterThan(slashIdx);
        });
    });

    describe('slash command skill autocomplete', () => {
        it('imports useSlashCommands hook', () => {
            expect(source).toContain("import { useSlashCommands }");
        });

        it('imports SlashCommandMenu component', () => {
            expect(source).toContain("import { SlashCommandMenu }");
        });

        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId?: string');
        });

        it('declares skills state', () => {
            expect(source).toContain('useState<SkillItem[]>([])');
        });

        it('fetches skills from the workspaces API', () => {
            expect(source).toContain("/skills/all'");
        });

        it('initializes useSlashCommands with skills', () => {
            expect(source).toContain('useSlashCommands(skills)');
        });

        it('renders SlashCommandMenu with correct props', () => {
            expect(source).toContain('<SlashCommandMenu');
            expect(source).toContain('skills={skills}');
            expect(source).toContain('filter={slashCommands.menuFilter}');
            expect(source).toContain('visible={slashCommands.menuVisible}');
            expect(source).toContain('highlightIndex={slashCommands.highlightIndex}');
        });

        it('calls handleInputChange on textarea change', () => {
            expect(source).toContain('slashCommands.handleInputChange(');
        });

        it('calls handleKeyDown for slash menu keyboard navigation', () => {
            expect(source).toContain('slashCommands.handleKeyDown(e)');
        });

        it('extracts skills from message before sending', () => {
            const sendBlock = source.substring(
                source.indexOf('const sendFollowUp'),
                source.indexOf('const sendFollowUp') + 1800,
            );
            expect(sendBlock).toContain('slashCommands.parseAndExtract(');
            expect(sendBlock).toContain('skillNames');
        });

        it('dismisses slash menu on send', () => {
            const sendBlock = source.substring(
                source.indexOf('const sendFollowUp'),
                source.indexOf('const sendFollowUp') + 1800,
            );
            expect(sendBlock).toContain('slashCommands.dismissMenu()');
        });
    });

    describe('image paste integration', () => {
        it('imports useImagePaste hook', () => {
            expect(source).toContain("import { useImagePaste } from '../hooks/useImagePaste'");
        });

        it('imports ImagePreviews component', () => {
            expect(source).toContain("import { ImagePreviews } from '../shared/ImagePreviews'");
        });

        it('destructures useImagePaste result', () => {
            expect(source).toContain('const { images, addFromPaste, removeImage, clearImages } = useImagePaste()');
        });

        it('attaches onPaste to follow-up textarea', () => {
            expect(source).toContain('onPaste={addFromPaste}');
        });

        it('renders ImagePreviews with images and onRemove', () => {
            expect(source).toContain('<ImagePreviews images={images} onRemove={removeImage}');
        });

        it('includes images in sendFollowUp POST body', () => {
            const sendFollowUpSection = source.substring(source.indexOf('const sendFollowUp'));
            expect(sendFollowUpSection).toContain('images: images.length > 0');
            expect(sendFollowUpSection).toContain('? images');
            expect(sendFollowUpSection).toContain(': undefined');
        });

        it('clears images immediately after send (before waiting for completion)', () => {
            const sendFollowUpSection = source.substring(source.indexOf('const sendFollowUp'));
            const waitIdx = sendFollowUpSection.indexOf('await waitForFollowUpCompletion');
            const clearIdx = sendFollowUpSection.indexOf('clearImages()');
            const catchIdx = sendFollowUpSection.indexOf('} catch');
            expect(waitIdx).toBeGreaterThan(-1);
            expect(clearIdx).toBeGreaterThan(-1);
            expect(clearIdx).toBeLessThan(waitIdx);
            expect(clearIdx).toBeLessThan(catchIdx);
        });
    });

    describe('follow-up send', () => {
        it('POSTs to /processes/:id/message endpoint', () => {
            expect(source).toContain('`${getApiBase()}/processes/${encodeURIComponent(processId)}/message`');
        });

        it('sends content in the body', () => {
            expect(source).toContain('content,');
        });

        it('handles Enter key without Shift for send', () => {
            expect(source).toContain("e.key === 'Enter' && !e.shiftKey");
        });
    });

    describe('session expiry (410)', () => {
        it('detects 410 status on follow-up', () => {
            expect(source).toContain('response.status === 410');
        });

        it('sets session expired flag', () => {
            expect(source).toContain('setSessionExpired(true)');
        });
    });

    describe('no-session follow-up guard', () => {
        it('computes noSessionForFollowUp from terminal status and missing session', () => {
            expect(source).toContain('noSessionForFollowUp');
            expect(source).toMatch(/isTerminal\s*&&\s*processDetails\s*!==\s*null\s*&&\s*!resumeSessionId/);
        });

        it('hides chat input when noSessionForFollowUp is true', () => {
            expect(source).toContain('!isPending && !noSessionForFollowUp && (');
        });

        it('shows informational message when follow-up is unavailable', () => {
            expect(source).toContain('!isPending && noSessionForFollowUp && (');
            expect(source).toContain('Follow-up chat is not available for this process type.');
        });

        it('defines isTerminal from completed, failed, or cancelled status', () => {
            expect(source).toMatch(/isTerminal\s*=.*completed.*failed/);
        });
    });

    describe('retry-on-error', () => {
        it('declares lastFailedMessageRef', () => {
            expect(source).toContain('lastFailedMessageRef');
        });

        it('stores rawContent in lastFailedMessageRef before sending', () => {
            const sendBlock = source.substring(source.indexOf('const sendFollowUp'));
            expect(sendBlock).toContain('lastFailedMessageRef.current = rawContent');
        });

        it('renders Retry button when error and lastFailedMessageRef', () => {
            expect(source).toContain('error && lastFailedMessageRef.current');
            expect(source).toContain('Retry');
            expect(source).toContain('retryLastMessage()');
        });

        it('retryLastMessage calls sendFollowUp with stored content', () => {
            expect(source).toContain('sendFollowUp(lastFailedMessageRef.current)');
        });
    });

    describe('cancel and move-to-top actions', () => {
        it('defines handleCancel that deletes the queue task', () => {
            expect(source).toContain('handleCancel');
            expect(source).toContain("method: 'DELETE'");
            expect(source).toContain("SELECT_QUEUE_TASK', id: null");
        });

        it('defines handleMoveToTop that POSTs move-to-top', () => {
            expect(source).toContain('handleMoveToTop');
            expect(source).toContain('/move-to-top');
        });

        it('passes cancel and moveToTop to PendingTaskInfoPanel', () => {
            expect(source).toContain('onCancel={handleCancel}');
            expect(source).toContain('onMoveToTop={handleMoveToTop}');
        });
    });

    describe('PendingTaskInfoPanel integration', () => {
        it('imports PendingTaskInfoPanel', () => {
            expect(source).toContain("import { PendingTaskInfoPanel } from '../queue/PendingTaskInfoPanel'");
        });

        it('renders PendingTaskInfoPanel for pending tasks', () => {
            expect(source).toContain('<PendingTaskInfoPanel');
        });

        it('passes fullTask || task to PendingTaskInfoPanel', () => {
            expect(source).toContain('task={fullTask || task}');
        });

        it('fetches full task data for pending tasks', () => {
            expect(source).toContain('Fetch full task data for pending tasks');
        });
    });

    describe('conversation caching', () => {
        it('imports useApp from AppContext', () => {
            expect(source).toContain("import { useApp } from '../context/AppContext'");
        });

        it('declares CACHE_TTL_MS constant', () => {
            expect(source).toContain('CACHE_TTL_MS');
        });

        it('dispatches CACHE_CONVERSATION when turns update', () => {
            expect(source).toContain("type: 'CACHE_CONVERSATION'");
        });

        it('checks conversationCache before fetching', () => {
            expect(source).toContain('appState.conversationCache[taskId]');
            expect(source).toContain('cached.cachedAt < CACHE_TTL_MS');
        });
    });

    describe('SSE chunk timeline merging', () => {
        it('merges consecutive content chunks into a single timeline item', () => {
            const chunkHandler = source.substring(
                source.indexOf("es.addEventListener('chunk'"),
                source.indexOf("const handleToolSSE"),
            );
            expect(chunkHandler).toContain("lastItem.type === 'content'");
            expect(chunkHandler).toContain("(lastItem.content || '') + chunk");
            expect(chunkHandler).toContain('prev.slice(0, -1)');
        });

        it('creates a new timeline item when last item is not content', () => {
            const chunkHandler = source.substring(
                source.indexOf("es.addEventListener('chunk'"),
                source.indexOf("const handleToolSSE"),
            );
            expect(chunkHandler).toContain("type: 'content' as const");
            expect(chunkHandler).toContain('timestamp: new Date().toISOString()');
        });

        it('tool events always push a new timeline item (merge boundary)', () => {
            const toolHandler = source.substring(
                source.indexOf('const handleToolSSE'),
                source.indexOf("es.addEventListener('tool-start'"),
            );
            expect(toolHandler).toContain('...(last.timeline || [])');
            expect(toolHandler).toContain('type: eventType');
        });

        it('handles conversation-snapshot SSE event', () => {
            expect(source).toContain("es.addEventListener('conversation-snapshot'");
        });
    });

    describe('SET_FOLLOW_UP_STREAMING dispatch', () => {
        it('dispatches SET_FOLLOW_UP_STREAMING true when sending', () => {
            const sendBlock = source.substring(source.indexOf('const sendFollowUp'));
            expect(sendBlock).toContain("type: 'SET_FOLLOW_UP_STREAMING', value: true");
        });

        it('dispatches SET_FOLLOW_UP_STREAMING false when done', () => {
            const sendBlock = source.substring(source.indexOf('const sendFollowUp'));
            expect(sendBlock).toContain("type: 'SET_FOLLOW_UP_STREAMING', value: false");
        });

        it('resets SET_FOLLOW_UP_STREAMING on task switch', () => {
            const loadEffect = source.substring(
                source.indexOf('Load task + conversation on mount / taskId change'),
                source.indexOf('Load task + conversation on mount / taskId change') + 800,
            );
            expect(loadEffect).toContain('SET_FOLLOW_UP_STREAMING');
        });
    });

    describe('refresh-on-reclick', () => {
        it('includes queueState.refreshVersion in the re-fetch effect', () => {
            expect(source).toContain('queueState.refreshVersion');
        });

        it('declares lastRefreshVersionRef', () => {
            expect(source).toContain('lastRefreshVersionRef');
        });

        it('uses refreshVersion to detect a forced refresh (isRefresh check)', () => {
            expect(source).toContain('isRefresh');
        });
    });

    describe('lazy image loading', () => {
        it('PendingTaskPayload fetches images when payload.hasImages is true', () => {
            expect(payloadSource).toContain('payload.hasImages');
            expect(payloadSource).toContain("fetchApi(`/queue/${encodeURIComponent(task.id)}/images`)");
        });

        it('PendingTaskPayload renders ImageGallery for fetched images', () => {
            expect(payloadSource).toContain('<ImageGallery');
        });

        it('ConversationTurnBubble receives taskId prop', () => {
            expect(source).toContain('taskId={taskId}');
        });
    });

    describe('hoverable file paths', () => {
        it('imports FilePathLink from shared (via PendingTaskPayload)', () => {
            expect(payloadSource).toContain('FilePathLink');
        });

        it('defines FilePathValue component', () => {
            expect(payloadSource).toContain('function FilePathValue(');
        });

        it('FilePathValue uses shared FilePathLink component', () => {
            const filePathValueSection = payloadSource.substring(payloadSource.indexOf('function FilePathValue'));
            expect(filePathValueSection).toContain('<FilePathLink path={value}');
        });

        it('PendingTaskInfoPanel uses FilePathValue for Working Directory', () => {
            expect(infoSource).toContain('<FilePathValue label="Working Directory" value={workingDir}');
        });

        it('shows Prompt File Content in resolved prompt section', () => {
            expect(infoSource).toContain('Prompt File Content');
        });

        it('shows Plan File Content in resolved prompt section', () => {
            expect(infoSource).toContain('Plan File Content');
        });
    });

    describe('copy conversation', () => {
        it('has copy-conversation button with data-testid', () => {
            expect(source).toContain('data-testid="copy-conversation-btn"');
        });

        it('imports copyToClipboard and formatConversationAsText', () => {
            expect(source).toContain('copyToClipboard');
            expect(source).toContain('formatConversationAsText');
        });

        it('has copied state for copy button feedback', () => {
            expect(source).toContain('setCopied(true)');
            expect(source).toContain('setCopied(false)');
        });

        it('copy button is disabled when loading or turns empty', () => {
            expect(source).toContain('disabled={loading || turns.length === 0}');
        });

        it('copy button shows checkmark icon after copying (2s revert)', () => {
            expect(source).toContain('setCopied(false), 2000');
        });
    });

    describe('mode-based input border colors', () => {
        it('defines MODE_BORDER_COLORS mapping for all three modes', () => {
            expect(source).toContain('MODE_BORDER_COLORS');
            expect(source).toContain("autopilot: { border: 'border-green-500 dark:border-green-400', ring: 'focus:ring-green-500/50' }");
            expect(source).toContain("ask: { border: 'border-yellow-500 dark:border-yellow-400', ring: 'focus:ring-yellow-500/50' }");
            expect(source).toContain("plan: { border: 'border-blue-500 dark:border-blue-400', ring: 'focus:ring-blue-500/50' }");
        });

        it('applies dynamic border class from MODE_BORDER_COLORS to textarea', () => {
            expect(source).toContain('MODE_BORDER_COLORS[selectedMode].border');
        });

        it('applies dynamic focus ring class from MODE_BORDER_COLORS to textarea', () => {
            expect(source).toContain('MODE_BORDER_COLORS[selectedMode].ring');
        });

        it('uses cn() utility to compose textarea classes with mode border', () => {
            const textareaBlock = source.substring(
                source.indexOf('<textarea') - 50,
                source.indexOf('data-testid="activity-chat-input"') + 50,
            );
            expect(textareaBlock).toContain('cn(');
            expect(textareaBlock).toContain('MODE_BORDER_COLORS[selectedMode]');
        });

        it('MODE_BORDER_COLORS is typed as Record over all mode variants', () => {
            expect(source).toContain("Record<'ask' | 'plan' | 'autopilot'");
        });
    });
});
