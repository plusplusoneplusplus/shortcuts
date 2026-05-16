/**
 * Right-side AI assistant drawer. Shown as a slide-over on small screens
 * and as a docked panel on wide screens. All replies are produced from
 * deterministic mock fixtures via getMockAiAnswer.
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '../../ui';
import {
    getMockAiAnswer,
    getMockSeedChat,
    getMockSuggestedPrompts,
} from './pr-mock-data';
import type { AiChatMessage } from './pr-mock-data';

interface PrAiAssistantDrawerProps {
    open: boolean;
    onClose: () => void;
    prNumber?: number;
}

export function PrAiAssistantDrawer({ open, onClose, prNumber }: PrAiAssistantDrawerProps) {
    const [messages, setMessages] = useState<AiChatMessage[]>(() => getMockSeedChat());
    const [input, setInput] = useState('');
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const chatRef = useRef<HTMLDivElement | null>(null);
    const prompts = getMockSuggestedPrompts();

    useEffect(() => {
        if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }, [messages]);

    function appendUserAndAi(question: string) {
        const trimmed = question.trim();
        if (!trimmed) return;
        const { answer, sources } = getMockAiAnswer(trimmed);
        const now = Date.now();
        setMessages(prev => [
            ...prev,
            { id: `u-${now}`, role: 'user', body: trimmed },
            { id: `a-${now}`, role: 'ai', body: answer, sources },
        ]);
    }

    function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        appendUserAndAi(input);
        setInput('');
    }

    function handlePrompt(label: string) {
        setInput(label);
        requestAnimationFrame(() => inputRef.current?.focus());
    }

    return (
        <>
            {open && (
                <button
                    type="button"
                    aria-label="Dismiss AI assistant"
                    onClick={onClose}
                    className="fixed inset-0 z-30 cursor-default bg-black/30 lg:hidden"
                    data-testid="pr-ai-assistant-backdrop"
                />
            )}
            <aside
                className={cn(
                    'fixed right-0 top-0 z-40 flex h-full w-[min(390px,92vw)] flex-col border-l border-gray-200 bg-white shadow-2xl transition-transform duration-200 ease-out dark:border-gray-700 dark:bg-gray-900',
                    open ? 'translate-x-0' : 'translate-x-full',
                )}
                aria-hidden={!open}
                data-testid="pr-ai-assistant"
            >
                <header className="border-b border-gray-200 p-2 dark:border-gray-700">
                    <div className="flex items-center justify-between gap-1.5">
                        <h2 className="m-0 text-[13px] font-semibold leading-tight text-gray-900 dark:text-gray-100">
                            Ask about this PR
                        </h2>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close assistant"
                            className="grid h-6 w-6 place-items-center rounded-[5px] border border-gray-300 bg-white text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                            data-testid="pr-ai-assistant-close"
                        >
                            ×
                        </button>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                        {['Diff', 'Checks', 'Threads', 'Commits'].map(chip => (
                            <span
                                key={chip}
                                className="rounded-full border border-gray-200 bg-gray-50 px-1.5 py-px text-[11px] font-semibold text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                            >
                                {chip}
                            </span>
                        ))}
                    </div>
                    <div className="mt-1.5 grid gap-1">
                        {prompts.map(prompt => (
                            <button
                                key={prompt.id}
                                type="button"
                                onClick={() => handlePrompt(prompt.label)}
                                className="min-h-[24px] w-full rounded-[5px] border border-gray-300 bg-white px-1.5 py-[3px] text-left text-[11px] font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                                data-testid="pr-ai-prompt"
                            >
                                {prompt.label}
                            </button>
                        ))}
                    </div>
                </header>
                <div
                    ref={chatRef}
                    className="flex-1 overflow-y-auto p-2"
                    aria-live="polite"
                    data-testid="pr-ai-chat"
                >
                    {messages.map(message => (
                        <ChatBubble key={message.id} message={message} />
                    ))}
                </div>
                <form
                    className="border-t border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800/60"
                    onSubmit={handleSubmit}
                    data-testid="pr-ai-form"
                >
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={event => setInput(event.target.value)}
                        placeholder="Ask about risk, tests, files, or reviewer replies..."
                        className="w-full resize-y rounded-[5px] border border-gray-300 bg-white px-[7px] py-[5px] text-[12px] text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                        style={{ minHeight: 48 }}
                        data-testid="pr-ai-input"
                    />
                    <div className="mt-[5px] flex items-center justify-between gap-1.5">
                        <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">
                            Grounded in PR{prNumber != null ? ` #${prNumber}` : ''}
                        </span>
                        <button
                            type="submit"
                            className="inline-flex min-h-[24px] items-center justify-center gap-1 rounded-[5px] border border-transparent bg-gradient-to-br from-purple-500 to-blue-500 px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-sm hover:opacity-95"
                            data-testid="pr-ai-submit"
                        >
                            Ask
                        </button>
                    </div>
                </form>
            </aside>
        </>
    );
}

function ChatBubble({ message }: { message: AiChatMessage }) {
    if (message.role === 'user') {
        return (
            <div
                className="mb-1.5 ml-3 rounded-[5px] border border-blue-100 bg-blue-50 px-2 py-1.5 dark:border-blue-900/40 dark:bg-blue-900/30"
                data-testid="pr-ai-message-user"
            >
                <p className="m-0 text-[12px] leading-[1.38] text-gray-900 dark:text-gray-100">{message.body}</p>
            </div>
        );
    }
    return (
        <div
            className="relative mb-1.5 mr-1 overflow-hidden rounded-[5px] border border-gray-200 bg-white px-2 py-1.5 dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-ai-message-ai"
        >
            <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-br from-purple-500 to-blue-500"
            />
            <p className="m-0 pl-1 text-[12px] leading-[1.38] text-gray-800 dark:text-gray-200">{message.body}</p>
            {message.sources && message.sources.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1 pl-1">
                    {message.sources.map(source => (
                        <span
                            key={source}
                            className="rounded-[5px] border border-gray-200 bg-gray-50 px-1.5 py-px font-mono text-[11px] leading-[1.4] text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                            data-testid="pr-ai-source"
                        >
                            {source}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
