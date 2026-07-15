/**
 * Tests for ItemConversationPanel component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// Mock RichTextInput as a simple textarea for testability
vi.mock('../../../../src/server/spa/client/react/shared/RichTextInput', async () => {
    const React = await import('react');
    return {
        RichTextInput: React.forwardRef(function RichTextInputMock(props: any, ref: any) {
            const { onChange, onKeyDown, onPaste, placeholder, disabled, 'data-testid': testId, className } = props;
            const textareaRef = React.useRef<HTMLTextAreaElement>(null);
            React.useImperativeHandle(ref, () => ({
                getValue: () => textareaRef.current?.value ?? '',
                setValue: (text: string) => { if (textareaRef.current) textareaRef.current.value = text; },
                focus: () => textareaRef.current?.focus(),
            }));
            return React.createElement('textarea', {
                ref: textareaRef,
                'data-testid': testId ?? 'item-conversation-textarea',
                placeholder,
                disabled,
                className,
                onChange: (e: any) => onChange?.(e.target.value),
                onKeyDown,
                onPaste,
            });
        }),
    };
});

// Mock AttachmentPreviews as a no-op
vi.mock('../../../../src/server/spa/client/react/ui/AttachmentPreviews', () => ({
    AttachmentPreviews: () => null,
}));

// Mock useFileAttachments with a default implementation
const mockAddFromPaste = vi.fn();
const mockRemoveAttachment = vi.fn();
const mockClearAttachments = vi.fn();
const mockToPayload = vi.fn(() => []);

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useFileAttachments', () => ({
    useFileAttachments: () => ({
        attachments: [],
        addFromPaste: mockAddFromPaste,
        removeAttachment: mockRemoveAttachment,
        clearAttachments: mockClearAttachments,
        error: null,
        toPayload: mockToPayload,
    }),
}));

import { ItemConversationPanel } from '../../../../src/server/spa/client/react/processes/dag/ItemConversationPanel';
import { resetSpaCocClientForTests } from '../../../../src/server/spa/client/react/api/cocClient';

function makeProcessResponse(overrides: Record<string, any> = {}) {
    return {
        process: {
            id: 'child-1',
            status: 'completed',
            durationMs: 2000,
            metadata: { itemIndex: 0, promptPreview: 'Analyze bug report #42' },
            conversationTurns: [
                { role: 'user', content: 'Analyze this bug', timeline: [] },
                { role: 'assistant', content: 'Here is the analysis...', timeline: [] },
            ],
            ...overrides,
        },
    };
}

function makeEmptyProcessResponse() {
    return {
        process: {
            id: 'child-1',
            status: 'completed',
            durationMs: 1000,
            metadata: { itemIndex: 0 },
        },
    };
}

describe('ItemConversationPanel', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        global.fetch = fetchMock;
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws' };
        mockAddFromPaste.mockClear();
        mockRemoveAttachment.mockClear();
        mockClearAttachments.mockClear();
        mockToPayload.mockClear();
        mockToPayload.mockReturnValue([]);
    });

    afterEach(() => {
        resetSpaCocClientForTests();
        vi.restoreAllMocks();
        delete (window as any).__DASHBOARD_CONFIG__;
    });

    it('shows Spinner loading state while fetching process', () => {
        fetchMock.mockReturnValue(new Promise(() => {})); // never resolves
        render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);
        expect(screen.getByTestId('item-conversation-loading')).toBeDefined();
    });

    it('renders conversation turns using ConversationTurnBubble', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeProcessResponse()),
        });

        render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

        await waitFor(() => {
            expect(screen.queryByTestId('item-conversation-loading')).toBeNull();
        });

        const body = screen.getByTestId('item-conversation-body');
        // ConversationTurnBubble renders with role-based classes/content
        expect(body.textContent).toContain('Analyze this bug');
        expect(body.textContent).toContain('Here is the analysis...');
    });

    it('shows empty state when no conversation data', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeEmptyProcessResponse()),
        });

        render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

        await waitFor(() => {
            expect(screen.getByTestId('item-conversation-empty')).toBeDefined();
        });

        expect(screen.getByTestId('item-conversation-empty').textContent).toBe('No conversation data available.');
    });

    it('shows process metadata in header (status badge, item index, duration)', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeProcessResponse()),
        });

        render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

        await waitFor(() => {
            const header = screen.getByTestId('item-conversation-header');
            expect(header).toBeDefined();
        });

        const header = screen.getByTestId('item-conversation-header');
        expect(header.textContent).toContain('Completed');
        expect(header.textContent).toContain('Item #0');
    });

    it('shows input preview when promptPreview exists', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeProcessResponse()),
        });

        render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

        await waitFor(() => {
            expect(screen.getByTestId('item-conversation-input-preview')).toBeDefined();
        });

        expect(screen.getByTestId('item-conversation-input-preview').textContent).toContain('Analyze bug report #42');
    });

    it('Send button calls POST /api/processes/:id/message with correct body', async () => {
        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(makeProcessResponse()),
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: () => Promise.resolve({}),
            })
            // Re-fetch after SSE
            .mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(makeProcessResponse()),
            });

        // Mock EventSource
        const mockEs = {
            addEventListener: vi.fn(),
            close: vi.fn(),
            onerror: null as any,
        };
        vi.stubGlobal('EventSource', vi.fn(function () { return mockEs; }));

        render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

        await waitFor(() => {
            expect(screen.queryByTestId('item-conversation-loading')).toBeNull();
        });

        const textarea = screen.getByTestId('item-conversation-textarea');
        fireEvent.change(textarea, { target: { value: 'Can you explain more?' } });

        const sendBtn = screen.getByText('Send');
        await act(async () => {
            fireEvent.click(sendBtn);
        });

        // Verify POST was called with correct body
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/processes/child-1/message',
            expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: 'Can you explain more?', deliveryMode: 'enqueue' }),
            }),
        );

        vi.unstubAllGlobals();
    });

    it('Escape key closes panel (calls onClose)', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeProcessResponse()),
        });

        const onClose = vi.fn();
        render(<ItemConversationPanel processId="child-1" onClose={onClose} isDark={false} />);

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });

    it('X button closes panel (calls onClose)', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeProcessResponse()),
        });

        const onClose = vi.fn();
        render(<ItemConversationPanel processId="child-1" onClose={onClose} isDark={false} />);

        await waitFor(() => {
            expect(screen.getByTestId('item-conversation-close')).toBeDefined();
        });

        fireEvent.click(screen.getByTestId('item-conversation-close'));
        expect(onClose).toHaveBeenCalled();
    });

    it('optimistic UI: user turn and streaming placeholder appear immediately on send', async () => {
        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(makeProcessResponse()),
            })
            .mockImplementation(() => new Promise(() => {})); // POST never resolves

        render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

        await waitFor(() => {
            expect(screen.queryByTestId('item-conversation-loading')).toBeNull();
        });

        const textarea = screen.getByTestId('item-conversation-textarea');
        fireEvent.change(textarea, { target: { value: 'Follow up question' } });

        await act(async () => {
            fireEvent.click(screen.getByText('Send'));
        });

        const body = screen.getByTestId('item-conversation-body');
        // Should contain the optimistic user message
        expect(body.textContent).toContain('Follow up question');
        // Button should still show "Send" (no split button anymore)
        expect(screen.getByText('Send')).toBeDefined();
    });

    it('session expired (410 response) shows expired message', async () => {
        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(makeProcessResponse()),
            })
            .mockResolvedValueOnce({
                ok: false,
                status: 410,
                json: () => Promise.resolve({}),
            });

        render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

        await waitFor(() => {
            expect(screen.queryByTestId('item-conversation-loading')).toBeNull();
        });

        const textarea = screen.getByTestId('item-conversation-textarea');
        fireEvent.change(textarea, { target: { value: 'test' } });

        await act(async () => {
            fireEvent.click(screen.getByText('Send'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('item-conversation-expired')).toBeDefined();
        });

        expect(screen.getByTestId('item-conversation-expired').textContent).toContain('Session expired');
    });

    it('SSE streaming updates conversation turns after send', async () => {
        const updatedProcess = makeProcessResponse({
            conversationTurns: [
                { role: 'user', content: 'Analyze this bug', timeline: [] },
                { role: 'assistant', content: 'Here is the analysis...', timeline: [] },
                { role: 'user', content: 'Tell me more', timeline: [] },
                { role: 'assistant', content: 'More details here.', timeline: [] },
            ],
        });

        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(makeProcessResponse()),
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: () => Promise.resolve({}),
            })
            // Re-fetch after SSE finish
            .mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(updatedProcess),
            });

        // Mock EventSource to fire 'done' immediately
        const eventListeners: Record<string, Function> = {};
        const mockEs = {
            addEventListener: vi.fn((event: string, handler: Function) => {
                eventListeners[event] = handler;
            }),
            close: vi.fn(),
            onerror: null as any,
        };
        vi.stubGlobal('EventSource', vi.fn(function () { return mockEs; }));

        render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

        await waitFor(() => {
            expect(screen.queryByTestId('item-conversation-loading')).toBeNull();
        });

        const textarea = screen.getByTestId('item-conversation-textarea');
        fireEvent.change(textarea, { target: { value: 'Tell me more' } });

        await act(async () => {
            fireEvent.click(screen.getByText('Send'));
        });

        // Simulate SSE 'done' event — triggers re-fetch
        await act(async () => {
            eventListeners['done']?.({ data: '{}', lastEventId: '' });
        });

        await waitFor(() => {
            const body = screen.getByTestId('item-conversation-body');
            expect(body.textContent).toContain('More details here.');
        });

        vi.unstubAllGlobals();
    });

    it('failed item (turn with isError) shows Retry functionality', async () => {
        const processWithError = makeProcessResponse({
            conversationTurns: [
                { role: 'user', content: 'Do something', timeline: [] },
                { role: 'assistant', content: 'Failed to send message.', isError: true, timeline: [] },
            ],
        });

        fetchMock.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(processWithError),
        });

        render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

        await waitFor(() => {
            const body = screen.getByTestId('item-conversation-body');
            expect(body.textContent).toContain('Failed to send message.');
        });
    });

    it('renders in portal on document.body', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeProcessResponse()),
        });

        render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

        // The overlay should be a child of document.body via portal
        const overlay = document.querySelector('[data-testid="item-conversation-overlay"]');
        expect(overlay).toBeDefined();
        expect(overlay?.parentElement).toBe(document.body);
    });

    it('textarea Enter sends message, Shift+Enter does not', async () => {
        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(makeProcessResponse()),
            })
            .mockImplementation(() => new Promise(() => {}));

        render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

        await waitFor(() => {
            expect(screen.queryByTestId('item-conversation-loading')).toBeNull();
        });

        const textarea = screen.getByTestId('item-conversation-textarea');
        fireEvent.change(textarea, { target: { value: 'test message' } });

        // Shift+Enter should NOT send
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
        expect(fetchMock).toHaveBeenCalledTimes(1); // only initial fetch

        // Plain Enter should send (enqueue mode)
        await act(async () => {
            fireEvent.keyDown(textarea, { key: 'Enter' });
        });

        // Second fetch call = POST message
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('disables send button when input is empty', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeProcessResponse()),
        });

        render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

        await waitFor(() => {
            expect(screen.queryByTestId('item-conversation-loading')).toBeNull();
        });

        const sendBtn = screen.getByText('Send');
        expect(sendBtn.hasAttribute('disabled') || sendBtn.closest('button')?.disabled).toBeTruthy();
    });

    it('send button has tooltip with keyboard shortcut hints', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(makeProcessResponse()),
        });

        render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

        await waitFor(() => {
            expect(screen.queryByTestId('item-conversation-loading')).toBeNull();
        });

        const sendBtn = screen.getByTestId('item-conversation-send');
        expect(sendBtn.getAttribute('title')).toBe(
            'Send (Enter) · Ctrl+Enter to steer AI · Shift+Enter for newline',
        );
    });

    it('shows error state when fetch fails', async () => {
        fetchMock.mockRejectedValue(new Error('Network error'));

        render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

        await waitFor(() => {
            expect(screen.getByTestId('item-conversation-error')).toBeDefined();
        });
    });

    describe('always-enabled input', () => {
        it('textarea is not disabled when sending is true (input stays live)', async () => {
            fetchMock
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve(makeProcessResponse()),
                })
                .mockImplementation(() => new Promise(() => {})); // POST never resolves

            render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

            await waitFor(() => {
                expect(screen.queryByTestId('item-conversation-loading')).toBeNull();
            });

            const textarea = screen.getByTestId('item-conversation-textarea');
            fireEvent.change(textarea, { target: { value: 'first message' } });

            // Trigger send — sending becomes true
            await act(async () => {
                fireEvent.keyDown(textarea, { key: 'Enter' });
            });

            // Textarea should NOT be disabled even while sending
            expect(textarea.disabled).toBe(false);
        });

        it('textarea is disabled when sessionExpired is true', async () => {
            fetchMock
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve(makeProcessResponse()),
                })
                .mockResolvedValueOnce({
                    ok: false,
                    status: 410,
                    json: () => Promise.resolve({}),
                });

            render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

            await waitFor(() => {
                expect(screen.queryByTestId('item-conversation-loading')).toBeNull();
            });

            const textarea = screen.getByTestId('item-conversation-textarea');
            fireEvent.change(textarea, { target: { value: 'test' } });

            await act(async () => {
                fireEvent.click(screen.getByText('Send'));
            });

            await waitFor(() => {
                expect(screen.getByTestId('item-conversation-expired')).toBeDefined();
            });

            expect(textarea.disabled).toBe(true);
        });

        it('includes deliveryMode in POST body', async () => {
            fetchMock
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve(makeProcessResponse()),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({}),
                })
                .mockResolvedValue({
                    ok: true,
                    json: () => Promise.resolve(makeProcessResponse()),
                });

            const mockEs = {
                addEventListener: vi.fn(),
                close: vi.fn(),
                onerror: null as any,
            };
            vi.stubGlobal('EventSource', vi.fn(function () { return mockEs; }));

            render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

            await waitFor(() => {
                expect(screen.queryByTestId('item-conversation-loading')).toBeNull();
            });

            const textarea = screen.getByTestId('item-conversation-textarea');
            fireEvent.change(textarea, { target: { value: 'test message' } });

            // Plain Enter → enqueue
            await act(async () => {
                fireEvent.keyDown(textarea, { key: 'Enter' });
            });

            const postCall = fetchMock.mock.calls.find(
                (c: any[]) => c[1]?.method === 'POST',
            );
            expect(postCall).toBeDefined();
            const body = JSON.parse(postCall![1].body);
            expect(body.deliveryMode).toBe('enqueue');

            vi.unstubAllGlobals();
        });

        it('Ctrl+Enter sends with immediate delivery mode', async () => {
            fetchMock
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve(makeProcessResponse()),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({}),
                })
                .mockResolvedValue({
                    ok: true,
                    json: () => Promise.resolve(makeProcessResponse()),
                });

            const mockEs = {
                addEventListener: vi.fn(),
                close: vi.fn(),
                onerror: null as any,
            };
            vi.stubGlobal('EventSource', vi.fn(function () { return mockEs; }));

            render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

            await waitFor(() => {
                expect(screen.queryByTestId('item-conversation-loading')).toBeNull();
            });

            const textarea = screen.getByTestId('item-conversation-textarea');
            fireEvent.change(textarea, { target: { value: 'urgent message' } });

            // Ctrl+Enter → immediate
            await act(async () => {
                fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
            });

            const postCall = fetchMock.mock.calls.find(
                (c: any[]) => c[1]?.method === 'POST',
            );
            expect(postCall).toBeDefined();
            const body = JSON.parse(postCall![1].body);
            expect(body.deliveryMode).toBe('immediate');

            vi.unstubAllGlobals();
        });
    });

    describe('image paste support', () => {
        it('wires onPaste handler from useFileAttachments to RichTextInput', async () => {
            fetchMock.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(makeProcessResponse()),
            });

            render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

            await waitFor(() => {
                expect(screen.queryByTestId('item-conversation-loading')).toBeNull();
            });

            const textarea = screen.getByTestId('item-conversation-textarea');
            fireEvent.paste(textarea);

            expect(mockAddFromPaste).toHaveBeenCalled();
        });

        it('clears attachments after sending a message', async () => {
            fetchMock
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve(makeProcessResponse()),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({}),
                })
                .mockResolvedValue({
                    ok: true,
                    json: () => Promise.resolve(makeProcessResponse()),
                });

            const mockEs = {
                addEventListener: vi.fn(),
                close: vi.fn(),
                onerror: null as any,
            };
            vi.stubGlobal('EventSource', vi.fn(function () { return mockEs; }));

            render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

            await waitFor(() => {
                expect(screen.queryByTestId('item-conversation-loading')).toBeNull();
            });

            const textarea = screen.getByTestId('item-conversation-textarea');
            fireEvent.change(textarea, { target: { value: 'message with image' } });

            await act(async () => {
                fireEvent.click(screen.getByText('Send'));
            });

            expect(mockClearAttachments).toHaveBeenCalled();

            vi.unstubAllGlobals();
        });

        it('includes attachments in POST body when toPayload returns items', async () => {
            const fakePayload = [{ type: 'image', data: 'data:image/png;base64,abc', name: 'test.png' }];
            mockToPayload.mockReturnValue(fakePayload);

            fetchMock
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve(makeProcessResponse()),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({}),
                })
                .mockResolvedValue({
                    ok: true,
                    json: () => Promise.resolve(makeProcessResponse()),
                });

            const mockEs = {
                addEventListener: vi.fn(),
                close: vi.fn(),
                onerror: null as any,
            };
            vi.stubGlobal('EventSource', vi.fn(function () { return mockEs; }));

            render(<ItemConversationPanel processId="child-1" onClose={vi.fn()} isDark={false} />);

            await waitFor(() => {
                expect(screen.queryByTestId('item-conversation-loading')).toBeNull();
            });

            const textarea = screen.getByTestId('item-conversation-textarea');
            fireEvent.change(textarea, { target: { value: 'check this screenshot' } });

            await act(async () => {
                fireEvent.click(screen.getByText('Send'));
            });

            const postCall = fetchMock.mock.calls.find(
                (c: any[]) => c[1]?.method === 'POST',
            );
            expect(postCall).toBeDefined();
            const body = JSON.parse(postCall![1].body);
            expect(body.attachments).toEqual(fakePayload);

            vi.unstubAllGlobals();
        });
    });
});
