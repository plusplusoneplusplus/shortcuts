/**
 * Tests for ActivityChatDetail component — unified task detail surface.
 *
 * Validates scroll-to-bottom, mode selector, slash commands, retry-on-error,
 * cancel/move-to-top, PendingTaskInfoPanel, conversation caching,
 * rich SSE streaming (chunk/tool events), image paste, session expiry,
 * copy conversation, and wsId propagation to ConversationTurnBubble.
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

const REACT_SRC = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react');
const USE_SEND_MESSAGE_SOURCE = fs.readFileSync(path.join(REACT_SRC, 'hooks', 'useSendMessage.ts'), 'utf-8');
const USE_CHAT_SSE_SOURCE = fs.readFileSync(path.join(REACT_SRC, 'hooks', 'useChatSSE.ts'), 'utf-8');
const FOLLOW_UP_INPUT_AREA_SOURCE = fs.readFileSync(path.join(REACT_SRC, 'repos', 'FollowUpInputArea.tsx'), 'utf-8');
const CHAT_HEADER_SRC = fs.readFileSync(path.join(REACT_SRC, 'repos', 'ChatHeader.tsx'), 'utf-8');
const CONVERSATION_AREA_SOURCE = fs.readFileSync(path.join(REACT_SRC, 'repos', 'ConversationArea.tsx'), 'utf-8');
const MODE_CONFIG_SOURCE = fs.readFileSync(path.join(REACT_SRC, 'repos', 'modeConfig.ts'), 'utf-8');
const QUEUED_BUBBLE_SOURCE = fs.readFileSync(path.join(REACT_SRC, 'repos', 'QueuedBubble.tsx'), 'utf-8');
const CHAT_UTILS_SOURCE = fs.readFileSync(path.join(REACT_SRC, 'utils', 'chatUtils.ts'), 'utf-8');

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
            expect(CHAT_UTILS_SOURCE).toContain('...(processDetails');
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
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('data-testid="mode-selector"');
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('data-testid="mode-dropdown"');
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('<select');
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('<option key={mode} value={mode}>{label}</option>');
        });

        it('renders all three mode labels', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain("'ask', '💡 Ask'");
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain("'plan', '📋 Plan'");
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain("'autopilot', '🤖 Autopilot'");
        });

        it('sends selectedMode in follow-up message body', () => {
            const sendBlock = USE_SEND_MESSAGE_SOURCE.substring(
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp'),
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp') + 1800,
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
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain("e.key === 'Tab' && e.shiftKey");
        });

        it('Shift+Tab prevents default tab behavior', () => {
            const keyBlock = FOLLOW_UP_INPUT_AREA_SOURCE.substring(
                FOLLOW_UP_INPUT_AREA_SOURCE.indexOf("e.key === 'Tab' && e.shiftKey"),
                FOLLOW_UP_INPUT_AREA_SOURCE.indexOf("e.key === 'Tab' && e.shiftKey") + 300,
            );
            expect(keyBlock).toContain('e.preventDefault()');
        });

        it('Shift+Tab cycles through all three modes in order', () => {
            expect(MODE_CONFIG_SOURCE).toContain("'ask', 'plan', 'autopilot'");
            expect(MODE_CONFIG_SOURCE).toContain('% MODES.length');
        });

        it('Shift+Tab uses functional state update for mode cycling', () => {
            const keyBlock = FOLLOW_UP_INPUT_AREA_SOURCE.substring(
                FOLLOW_UP_INPUT_AREA_SOURCE.indexOf("e.key === 'Tab' && e.shiftKey"),
                FOLLOW_UP_INPUT_AREA_SOURCE.indexOf("e.key === 'Tab' && e.shiftKey") + 300,
            );
            expect(keyBlock).toContain('setSelectedMode(cycleMode(');
        });

        it('Shift+Tab handler runs after slash command menu check', () => {
            const onKeyDown = FOLLOW_UP_INPUT_AREA_SOURCE.substring(
                FOLLOW_UP_INPUT_AREA_SOURCE.indexOf('onKeyDown={e =>'),
                FOLLOW_UP_INPUT_AREA_SOURCE.indexOf('onPaste={onImagePaste}'),
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
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain("import { SlashCommandMenu }");
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
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('<SlashCommandMenu');
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('skills={skills}');
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('filter={slashCommands.menuFilter}');
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('visible={slashCommands.menuVisible}');
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('highlightIndex={slashCommands.highlightIndex}');
        });

        it('calls handleInputChange on textarea change', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('slashCommands.handleInputChange(');
        });

        it('calls handleKeyDown for slash menu keyboard navigation', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('slashCommands.handleKeyDown(e)');
        });

        it('extracts skills from message before sending', () => {
            const sendBlock = USE_SEND_MESSAGE_SOURCE.substring(
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp'),
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp') + 1800,
            );
            expect(sendBlock).toContain('slashCommands.parseAndExtract(');
            expect(sendBlock).toContain('skillNames');
        });

        it('dismisses slash menu on send', () => {
            const sendBlock = USE_SEND_MESSAGE_SOURCE.substring(
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp'),
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp') + 1800,
            );
            expect(sendBlock).toContain('slashCommands.dismissMenu()');
        });
    });

    describe('image paste integration', () => {
        it('imports useImagePaste hook', () => {
            expect(source).toContain("import { useImagePaste } from '../hooks/useImagePaste'");
        });

        it('imports ImagePreviews component', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain("import { ImagePreviews } from '../shared/ImagePreviews'");
        });

        it('destructures useImagePaste result', () => {
            expect(source).toContain('const { images, addFromPaste, removeImage, clearImages } = useImagePaste()');
        });

        it('attaches onPaste to follow-up textarea', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('onPaste={onImagePaste}');
        });

        it('renders ImagePreviews with images and onRemove', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('<ImagePreviews images={images} onRemove={onImageRemove}');
        });

        it('includes images in sendFollowUp POST body', () => {
            const sendFollowUpSection = USE_SEND_MESSAGE_SOURCE.substring(USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp'));
            expect(sendFollowUpSection).toContain('images: images.length > 0');
            expect(sendFollowUpSection).toContain('? images');
            expect(sendFollowUpSection).toContain(': undefined');
        });

        it('clears images immediately after send (before waiting for completion)', () => {
            const sendFollowUpSection = USE_SEND_MESSAGE_SOURCE.substring(USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp'));
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
            expect(USE_SEND_MESSAGE_SOURCE).toContain('`${getApiBase()}/processes/${encodeURIComponent(processId)}/message`');
        });

        it('sends content in the body', () => {
            expect(USE_SEND_MESSAGE_SOURCE).toContain('content,');
        });

        it('handles Enter key with delivery mode routing', () => {
            // Plain Enter → enqueue
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain("void onSend(undefined, 'enqueue')");
            // Ctrl+Enter → immediate
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain("void onSend(undefined, 'immediate')");
        });

        it('includes deliveryMode in POST body', () => {
            const sendBlock = USE_SEND_MESSAGE_SOURCE.substring(
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp'),
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp') + 5000,
            );
            expect(sendBlock).toContain('deliveryMode');
        });
    });

    describe('session expiry (410)', () => {
        it('detects 410 status on follow-up', () => {
            expect(USE_SEND_MESSAGE_SOURCE).toContain('response.status === 410');
        });

        it('sets session expired flag', () => {
            expect(USE_SEND_MESSAGE_SOURCE).toContain('setSessionExpired(true)');
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

        it('stores rawContent in lastFailedMessageRef on error paths (not before send)', () => {
            const sendBlock = USE_SEND_MESSAGE_SOURCE.substring(
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp'),
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp') + 5000,
            );
            // Should NOT set lastFailedMessageRef eagerly before the fetch request
            const preamble = sendBlock.substring(0, sendBlock.indexOf('const response = await fetch'));
            expect(preamble).not.toContain('lastFailedMessageRef.current = rawContent');

            // Should set it on each error path (410, !ok, catch)
            const matches = sendBlock.match(/lastFailedMessageRef\.current = rawContent/g);
            expect(matches).not.toBeNull();
            expect(matches!.length).toBeGreaterThanOrEqual(3);
        });

        it('clears lastFailedMessageRef on successful send', () => {
            const sendBlock = USE_SEND_MESSAGE_SOURCE.substring(
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp'),
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp') + 5000,
            );
            expect(sendBlock).toContain("lastFailedMessageRef.current = ''");
        });

        it('renders Retry button when error is set (not gated on lastFailedMessageRef)', () => {
            // The retry button is shown whenever error is truthy
            const errorBubbleIdx = FOLLOW_UP_INPUT_AREA_SOURCE.indexOf('chat-error-bubble');
            const retrySection = FOLLOW_UP_INPUT_AREA_SOURCE.substring(
                errorBubbleIdx,
                errorBubbleIdx + 600,
            );
            // Should NOT require lastFailedMessageRef.current in the render condition
            expect(retrySection).not.toContain('error && lastFailedMessageRef.current');
            expect(retrySection).toContain('Retry');
            expect(retrySection).toContain('onRetry');
        });

        it('uses the shared Button component for the retry button', () => {
            const errorBubbleIdx = FOLLOW_UP_INPUT_AREA_SOURCE.indexOf('chat-error-bubble');
            const retrySection = FOLLOW_UP_INPUT_AREA_SOURCE.substring(
                errorBubbleIdx,
                errorBubbleIdx + 600,
            );
            expect(retrySection).toContain('<Button');
            expect(retrySection).toContain('variant="danger"');
            expect(retrySection).toContain('data-testid="retry-btn"');
        });

        it('retry button shows spinner and is disabled while sending', () => {
            const retryBtnIdx = FOLLOW_UP_INPUT_AREA_SOURCE.indexOf('data-testid="retry-btn"');
            const retrySection = FOLLOW_UP_INPUT_AREA_SOURCE.substring(
                retryBtnIdx - 200,
                retryBtnIdx + 200,
            );
            expect(retrySection).toContain('loading={sending}');
            expect(retrySection).toContain('disabled={sending}');
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
            expect(CONVERSATION_AREA_SOURCE).toContain("import { PendingTaskInfoPanel } from '../queue/PendingTaskInfoPanel'");
        });

        it('renders PendingTaskInfoPanel for pending tasks', () => {
            expect(CONVERSATION_AREA_SOURCE).toContain('<PendingTaskInfoPanel');
        });

        it('passes fullTask || task to PendingTaskInfoPanel', () => {
            expect(CONVERSATION_AREA_SOURCE).toContain('task={fullTask || task}');
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

        it('skips caching when any turn has streaming:true (prevents partial cache)', () => {
            // The guard `!resolved.some(t => t.streaming)` must be present so that
            // mid-stream SSE turns never pollute the 1-hour conversation cache.
            const setTurnsBlock = source.substring(
                source.indexOf('setTurnsAndRef'),
                source.indexOf('setTurnsAndRef') + 600,
            );
            expect(setTurnsBlock).toContain('resolved.some(t => t.streaming)');
        });

        it('checks conversationCache before fetching', () => {
            expect(source).toContain('appState.conversationCache[taskId]');
            expect(source).toContain('cached.cachedAt < CACHE_TTL_MS');
        });
    });

    describe('SSE chunk timeline merging', () => {
        it('merges consecutive content chunks into a single timeline item', () => {
            const chunkHandler = USE_CHAT_SSE_SOURCE.substring(
                USE_CHAT_SSE_SOURCE.indexOf("es.addEventListener('chunk'"),
                USE_CHAT_SSE_SOURCE.indexOf("const handleToolSSE"),
            );
            expect(chunkHandler).toContain("lastItem.type === 'content'");
            expect(chunkHandler).toContain("(lastItem.content || '') + chunk");
            expect(chunkHandler).toContain('tl.slice(0, -1)');
        });

        it('creates a new timeline item when last item is not content', () => {
            const chunkHandler = USE_CHAT_SSE_SOURCE.substring(
                USE_CHAT_SSE_SOURCE.indexOf("es.addEventListener('chunk'"),
                USE_CHAT_SSE_SOURCE.indexOf("const handleToolSSE"),
            );
            expect(chunkHandler).toContain("type: 'content' as const");
            expect(chunkHandler).toContain('timestamp: new Date().toISOString()');
        });

        it('tool events always push a new timeline item (merge boundary)', () => {
            const toolHandler = USE_CHAT_SSE_SOURCE.substring(
                USE_CHAT_SSE_SOURCE.indexOf('const handleToolSSE'),
                USE_CHAT_SSE_SOURCE.indexOf("es.addEventListener('tool-start'"),
            );
            expect(toolHandler).toContain('...(last.timeline || [])');
            expect(toolHandler).toContain('type: eventType');
        });

        it('handles conversation-snapshot SSE event', () => {
            expect(USE_CHAT_SSE_SOURCE).toContain("es.addEventListener('conversation-snapshot'");
        });
    });

    describe('SET_FOLLOW_UP_STREAMING dispatch', () => {
        it('dispatches SET_FOLLOW_UP_STREAMING true when sending', () => {
            const sendBlock = USE_SEND_MESSAGE_SOURCE.substring(USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp'));
            expect(sendBlock).toContain("type: 'SET_FOLLOW_UP_STREAMING', value: true");
        });

        it('dispatches SET_FOLLOW_UP_STREAMING false when done', () => {
            const sendBlock = USE_SEND_MESSAGE_SOURCE.substring(USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp'));
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
            expect(CHAT_HEADER_SRC).toContain('data-testid="copy-conversation-btn"');
        });

        it('imports copyToClipboard and formatConversationAsText', () => {
            expect(CHAT_HEADER_SRC).toContain('copyToClipboard');
            expect(CHAT_HEADER_SRC).toContain('formatConversationAsText');
        });

        it('has copied state for copy button feedback', () => {
            expect(CHAT_HEADER_SRC).toContain('setCopied(true)');
            expect(CHAT_HEADER_SRC).toContain('setCopied(false)');
        });

        it('copy button is disabled when loading or turns empty', () => {
            expect(CHAT_HEADER_SRC).toContain('disabled={loading || turns.length === 0}');
        });

        it('copy button shows checkmark icon after copying (2s revert)', () => {
            expect(CHAT_HEADER_SRC).toContain('setCopied(false), 2000');
        });
    });

    describe('mode-based input border colors', () => {
        it('defines MODE_BORDER_COLORS mapping for all three modes', () => {
            expect(MODE_CONFIG_SOURCE).toContain('MODE_BORDER_COLORS');
            expect(MODE_CONFIG_SOURCE).toContain("autopilot: { border: 'border-green-500 dark:border-green-400', ring: 'focus:ring-green-500/50' }");
            expect(MODE_CONFIG_SOURCE).toContain("ask: { border: 'border-yellow-500 dark:border-yellow-400', ring: 'focus:ring-yellow-500/50' }");
            expect(MODE_CONFIG_SOURCE).toContain("plan: { border: 'border-blue-500 dark:border-blue-400', ring: 'focus:ring-blue-500/50' }");
        });

        it('applies dynamic border class from MODE_BORDER_COLORS to textarea', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('MODE_BORDER_COLORS[selectedMode].border');
        });

        it('applies dynamic focus ring class from MODE_BORDER_COLORS to textarea', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('MODE_BORDER_COLORS[selectedMode].ring');
        });

        it('uses cn() utility to compose textarea classes with mode border', () => {
            const textareaBlock = FOLLOW_UP_INPUT_AREA_SOURCE.substring(
                FOLLOW_UP_INPUT_AREA_SOURCE.indexOf('<textarea') - 50,
                FOLLOW_UP_INPUT_AREA_SOURCE.indexOf('data-testid="activity-chat-input"') + 50,
            );
            expect(textareaBlock).toContain('cn(');
            expect(textareaBlock).toContain('MODE_BORDER_COLORS[selectedMode]');
        });

        it('MODE_BORDER_COLORS is typed as Record over all mode variants', () => {
            expect(MODE_CONFIG_SOURCE).toContain("Record<ChatMode");
        });
    });

    describe('always-enabled input', () => {
        it('inputDisabled does not include sending', () => {
            const expr = source.substring(
                source.indexOf('const inputDisabled'),
                source.indexOf('const inputDisabled') + 200,
            );
            expect(expr).not.toContain('sending');
        });

        it('imports DeliveryMode from pipeline-core', () => {
            expect(USE_SEND_MESSAGE_SOURCE).toContain("import type { DeliveryMode } from '@plusplusoneplusplus/pipeline-core'");
        });

        it('declares QueuedMessage interface with correct status union', () => {
            expect(CHAT_UTILS_SOURCE).toContain("status: 'pending-send' | 'queued' | 'steering'");
        });

        it('declares pendingQueue state', () => {
            expect(source).toContain('useState<QueuedMessage[]>([])');
        });

        it('declares flushQueueRef', () => {
            expect(source).toContain('flushQueueRef');
        });
    });

    describe('keyboard routing', () => {
        it('Ctrl+Enter submits with immediate delivery mode', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain("void onSend(undefined, 'immediate')");
        });

        it('plain Enter submits with enqueue delivery mode', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain("void onSend(undefined, 'enqueue')");
        });

        it('Shift+Enter falls through for newline', () => {
            const keyBlock = FOLLOW_UP_INPUT_AREA_SOURCE.substring(
                FOLLOW_UP_INPUT_AREA_SOURCE.indexOf("void onSend(undefined, 'immediate')") - 200,
                FOLLOW_UP_INPUT_AREA_SOURCE.indexOf("void onSend(undefined, 'enqueue')") + 200,
            );
            expect(keyBlock).toContain('!e.shiftKey');
        });

        it('detects Ctrl or Meta key for immediate mode', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('e.ctrlKey || e.metaKey');
        });
    });

    describe('client-side queue', () => {
        it('queues messages when sending is true', () => {
            const sendBlock = USE_SEND_MESSAGE_SOURCE.substring(
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp'),
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp') + 5000,
            );
            expect(sendBlock).toContain('if (sending)');
            expect(sendBlock).toContain('setPendingQueue(prev => [...prev, qm])');
        });

        it('assigns crypto.randomUUID() as queue message id', () => {
            expect(USE_SEND_MESSAGE_SOURCE).toContain('crypto.randomUUID()');
        });

        it('includes optimisticId in queued POST body', () => {
            const sendBlock = USE_SEND_MESSAGE_SOURCE.substring(
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp'),
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp') + 5000,
            );
            expect(sendBlock).toContain('optimisticId: qm.id');
        });

        it('sends deliveryMode in POST body for normal sends', () => {
            expect(USE_SEND_MESSAGE_SOURCE).toContain('deliveryMode,');
        });
    });

    describe('SSE queue events', () => {
        it('handles message-queued SSE event in main SSE', () => {
            expect(USE_CHAT_SSE_SOURCE).toContain("es.addEventListener('message-queued'");
        });

        it('handles message-steering SSE event in main SSE', () => {
            expect(USE_CHAT_SSE_SOURCE).toContain("es.addEventListener('message-steering'");
        });

        it('updates pending queue status on message-queued', () => {
            const handler = USE_CHAT_SSE_SOURCE.substring(
                USE_CHAT_SSE_SOURCE.indexOf("es.addEventListener('message-queued'"),
                USE_CHAT_SSE_SOURCE.indexOf("es.addEventListener('message-queued'") + 300,
            );
            expect(handler).toContain("status: 'queued' as const");
        });

        it('updates pending queue status on message-steering', () => {
            const handler = USE_CHAT_SSE_SOURCE.substring(
                USE_CHAT_SSE_SOURCE.indexOf("es.addEventListener('message-steering'"),
                USE_CHAT_SSE_SOURCE.indexOf("es.addEventListener('message-steering'") + 300,
            );
            expect(handler).toContain("status: 'steering' as const");
        });

        it('handles message-queued SSE in follow-up stream', () => {
            const followUpSSE = USE_SEND_MESSAGE_SOURCE.substring(
                USE_SEND_MESSAGE_SOURCE.indexOf('const waitForFollowUpCompletion'),
                USE_SEND_MESSAGE_SOURCE.indexOf('const waitForFollowUpCompletion') + 3000,
            );
            expect(followUpSSE).toContain("'message-queued'");
        });

        it('handles message-steering SSE in follow-up stream', () => {
            const followUpSSE = USE_SEND_MESSAGE_SOURCE.substring(
                USE_SEND_MESSAGE_SOURCE.indexOf('const waitForFollowUpCompletion'),
                USE_SEND_MESSAGE_SOURCE.indexOf('const waitForFollowUpCompletion') + 3000,
            );
            expect(followUpSSE).toContain("'message-steering'");
        });
    });

    describe('queue drain on done', () => {
        it('removes steering messages from queue on done', () => {
            expect(USE_SEND_MESSAGE_SOURCE).toContain("m.status !== 'steering'");
        });

        it('calls flushQueueRef.current on done', () => {
            expect(USE_SEND_MESSAGE_SOURCE).toContain('flushQueueRef.current?.()');
        });

        it('drains in sendFollowUp finally block', () => {
            const sendBlock = USE_SEND_MESSAGE_SOURCE.substring(
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp'),
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp') + 5000,
            );
            expect(sendBlock).toContain('flushQueueRef.current?.()');
        });
    });

    describe('optimistic bubble rendering', () => {
        it('defines QueuedBubble component', () => {
            expect(QUEUED_BUBBLE_SOURCE).toContain('export function QueuedBubble');
        });

        it('QueuedBubble shows lightning bolt for steering status', () => {
            expect(QUEUED_BUBBLE_SOURCE).toContain("'steering' ? '⚡'");
        });

        it('QueuedBubble shows clock for queued status', () => {
            expect(QUEUED_BUBBLE_SOURCE).toContain("'queued'   ? '🕐'");
        });

        it('QueuedBubble shows correct labels', () => {
            expect(QUEUED_BUBBLE_SOURCE).toContain("'steering' ? 'steering'");
            expect(QUEUED_BUBBLE_SOURCE).toContain("'queued'   ? 'queued'");
            expect(QUEUED_BUBBLE_SOURCE).toContain("'sending…'");
        });

        it('renders pendingQueue as QueuedBubble components', () => {
            expect(CONVERSATION_AREA_SOURCE).toContain('{pendingQueue.map(msg => <QueuedBubble key={msg.id} msg={msg} />)}');
        });

        it('renders queued bubbles with data-status attribute', () => {
            expect(QUEUED_BUBBLE_SOURCE).toContain('data-status={msg.status}');
        });
    });

    describe('chat-switch state reset (pendingQueue bubble leak fix)', () => {
        it('resets pendingQueue in the taskId-change useEffect', () => {
            const resetBlock = source.substring(
                source.indexOf('Load task + conversation on mount / taskId change'),
                source.indexOf('Load task + conversation on mount / taskId change') + 2000,
            );
            expect(resetBlock).toContain('setPendingQueue([])');
        });

        it('resets sending in the taskId-change useEffect', () => {
            const resetBlock = source.substring(
                source.indexOf('Load task + conversation on mount / taskId change'),
                source.indexOf('Load task + conversation on mount / taskId change') + 2000,
            );
            expect(resetBlock).toContain('setSending(false)');
        });

        it('resets isStreaming in the taskId-change useEffect', () => {
            const resetBlock = source.substring(
                source.indexOf('Load task + conversation on mount / taskId change'),
                source.indexOf('Load task + conversation on mount / taskId change') + 2000,
            );
            expect(resetBlock).toContain('setIsStreaming(false)');
        });

        it('resets pendingQueue, sending and isStreaming before restoring draft', () => {
            const resetBlock = source.substring(
                source.indexOf('Load task + conversation on mount / taskId change'),
                source.indexOf('Restore draft for the new taskId'),
            );
            expect(resetBlock).toContain('setPendingQueue([])');
            expect(resetBlock).toContain('setSending(false)');
            expect(resetBlock).toContain('setIsStreaming(false)');
        });
    });

    describe('wsId propagation to ConversationTurnBubble (file-path click fix)', () => {
        it('passes wsId={workspaceId} to ConversationTurnBubble', () => {
            expect(source).toContain('wsId={workspaceId}');
        });

        it('ConversationTurnBubble render includes both taskId and wsId props', () => {
            const bubbleCall = CONVERSATION_AREA_SOURCE.substring(
                CONVERSATION_AREA_SOURCE.indexOf('<ConversationTurnBubble'),
                CONVERSATION_AREA_SOURCE.indexOf('<ConversationTurnBubble') + 200,
            );
            expect(bubbleCall).toContain('taskId={taskId}');
            expect(bubbleCall).toContain('wsId={wsId}');
        });
    });

    describe('plan doc header pill', () => {
        it('derives planPath from context.files[0] with fallback to planFilePath', () => {
            const planPathBlock = source.substring(
                source.indexOf('const planPath'),
                source.indexOf('const planPath') + 200,
            );
            expect(planPathBlock).toContain('task?.payload?.context?.files?.[0]');
            expect(planPathBlock).toContain('task?.payload?.planFilePath');
            expect(planPathBlock).toContain("''");
        });

        it('imports MetaRow and FilePathValue from PendingTaskPayload', () => {
            expect(CHAT_HEADER_SRC).toContain("import { FilePathValue } from '../queue/PendingTaskPayload'");
        });

        it('renders FilePathValue pill with 📄 label when planPath is set', () => {
            const headerBlock = CHAT_HEADER_SRC.substring(
                CHAT_HEADER_SRC.indexOf('<Badge status={task.status}'),
                CHAT_HEADER_SRC.indexOf('<Badge status={task.status}') + 300,
            );
            expect(headerBlock).toContain('{planPath && (');
            expect(headerBlock).toContain('<FilePathValue label="📄" value={planPath}');
        });

        it('pill is placed after the status Badge in the header', () => {
            const headerSection = CHAT_HEADER_SRC.substring(
                CHAT_HEADER_SRC.indexOf('<Badge status={task.status}'),
                CHAT_HEADER_SRC.indexOf('<Badge status={task.status}') + 300,
            );
            expect(headerSection).toContain('{planPath && (');
            expect(headerSection).toContain('<FilePathValue label="📄" value={planPath}');
        });
    });

    describe('ConversationMiniMap integration', () => {
        it('imports ConversationMiniMap from processes directory', () => {
            expect(source).toContain("import { ConversationMiniMap }");
            expect(source).toContain("'../processes/ConversationMiniMap'");
        });

        it('declares turnsContainerRef', () => {
            expect(source).toContain('turnsContainerRef');
            expect(source).toContain('useRef<HTMLDivElement>(null)');
        });

        it('renders ConversationMiniMap with required props', () => {
            expect(source).toContain('<ConversationMiniMap');
            expect(source).toContain('turns={turns}');
            expect(source).toContain('scrollContainerRef={conversationContainerRef}');
            expect(source).toContain('turnsContainerRef={turnsContainerRef}');
            expect(source).toContain("isStreaming={task?.status === 'running'}");
        });

        it('hides minimap when variant is floating', () => {
            expect(source).toContain("variant !== 'floating'");
        });

        it('passes turnsContainerRef to ConversationArea', () => {
            expect(source).toContain('turnsContainerRef={turnsContainerRef}');
        });

        it('ConversationArea accepts turnsContainerRef prop', () => {
            expect(CONVERSATION_AREA_SOURCE).toContain('turnsContainerRef');
            expect(CONVERSATION_AREA_SOURCE).toContain('RefObject<HTMLDivElement');
        });

        it('ConversationArea attaches turnsContainerRef to turns container div', () => {
            expect(CONVERSATION_AREA_SOURCE).toContain('ref={turnsContainerRef}');
            expect(CONVERSATION_AREA_SOURCE).toContain('space-y-3');
        });

        it('wraps ConversationArea and minimap in a flex row', () => {
            const flexWrapper = source.includes('flex-1 min-h-0 flex');
            expect(flexWrapper).toBe(true);
        });
    });
});
