/**
 * Tests for ChatDetail component — unified task detail surface.
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
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'chat', 'ChatDetail.tsx'
);

const PENDING_PAYLOAD_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'queue', 'PendingTaskPayload.tsx'
);

const PENDING_INFO_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'queue', 'PendingTaskInfoPanel.tsx'
);

const REACT_SRC = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react');
const USE_SEND_MESSAGE_SOURCE = fs.readFileSync(path.join(REACT_SRC, 'features', 'chat', 'hooks', 'useSendMessage.ts'), 'utf-8');
const USE_CHAT_SSE_SOURCE = fs.readFileSync(path.join(REACT_SRC, 'features', 'chat', 'hooks', 'useChatSSE.ts'), 'utf-8');
const FOLLOW_UP_INPUT_AREA_SOURCE = fs.readFileSync(path.join(REACT_SRC, 'features', 'chat', 'FollowUpInputArea.tsx'), 'utf-8');
const SPLIT_SEND_BUTTON_SOURCE = fs.readFileSync(path.join(REACT_SRC, 'ui', 'SplitSendButton.tsx'), 'utf-8');
const CHAT_HEADER_SRC = fs.readFileSync(path.join(REACT_SRC, 'features', 'chat', 'ChatHeader.tsx'), 'utf-8');
const CONVERSATION_AREA_SOURCE = fs.readFileSync(path.join(REACT_SRC, 'features', 'chat', 'ConversationArea.tsx'), 'utf-8');
const MODE_CONFIG_SOURCE = fs.readFileSync(path.join(REACT_SRC, 'repos', 'modeConfig.ts'), 'utf-8');
const QUEUED_BUBBLE_SOURCE = fs.readFileSync(path.join(REACT_SRC, 'features', 'chat', 'QueuedBubble.tsx'), 'utf-8');
const CHAT_UTILS_SOURCE = fs.readFileSync(path.join(REACT_SRC, 'utils', 'chatUtils.ts'), 'utf-8');
const SCRATCHPAD_CANDIDATES_SOURCE = fs.readFileSync(path.join(REACT_SRC, 'features', 'chat', 'scratchpad', 'scratchpadCandidates.ts'), 'utf-8');
const SCRATCHPAD_STATE_SOURCE = fs.readFileSync(path.join(REACT_SRC, 'features', 'chat', 'scratchpad', 'useScratchpadState.ts'), 'utf-8');

describe('ChatDetail', () => {
    let source: string;
    let payloadSource: string;
    let infoSource: string;

    beforeAll(() => {
        source = fs.readFileSync(ACTIVITY_CHAT_DETAIL_PATH, 'utf-8');
        payloadSource = fs.readFileSync(PENDING_PAYLOAD_PATH, 'utf-8');
        infoSource = fs.readFileSync(PENDING_INFO_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports ChatDetail as a named export', () => {
            expect(source).toContain('export function ChatDetail');
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

        it('uses distance-based scroll guard for subsequent turns', () => {
            const scrollEffect = source.substring(
                source.indexOf('Scroll to bottom on new turns'),
                source.indexOf('Scroll to bottom on new turns') + 700,
            );
            expect(scrollEffect).toContain('dist < 100');
        });
    });

    describe('mode selector', () => {
        it('declares selectedMode state with ask default', () => {
            // selectedMode is now typed as ChatMode (which includes 'ralph')
            // so the follow-up Ralph pill can promote ask-mode chats.
            expect(source).toContain("useState<ChatMode>('ask')");
        });

        it('renders mode selector using the segmented ModePillSelector by default', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('data-testid="mode-selector"');
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('<ModePillSelector');
            // Legacy compact-only controls are still present for the
            // compactModeSelector branch used by narrow side panels.
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('data-testid="mode-cycle-btn"');
        });

        it('imports ModePillSelector and exposes pill options for the new layout', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('ModePillSelector');
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('getVisibleModePillOptions');
            // The compact branch still references MODE_ICONS for its cycle button.
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('MODE_ICONS');
        });

        it('sends selectedMode in follow-up message body', () => {
            const requestBlock = USE_SEND_MESSAGE_SOURCE.substring(
                USE_SEND_MESSAGE_SOURCE.indexOf('const buildMessageRequest'),
                USE_SEND_MESSAGE_SOURCE.indexOf('const buildMessageRequest') + 1200,
            );
            expect(requestBlock).toContain('mode: options.modeOverride ?? selectedMode');
        });

        it('initializes selectedMode from draft mode on load', () => {
            // Mode is no longer restored from task payload — always defaults to 'ask'
            expect(source).toContain("selectedMode");
        });

        it('mode selector is visible by default (hideModeSelector defaults to false)', () => {
            expect(source).toContain("hideModeSelector = false");
        });

        it('compactModeSelector defaults to false', () => {
            expect(source).toContain("compactModeSelector = false");
        });

        it('declares compactModeSelector in ChatDetailProps', () => {
            const propsBlock = source.substring(
                source.indexOf('export interface ChatDetailProps'),
                source.indexOf('export function ChatDetail'),
            );
            expect(propsBlock).toContain('compactModeSelector?:');
        });

        it('forwards compactModeSelector to every FollowUpInputArea instance', () => {
            const followUpUsages = source.split('<FollowUpInputArea').slice(1);
            expect(followUpUsages.length).toBeGreaterThanOrEqual(2);
            for (const usage of followUpUsages) {
                const block = usage.substring(0, usage.indexOf('/>'));
                expect(block).toContain('compactModeSelector={compactModeSelector}');
            }
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

        it('Shift+Tab cycles modes via MODE_ORDER array', () => {
            expect(MODE_CONFIG_SOURCE).toContain('MODE_ORDER');
            expect(MODE_CONFIG_SOURCE).toContain('DEFAULT_CHAT_MODES: readonly ChatMode[] = WORKFLOW_REGISTRY');
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
                FOLLOW_UP_INPUT_AREA_SOURCE.indexOf('onKeyDown={(e) =>'),
                FOLLOW_UP_INPUT_AREA_SOURCE.indexOf('onPaste={(e: React.ClipboardEvent)'),
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
            // AC-07: ChatDetail routes through the clone-aware client.
            expect(source).toContain('client.skills.listAllWorkspace');
        });

        it('initializes useSlashCommands with augmentedSkills', () => {
            expect(source).toContain('useSlashCommands(augmentedSkills)');
        });

        it('renders SlashCommandMenu with correct props', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('<SlashCommandMenu');
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('skills={skills}');
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('filter={slashCommands.menuFilter}');
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('visible={slashCommands.menuVisible}');
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('highlightIndex={slashCommands.highlightIndex}');
        });

        it('calls handleInputChange on input change', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('slashCommands.handleInputChange(');
        });

        it('calls handleKeyDown for slash menu keyboard navigation', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('slashCommands.handleKeyDown(e)');
        });

        it('extracts skills from message before sending', () => {
            const sendBlock = USE_SEND_MESSAGE_SOURCE.substring(
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp'),
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp') + 10000,
            );
            const requestBlock = USE_SEND_MESSAGE_SOURCE.substring(
                USE_SEND_MESSAGE_SOURCE.indexOf('const buildMessageRequest'),
                USE_SEND_MESSAGE_SOURCE.indexOf('const buildMessageRequest') + 1200,
            );
            expect(sendBlock).toContain('slashCommands.parseAndExtract(');
            expect(requestBlock).toContain('skillNames');
        });

        it('dismisses slash menu on send', () => {
            const sendBlock = USE_SEND_MESSAGE_SOURCE.substring(
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp'),
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp') + 3000,
            );
            expect(sendBlock).toContain('slashCommands.dismissMenu()');
        });
    });

    describe('file attachment integration', () => {
        it('imports useFileAttachments hook', () => {
            expect(source).toContain("import { useFileAttachments } from './hooks/useFileAttachments'");
        });

        it('imports AttachmentPreviews component', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain("import { AttachmentPreviews } from '../../ui/AttachmentPreviews'");
        });

        it('destructures useFileAttachments result', () => {
            expect(source).toContain('const { attachments, images, addFromPaste, addFromFileInput, removeAttachment, clearAttachments, error: attachmentError, toPayload } = useFileAttachments()');
        });

        it('attaches onPaste handler to follow-up input', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('onAttachmentPaste(e)');
        });

        it('renders AttachmentPreviews with attachments and onRemove', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('<AttachmentPreviews attachments={attachments} onRemove={onAttachmentRemove}');
        });

        it('includes images in sendFollowUp POST body', () => {
            const sendFollowUpSection = USE_SEND_MESSAGE_SOURCE.substring(USE_SEND_MESSAGE_SOURCE.indexOf('const buildMessageRequest'));
            expect(sendFollowUpSection).toContain('images: ');
            expect(sendFollowUpSection).toContain('images.length > 0 ? images : undefined');
        });

        it('clears images immediately after send (before waiting for completion)', () => {
            const sendFollowUpSection = USE_SEND_MESSAGE_SOURCE.substring(USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp'));
            const waitIdx = sendFollowUpSection.indexOf('await waitForSendCompletion');
            const clearIdx = sendFollowUpSection.indexOf('clearImages()');
            const catchIdx = sendFollowUpSection.indexOf('} catch');
            expect(waitIdx).toBeGreaterThan(-1);
            expect(clearIdx).toBeGreaterThan(-1);
            expect(clearIdx).toBeLessThan(waitIdx);
            expect(clearIdx).toBeLessThan(catchIdx);
        });
    });

    describe('follow-up send', () => {
        it('sends through the typed processes client message endpoint', () => {
            // AC-07: the follow-up send is routed to the chat's clone server.
            expect(USE_SEND_MESSAGE_SOURCE).toContain('getCocClientForWorkspace(workspaceId).processes.sendMessage');
        });

        it('sends content in the body', () => {
            expect(USE_SEND_MESSAGE_SOURCE).toContain('content: rawContent,');
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

        it('derives active generation from process/task status and SSE state', () => {
            // effectiveStatus prefers processDetails.status with task.status as fallback,
            // but flips to task.status when processDetails is still the synthesised queued
            // snapshot and task has advanced — see the queued→non-queued window comment.
            expect(source).toMatch(/effectiveStatus\b[\s\S]{0,400}processDetails\?\.status[\s\S]{0,200}task\?\.status/);
            expect(source).toContain("effectiveStatus === 'running' || effectiveStatus === 'cancelling' || isStreaming");
            expect(source).toContain("const isCancelling = effectiveStatus === 'cancelling'");
        });

        it('passes active generation state to useSendMessage and FollowUpInputArea', () => {
            const sendMessageBlock = source.substring(
                source.indexOf('useSendMessage({'),
                source.indexOf('useSendMessage({') + 700,
            );
            expect(sendMessageBlock).toContain('isActiveGeneration');
            expect(source).toContain('isActiveGeneration={isActiveGeneration}');
            expect(source).toContain('isCancelling={isCancelling}');
        });

        it('renders Stop from active generation instead of local sending state', () => {
            // The stop button is now defined as a `stopButton` JSX variable
            // and reused for both the compact + stacked layouts.
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('data-testid="activity-chat-stop-btn"');
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('{isActiveGeneration ? stopButton');
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain("isCancelling ? 'Stopping...' : 'Stop'");
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).not.toContain('{sending ? (');
        });

        it('branches active follow-up sends on durable active generation state', () => {
            const sendStart = USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp');
            const sendBlock = USE_SEND_MESSAGE_SOURCE.substring(sendStart, sendStart + 8000);
            expect(sendBlock).toContain('if (sending && !isActiveGeneration) return');
            expect(sendBlock).toContain('if (isActiveGeneration)');
        });
    });

    describe('session expiry (410)', () => {
        it('detects 410 status on follow-up', () => {
            expect(USE_SEND_MESSAGE_SOURCE).toContain('err instanceof CocApiError && err.status === 410');
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
            // The composer is also suppressed in the read-only sub-agent detail view.
            expect(source).toContain('!isPending && !noSessionForFollowUp && !readOnly && !showSubAgentDetail && (');
        });

        it('shows informational message when follow-up is unavailable', () => {
            expect(source).toContain('!isPending && noSessionForFollowUp && !readOnly && !showSubAgentDetail && (');
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
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp') + 10000,
            );
            // Should NOT set lastFailedMessageRef eagerly before the typed client request
            const preamble = sendBlock.substring(0, sendBlock.indexOf('await getCocClientForWorkspace(workspaceId).processes.sendMessage'));
            expect(preamble).not.toContain('lastFailedMessageRef.current = rawContent');

            // Typed client failures converge through the catch path.
            const matches = sendBlock.match(/lastFailedMessageRef\.current = rawContent/g);
            expect(matches).not.toBeNull();
            expect(matches!.length).toBeGreaterThanOrEqual(1);
        });

        it('clears lastFailedMessageRef on successful send', () => {
            const sendBlock = USE_SEND_MESSAGE_SOURCE.substring(
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp'),
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp') + 10000,
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
            expect(source).toContain('client.queue.cancel(bareTaskId)');
            expect(source).toContain("SELECT_QUEUE_TASK', id: null");
        });

        it('defines handleMoveToTop that POSTs move-to-top', () => {
            expect(source).toContain('handleMoveToTop');
            expect(source).toContain('client.queue.moveToTop(bareTaskId)');
        });

        it('passes cancel and moveToTop to PendingTaskInfoPanel', () => {
            expect(source).toContain('onCancel={handleCancel}');
            expect(source).toContain('onMoveToTop={handleMoveToTop}');
        });
    });

    describe('PendingTaskInfoPanel integration', () => {
        it('imports PendingTaskInfoPanel', () => {
            expect(CONVERSATION_AREA_SOURCE).toContain("import { PendingTaskInfoPanel } from '../../queue/PendingTaskInfoPanel'");
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

        it('all pending tasks use PendingTaskInfoPanel (chat tasks no longer exempt)', () => {
            // Commit 71eaab5fd removed the task?.type === 'chat' exception; all pending tasks now render PendingTaskInfoPanel
            expect(CONVERSATION_AREA_SOURCE).toContain('PendingTaskInfoPanel');
            expect(CONVERSATION_AREA_SOURCE).not.toContain("task?.type === 'chat'");
        });
    });

    describe('conversation caching', () => {
        it('imports useApp from AppContext', () => {
            expect(source).toContain("import { useApp } from '../../contexts/AppContext'");
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
                source.indexOf('Load task + conversation on mount / taskId change') + 1200,
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
            expect(payloadSource).toContain('getSpaCocClient().queue.images(task.id)');
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
        it('defines MODE_BORDER_COLORS mapping for active modes', () => {
            expect(MODE_CONFIG_SOURCE).toContain('MODE_BORDER_COLORS');
            expect(MODE_CONFIG_SOURCE).toContain("border: 'border-green-500 dark:border-green-400'");
            expect(MODE_CONFIG_SOURCE).toContain("border: 'border-yellow-500 dark:border-yellow-400'");
            expect(MODE_CONFIG_SOURCE).toContain("border: 'border-purple-500 dark:border-purple-400'");
            expect(MODE_CONFIG_SOURCE).not.toContain('border-blue-500');
        });

        // Regression guard for the “double-border” bug where the stacked
        // chat-input card showed Tailwind’s default blue ring on top of the
        // mode-coloured border. The fix requires `focus-within:` (not
        // `focus:`) so the ring colour propagates to the parent card whose
        // focused descendant is a contenteditable input.
        it('uses focus-within: prefix on the ring (not bare focus:)', () => {
            expect(MODE_CONFIG_SOURCE).not.toMatch(/ring:\s*'focus:ring-/);
            expect(MODE_CONFIG_SOURCE).toMatch(/ring:\s*'focus-within:ring-(green|yellow|blue)-500\/30'/);
        });

        it('applies dynamic border class from MODE_BORDER_COLORS to rich text input', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('MODE_BORDER_COLORS[selectedMode].border');
        });

        it('applies dynamic focus ring class from MODE_BORDER_COLORS to rich text input', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('MODE_BORDER_COLORS[selectedMode].ring');
        });

        it('uses cn() utility to compose RichTextInput classes with mode border', () => {
            const textareaBlock = FOLLOW_UP_INPUT_AREA_SOURCE.substring(
                FOLLOW_UP_INPUT_AREA_SOURCE.indexOf('<RichTextInput') - 50,
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

        it('inputDisabled includes loading so input is disabled while data is being fetched', () => {
            const expr = source.substring(
                source.indexOf('const inputDisabled'),
                source.indexOf('const inputDisabled') + 200,
            );
            expect(expr).toContain('loading');
        });

        it('inputDisabled includes cancelled so input is disabled when cancelled', () => {
            const expr = source.substring(
                source.indexOf('const inputDisabled'),
                source.indexOf('const inputDisabled') + 200,
            );
            expect(expr).toContain("'cancelled'");
        });

        it('imports DeliveryMode from pipeline-core', () => {
            expect(USE_SEND_MESSAGE_SOURCE).toContain("import type { DeliveryMode } from '@plusplusoneplusplus/forge'");
        });

        it('declares QueuedMessage interface with correct status union', () => {
            expect(CHAT_UTILS_SOURCE).toContain("status: 'queued' | 'steering'");
        });

        it('declares pendingQueue state', () => {
            expect(source).toContain('useState<QueuedMessage[]>([])');
        });

        it('does not use client-side flushQueueRef (server handles queue)', () => {
            expect(USE_SEND_MESSAGE_SOURCE).not.toContain('flushQueueRef');
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
        it('routes through /message when active generation is true', () => {
            const sendBlock = USE_SEND_MESSAGE_SOURCE.substring(
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp'),
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp') + 10000,
            );
            expect(sendBlock).toContain('if (isActiveGeneration)');
            expect(sendBlock).toContain('/message');
        });

        it('does not use client-side queue (server handles routing)', () => {
            expect(USE_SEND_MESSAGE_SOURCE).not.toContain('crypto.randomUUID()');
        });

        it('does not include optimisticId (server-routed)', () => {
            const sendBlock = USE_SEND_MESSAGE_SOURCE.substring(
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp'),
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp') + 10000,
            );
            expect(sendBlock).not.toContain('optimisticId');
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

        it('message-queued handler is an acknowledgement only', () => {
            const handler = USE_CHAT_SSE_SOURCE.substring(
                USE_CHAT_SSE_SOURCE.indexOf("es.addEventListener('message-queued'"),
                USE_CHAT_SSE_SOURCE.indexOf("es.addEventListener('message-queued'") + 300,
            );
            // Handler is empty — no client-side queue reconciliation
            expect(handler).not.toContain('setPendingQueue');
        });

        it('message-steering handler is an acknowledgement only', () => {
            const handler = USE_CHAT_SSE_SOURCE.substring(
                USE_CHAT_SSE_SOURCE.indexOf("es.addEventListener('message-steering'"),
                USE_CHAT_SSE_SOURCE.indexOf("es.addEventListener('message-steering'") + 300,
            );
            // Handler is empty — steering is handled server-side
            expect(handler).not.toContain('setPendingQueue');
        });

        it('handles message-queued SSE in follow-up stream', () => {
            // Follow-up SSE stream replaced by waitForSendCompletion + onSendComplete pattern;
            // message-queued is now handled by the main useChatSSE stream (see test above).
            expect(USE_SEND_MESSAGE_SOURCE).toContain('waitForSendCompletion');
        });

        it('handles message-steering SSE in follow-up stream', () => {
            // Follow-up SSE stream replaced by waitForSendCompletion + onSendComplete pattern;
            // message-steering is now handled by the main useChatSSE stream (see test above).
            expect(USE_SEND_MESSAGE_SOURCE).toContain('onSendComplete');
        });
    });

    describe('queue drain on done', () => {
        it('clears pending queue on done', () => {
            // finish() calls setPendingQueue([]) to clear the queue
            const finishStart = USE_CHAT_SSE_SOURCE.indexOf('const finish =');
            const finishBlock = USE_CHAT_SSE_SOURCE.substring(finishStart, finishStart + 2500);
            expect(finishBlock).toContain('setPendingQueue([])');
        });

        it('calls onSendComplete on done', () => {
            const finishStart = USE_CHAT_SSE_SOURCE.indexOf('const finish =');
            const finishBlock = USE_CHAT_SSE_SOURCE.substring(finishStart, finishStart + 2500);
            expect(finishBlock).toContain('onSendComplete()');
        });

        it('refreshes conversation in sendFollowUp finally block', () => {
            const sendBlock = USE_SEND_MESSAGE_SOURCE.substring(
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp'),
                USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp') + 10000,
            );
            expect(sendBlock).toContain('refreshConversation(processId)');
        });
    });

    describe('optimistic bubble rendering', () => {
        it('defines QueuedBubble component (deprecated wrapper)', () => {
            expect(QUEUED_BUBBLE_SOURCE).toContain('export function QueuedBubble');
        });

        it('QueuedBubble renders message content', () => {
            expect(QUEUED_BUBBLE_SOURCE).toContain('{msg.content}');
        });

        it('QueuedBubble uses data-status attribute', () => {
            expect(QUEUED_BUBBLE_SOURCE).toContain('data-status={msg.status}');
        });

        it('exposes a "Queued · N" mono-uppercase label per OpenDesign reference', () => {
            expect(QUEUED_BUBBLE_SOURCE).toContain('Queued ·');
            expect(QUEUED_BUBBLE_SOURCE).toContain("queued-label");
        });

        it('renders queued items with a dashed-border surface card (no clock emoji)', () => {
            expect(QUEUED_BUBBLE_SOURCE).toContain('border-dashed');
            expect(QUEUED_BUBBLE_SOURCE).not.toContain('🕐');
        });

        it('exposes an optional ✕ cancel button per item', () => {
            expect(QUEUED_BUBBLE_SOURCE).toContain('queued-item-cancel');
            expect(QUEUED_BUBBLE_SOURCE).toContain('aria-label="Cancel queued message"');
        });

        it('renders pendingQueue as QueuedFollowUps component with optional onCancel', () => {
            expect(CONVERSATION_AREA_SOURCE).toContain('<QueuedFollowUps queue={pendingQueue}');
            expect(CONVERSATION_AREA_SOURCE).toContain('onCancel={onCancelPendingMessage}');
        });

        it('renders queued bubbles with data-status attribute', () => {
            expect(QUEUED_BUBBLE_SOURCE).toContain('data-status={msg.status}');
        });
    });

    describe('queued-message cancellation wiring', () => {
        it('defines a handleCancelPendingMessage callback in ChatDetail', () => {
            expect(source).toContain('const handleCancelPendingMessage = useCallback');
        });

        it('routes cancellation through the coc client deletePendingMessage API', () => {
            expect(source).toContain('deletePendingMessage(processId, messageId)');
        });

        it('passes the cancel handler down to ConversationArea via onCancelPendingMessage', () => {
            expect(source).toContain('onCancelPendingMessage={handleCancelPendingMessage}');
        });

        it('declares onCancelPendingMessage on the ConversationArea props interface', () => {
            expect(CONVERSATION_AREA_SOURCE).toContain('onCancelPendingMessage?: (messageId: string) => void;');
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
                CONVERSATION_AREA_SOURCE.indexOf('<ConversationTurnBubble') + 400,
            );
            expect(bubbleCall).toContain('taskId={taskId}');
            expect(bubbleCall).toContain('wsId={wsId}');
        });
    });

    describe('data-ws-id on container root (References dropdown click fix)', () => {
        it('stamps data-ws-id on the activity-chat-detail root when workspaceId is provided', () => {
            // The root div must propagate workspaceId as data-ws-id so that
            // the global file-path-preview.ts click delegation can pick it up
            // for FilePathLink elements in ChatHeader (e.g. ReferencesDropdown).
            expect(source).toMatch(/data-testid="activity-chat-detail"[^>]*data-ws-id|data-ws-id[^>]*data-testid="activity-chat-detail"/);
        });

        it('uses workspaceId for data-ws-id spread on container', () => {
            const containerBlock = source.substring(
                source.indexOf('data-testid="activity-chat-detail"') - 20,
                source.indexOf('data-testid="activity-chat-detail"') + 120,
            );
            expect(containerBlock).toContain('workspaceId');
            expect(containerBlock).toContain('data-ws-id');
        });
    });

    describe('plan doc header pill', () => {
        it('derives planPath from context.files[0] with fallback to planFilePath', () => {
            const planPathBlock = source.substring(
                source.indexOf('const rawContextFile'),
                source.indexOf('const rawContextFile') + 300,
            );
            expect(planPathBlock).toContain('task?.payload?.context?.files?.[0]');
            expect(planPathBlock).toContain('task?.payload?.planFilePath');
            expect(planPathBlock).toContain("''");
        });

        it('guards context.files[0] with isAbsolutePath check', () => {
            expect(source).toContain('isAbsolutePath');
            const isAbsBlock = source.substring(
                source.indexOf('function isAbsolutePath'),
                source.indexOf('function isAbsolutePath') + 200,
            );
            expect(isAbsBlock).toContain("v.startsWith('/')");
        });

        it('uses ReferencesDropdown for plan path display (inline pill replaced)', () => {
            expect(CHAT_HEADER_SRC).toContain("import { ReferencesDropdown");
        });

        it('renders ReferencesDropdown with planPath and files after the status pill', () => {
            const statusPillIdx = CHAT_HEADER_SRC.indexOf('<ChatStatusPill');
            const refsIdx = CHAT_HEADER_SRC.indexOf(
                '<ReferencesDropdown planPath={planPath} files={createdFiles} wsId={wsId} />',
            );
            expect(refsIdx).toBeGreaterThan(statusPillIdx);
        });

        it('ReferencesDropdown is placed after the status pill in the header', () => {
            const statusPillIdx = CHAT_HEADER_SRC.indexOf('<ChatStatusPill');
            const refsIdx = CHAT_HEADER_SRC.indexOf(
                '<ReferencesDropdown planPath={planPath} files={createdFiles} wsId={wsId} />',
            );
            expect(refsIdx).toBeGreaterThan(statusPillIdx);
        });
    });

    describe('ConversationMiniMap integration', () => {
        it('imports ConversationMiniMap from chat directory', () => {
            expect(source).toContain("import { ConversationMiniMap }");
            expect(source).toContain("'./conversation/ConversationMiniMap'");
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

        it('hides minimap on mobile viewports', () => {
            // ConversationMiniMap must be conditionally hidden when isMobile is true
            expect(source).toContain('!isMobile');
        });

        it('imports useBreakpoint hook', () => {
            expect(source).toContain("import { useBreakpoint } from '../../hooks/ui/useBreakpoint'");
        });

        it('destructures isMobile from useBreakpoint', () => {
            expect(source).toContain('isMobile');
            expect(source).toContain('useBreakpoint()');
        });
    });

    describe('plan file chat reference (mid-conversation .plan.md detection)', () => {
        it('reads metadata.planFilePath in planPath derivation chain', () => {
            const planPathBlock = source.substring(
                source.indexOf('const rawContextFile'),
                source.indexOf('const rawContextFile') + 400,
            );
            expect(planPathBlock).toContain('task?.metadata?.planFilePath');
        });

        it('planPath fallback order is: context.files[0] → payload.planFilePath → metadata.planFilePath → empty', () => {
            const planPathBlock = source.substring(
                source.indexOf('const planPath'),
                source.indexOf('const planPath') + 300,
            );
            const contextIdx = planPathBlock.indexOf('rawContextFile');
            const payloadIdx = planPathBlock.indexOf('task?.payload?.planFilePath');
            const metadataIdx = planPathBlock.indexOf('task?.metadata?.planFilePath');
            const emptyIdx = planPathBlock.indexOf("''");
            expect(contextIdx).toBeLessThan(payloadIdx);
            expect(payloadIdx).toBeLessThan(metadataIdx);
            expect(metadataIdx).toBeLessThan(emptyIdx);
        });

        it('computes detectedPlanFile from createdFiles scanning for .plan.md', () => {
            expect(source).toContain('detectedPlanFile');
            const detectBlock = source.substring(
                source.indexOf('const detectedPlanFile'),
                source.indexOf('const detectedPlanFile') + 200,
            );
            expect(detectBlock).toContain(".endsWith('.plan.md')");
            expect(detectBlock).toContain('createdFiles.find');
        });

        it('computes effectivePlanPath = planPath || detectedPlanFile', () => {
            expect(source).toContain('const effectivePlanPath = planPath || detectedPlanFile');
        });

        it('deduplicates displayFiles by filtering out the effectivePlanPath', () => {
            expect(source).toContain('displayFiles');
            const displayBlock = source.substring(
                source.indexOf('const displayFiles'),
                source.indexOf('const displayFiles') + 200,
            );
            expect(displayBlock).toContain('createdFiles.filter');
            expect(displayBlock).toContain('effectivePlanPath');
        });

        it('passes effectivePlanPath to ChatHeader instead of raw planPath', () => {
            expect(source).toContain('planPath={effectivePlanPath}');
        });

        it('passes displayFiles to ChatHeader instead of raw createdFiles', () => {
            expect(source).toContain('createdFiles={displayFiles}');
        });

        it('uses a useRef guard (planPatchedRef) to fire PATCH at most once', () => {
            expect(source).toContain('planPatchedRef');
            expect(source).toContain('useRef(false)');
            const patchBlock = source.substring(
                source.indexOf('planPatchedRef.current = true'),
                source.indexOf('planPatchedRef.current = true') + 400,
            );
            expect(patchBlock).toContain('client.processes.update');
        });

        it('PATCH guard checks: no detectedPlanFile, or planPath already set, or metadata already has it', () => {
            const guardBlock = source.substring(
                source.indexOf('if (!detectedPlanFile'),
                source.indexOf('if (!detectedPlanFile') + 200,
            );
            expect(guardBlock).toContain('!detectedPlanFile');
            expect(guardBlock).toContain('planPath');
            expect(guardBlock).toContain('task?.metadata?.planFilePath');
            expect(guardBlock).toContain('!processId');
        });

        it('PATCH merges existing metadata with planFilePath', () => {
            const mergeBlock = source.substring(
                source.indexOf('const merged'),
                source.indexOf('const merged') + 200,
            );
            expect(mergeBlock).toContain('...(task?.metadata ?? {})');
            expect(mergeBlock).toContain('planFilePath: detectedPlanFile');
        });

        it('updates local task state from PATCH response', () => {
            const thenBlock = source.substring(
                source.indexOf('planPatchedRef.current = true'),
                source.indexOf('planPatchedRef.current = true') + 500,
            );
            expect(thenBlock).toContain('setTask');
            expect(thenBlock).toContain('data.process.metadata');
        });

        it('resets planPatchedRef when taskId changes', () => {
            expect(source).toContain('planPatchedRef.current = false');
            // Verify the reset is in a useEffect with [taskId] dependency
            const resetIdx = source.indexOf('planPatchedRef.current = false');
            const surroundingBlock = source.substring(resetIdx - 30, resetIdx + 400);
            expect(surroundingBlock).toContain('useEffect');
            expect(surroundingBlock).toContain('taskId');
        });

        it('takes the first .plan.md found (not the last)', () => {
            const detectBlock = source.substring(
                source.indexOf('const detectedPlanFile'),
                source.indexOf('const detectedPlanFile') + 200,
            );
            // .find() returns the first match, not .filter() or .at(-1)
            expect(detectBlock).toContain('createdFiles.find');
            expect(detectBlock).not.toContain('findLast');
        });

        it('builds scratchpad candidates from linked, known, created, and plan paths', () => {
            expect(source).toContain('buildScratchpadCandidates');
            expect(source).toContain('linkedNotePath: scratchpad.linkedNotePath');
            expect(source).toContain('knownFiles: scratchpad.knownFiles');
            expect(source).toContain('createdFiles');
            expect(source).toContain('effectivePlanPath');
        });

        it('tracks invalid scratchpad paths so deleted plan files are skipped', () => {
            expect(source).toContain('invalidScratchpadPaths');
            expect(source).toContain('setInvalidScratchpadPaths');
            expect(source).toContain('invalidPaths: invalidScratchpadPaths');
            expect(SCRATCHPAD_CANDIDATES_SOURCE).toContain('invalidPaths.has(key)');
        });

        it('retries the next scratchpad candidate instead of closing on note 404', () => {
            expect(source).toContain('handleScratchpadNotFound');
            const notFoundBlock = source.substring(
                source.indexOf('const handleScratchpadNotFound'),
                source.indexOf('const handleScratchpadNotFound') + 800,
            );
            expect(notFoundBlock).toContain('scratchpadCandidates.find');
            expect(notFoundBlock).toContain('scratchpad.unregisterFile');
            expect(notFoundBlock).toContain('scratchpad.open(nextPath)');
            expect(source).toContain('onNotFound={handleScratchpadNotFound}');
            expect(source).not.toContain('onNotFound={scratchpad.close}');
        });

        it('scratchpad state exposes unregisterFile for pruning stale tabs', () => {
            expect(SCRATCHPAD_STATE_SOURCE).toContain('unregisterFile: (path: string) => void');
            expect(SCRATCHPAD_STATE_SOURCE).toContain('setKnownFiles(prev => prev.filter');
            expect(SCRATCHPAD_STATE_SOURCE).toContain('writeLinkedNotePath(taskId, null)');
        });

        it('registers .plan.md files into the scratchpad tab list (AC-01, AC-03)', () => {
            // The registration effect must NOT filter out the plan file so that
            // .plan.md appears as a scratchpad tab alongside other .md files.
            const registerBlock = source.substring(
                source.indexOf('Register all .md files from created files into the scratchpad tab list'),
                source.indexOf('// Track scroll position'),
            );
            expect(registerBlock).toContain("filter(p => p.endsWith('.md'))");
            // Must NOT exclude the plan file any more
            expect(registerBlock).not.toContain('effectivePlanPath');
        });
    });

    describe('mobile responsiveness', () => {
        it('back button uses compact inline-flex styling without fixed min-h/min-w', () => {
            expect(CHAT_HEADER_SRC).not.toContain('min-h-11 min-w-11');
            expect(CHAT_HEADER_SRC).not.toContain('min-h-7 min-w-7');
            expect(CHAT_HEADER_SRC).toContain('inline-flex');
        });

        it('scroll-to-bottom button is 44px on mobile and 32px on sm+ screens', () => {
            expect(CONVERSATION_AREA_SOURCE).toContain('w-11 h-11 sm:w-8 sm:h-8');
        });

        it('FollowUpInputArea provides both the stacked and compact horizontal layouts', () => {
            // Default stacked layout
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('chat-input-stack');
            // Compact (legacy) layout for narrow side panels
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('flex flex-row items-center');
        });

        it('send button is always inline with shrink-0', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('shrink-0');
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).not.toContain('w-full sm:w-auto');
        });
    });

    describe('stop/cancel running response', () => {
        it('defines handleCancel function for queue deletion', () => {
            expect(source).toContain('handleCancel');
        });

        it('handleCancel calls DELETE to queue endpoint', () => {
            const cancelBlock = source.substring(
                source.indexOf('handleCancel'),
                source.indexOf('handleCancel') + 400,
            );
            expect(cancelBlock).toContain('client.queue.cancel(bareTaskId)');
        });

        it('stop button in FollowUpInputArea calls onStop on click', () => {
            const stopBtnIdx = FOLLOW_UP_INPUT_AREA_SOURCE.indexOf('activity-chat-stop-btn');
            const stopBtnBlock = FOLLOW_UP_INPUT_AREA_SOURCE.substring(stopBtnIdx - 300, stopBtnIdx + 50);
            expect(stopBtnBlock).toContain('onStop?.()');
        });

        it('stop button is shown during active generation', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('{isActiveGeneration ? stopButton');
        });
    });

    describe('ongoing-state indicator', () => {
        it('FollowUpInputArea renders stop button for active generation', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('data-testid="activity-chat-stop-btn"');
        });

        it('stop button shows "Stop" text', () => {
            const stopIdx = FOLLOW_UP_INPUT_AREA_SOURCE.indexOf('activity-chat-stop-btn');
            const stopBlock = FOLLOW_UP_INPUT_AREA_SOURCE.substring(stopIdx, stopIdx + 200);
            expect(stopBlock).toContain('Stop');
        });

        it('stop button uses red styling', () => {
            const stopIdx = FOLLOW_UP_INPUT_AREA_SOURCE.indexOf('activity-chat-stop-btn');
            const stopBlock = FOLLOW_UP_INPUT_AREA_SOURCE.substring(stopIdx - 600, stopIdx + 50);
            expect(stopBlock).toContain('f14c4c');
        });

        it('stop button is conditionally rendered based on active generation state', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('{isActiveGeneration ? stopButton');
        });
    });

    describe('send/stop toggle in FollowUpInputArea', () => {
        it('renders stop button with testid when sending or running', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('data-testid="activity-chat-stop-btn"');
        });

        it('stop button uses red background color', () => {
            const stopBtnIdx = FOLLOW_UP_INPUT_AREA_SOURCE.indexOf('activity-chat-stop-btn');
            const stopBtnBlock = FOLLOW_UP_INPUT_AREA_SOURCE.substring(stopBtnIdx - 600, stopBtnIdx + 50);
            expect(stopBtnBlock).toContain('f14c4c');
        });

        it('stop button invokes onStop callback on click', () => {
            const stopBtnIdx = FOLLOW_UP_INPUT_AREA_SOURCE.indexOf('activity-chat-stop-btn');
            const stopBtnBlock = FOLLOW_UP_INPUT_AREA_SOURCE.substring(stopBtnIdx - 600, stopBtnIdx + 50);
            expect(stopBtnBlock).toContain('onStop');
        });

        it('FollowUpInputArea declares onStop prop for cancel API', () => {
            expect(FOLLOW_UP_INPUT_AREA_SOURCE).toContain('onStop?:');
        });

        it('send button text is "Send" (no longer shows "...")', () => {
            // activity-chat-send-btn lives in SplitSendButton.tsx (SendButton component), not FollowUpInputArea
            const sendBtnIdx = SPLIT_SEND_BUTTON_SOURCE.indexOf('activity-chat-send-btn');
            const sendBtnBlock = SPLIT_SEND_BUTTON_SOURCE.substring(sendBtnIdx - 10, sendBtnIdx + 200);
            expect(sendBtnBlock).toContain('Send');
            expect(sendBtnBlock).not.toContain('...');
        });
    });

    describe('handleStop calls cancel API', () => {
        it('ChatDetail defines handleStop that POSTs to cancel endpoint', () => {
            const handleStopIdx = source.indexOf('handleStop');
            expect(handleStopIdx).toBeGreaterThan(-1);
            const handleStopBlock = source.substring(handleStopIdx, handleStopIdx + 300);
            expect(handleStopBlock).toContain('client.processes.cancel');
        });

        it('ChatDetail passes onStop={handleStop} to FollowUpInputArea', () => {
            expect(source).toContain('onStop={handleStop}');
        });
    });

    describe('refreshConversation syncs task state after completion', () => {
        it('refreshConversation updates processDetails from server', () => {
            const refreshBlock = source.substring(
                source.indexOf('const refreshConversation'),
                source.indexOf('const refreshConversation') + 600,
            );
            expect(refreshBlock).toContain('setProcessDetails');
        });

        it('refreshConversation syncs pending queue from server state', () => {
            const refreshBlock = source.substring(
                source.indexOf('const refreshConversation'),
                source.indexOf('const refreshConversation') + 1500,
            );
            expect(refreshBlock).toContain('setPendingQueue');
        });

        it('useChatSSE finish calls refreshConversation and onSendComplete', () => {
            const finishStart = USE_CHAT_SSE_SOURCE.indexOf('const finish =');
            const finishBlock = USE_CHAT_SSE_SOURCE.substring(finishStart, finishStart + 2500);
            expect(finishBlock).toContain('refreshConversation(processId)');
            expect(finishBlock).toContain('onSendComplete()');
        });

        it('useChatSSE finish clears pending queue', () => {
            const finishStart = USE_CHAT_SSE_SOURCE.indexOf('const finish =');
            const finishBlock = USE_CHAT_SSE_SOURCE.substring(finishStart, finishStart + 2500);
            expect(finishBlock).toContain('setPendingQueue([])');
        });

        it('useSendMessage finally block refreshes conversation as fallback', () => {
            // The non-Ralph send path's finally block calls refreshConversation
            // as a fallback. The Ralph promotion branch has its own finally
            // that only resets sending, so we look at the last `} finally {`.
            const finallyIdx = USE_SEND_MESSAGE_SOURCE.lastIndexOf('} finally {');
            const finallyBlock = USE_SEND_MESSAGE_SOURCE.substring(finallyIdx, finallyIdx + 600);
            expect(finallyBlock).toContain('refreshConversation(processId)');
        });
    });

    describe('useChatSSE finish() calls setTask then refreshConversation', () => {
        it('finish() calls setTask before refreshConversation', () => {
            const finishStart = USE_CHAT_SSE_SOURCE.indexOf('const finish =');
            const finishBlock = USE_CHAT_SSE_SOURCE.substring(finishStart, finishStart + 2500);
            const setTaskIdx = finishBlock.indexOf('setTask(prev =>');
            const refreshIdx = finishBlock.indexOf('refreshConversation(processId)');
            expect(setTaskIdx).toBeGreaterThan(-1);
            expect(refreshIdx).toBeGreaterThan(-1);
            // setTask should appear before refreshConversation in the code
            expect(setTaskIdx).toBeLessThan(refreshIdx);
        });

        it('finish calls refreshConversation directly (no .finally() wrapper)', () => {
            const finishStart = USE_CHAT_SSE_SOURCE.indexOf('const finish =');
            const finishBlock = USE_CHAT_SSE_SOURCE.substring(finishStart, finishStart + 2500);
            expect(finishBlock).toContain('void refreshConversation(processId)');
        });
    });

    describe('useSendMessage finally block refreshConversation fallback', () => {
        it('sendFollowUp finally block calls refreshConversation as fallback', () => {
            // The finally block in the main send path should call
            // refreshConversation as a safety fallback for the 90s timeout
            // path. The Ralph promotion branch has its own finally block
            // earlier in the function, so we search the last occurrence.
            const finallyIdx = USE_SEND_MESSAGE_SOURCE.lastIndexOf('} finally {');
            const finallyBlock = USE_SEND_MESSAGE_SOURCE.substring(
                finallyIdx,
                finallyIdx + 1200,
            );
            expect(finallyBlock).toContain('refreshConversation(processId)');
        });
    });

    describe('useSendMessage sets task status to running on follow-up', () => {
        it('sets task status to running after successful POST', () => {
            const sendFollowUpIdx = USE_SEND_MESSAGE_SOURCE.indexOf('const sendFollowUp = useCallback');
            const sendFollowUpBlock = USE_SEND_MESSAGE_SOURCE.substring(sendFollowUpIdx);
            const setTaskRunningIdx = sendFollowUpBlock.indexOf("setTask((prev: any) => prev ? { ...prev, status: 'running' }");
            expect(setTaskRunningIdx).toBeGreaterThan(-1);
        });

        it('does not dispatch REPO_TASK_REQUEUED (server handles requeue)', () => {
            expect(USE_SEND_MESSAGE_SOURCE).not.toContain('REPO_TASK_REQUEUED');
        });

        it('accepts an optional workspaceId for the Ralph promotion endpoint', () => {
            // workspaceId is forwarded to processes.promoteToRalph when the
            // user picks the Ralph mode pill on a follow-up. It is unused by
            // the regular /message send path.
            const optionsBlock = USE_SEND_MESSAGE_SOURCE.substring(
                USE_SEND_MESSAGE_SOURCE.indexOf('export interface UseSendMessageOptions'),
                USE_SEND_MESSAGE_SOURCE.indexOf('export function useSendMessage'),
            );
            expect(optionsBlock).toContain('workspaceId?: string');
            expect(USE_SEND_MESSAGE_SOURCE).toContain('promoteToRalph(processId');
        });
    });
});
