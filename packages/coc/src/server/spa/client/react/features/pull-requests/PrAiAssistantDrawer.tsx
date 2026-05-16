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
                    'fixed right-0 top-0 z-40 flex h-full w-[min(420px,92vw)] flex-col border-l border-gray-200 bg-white shadow-2xl transition-transform duration-200 ease-out dark:border-gray-700 dark:bg-gray-900',
                    open ? 'translate-x-0' : 'translate-x-full',
                )}
                aria-hidden={!open}
                data-testid="pr-ai-assistant"
            >
                <header className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="m-0 text-base font-semibold text-gray-900 dark:text-gray-100">
                            Ask about this PR
                        </h2>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close assistant"
                            className="grid h-7 w-7 place-items-center rounded-md border border-gray-300 bg-white text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                            data-testid="pr-ai-assistant-close"
                        >
                            ×
                        </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {['Diff', 'Checks', 'Threads', 'Commits'].map(chip => (
                            <span
                                key={chip}
                                className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                            >
                                {chip}
                            </span>
                        ))}
                    </div>
                    <div className="mt-3 grid gap-1.5">
                        {prompts.map(prompt => (
                            <button
                                key={prompt.id}
                                type="button"
                                onClick={() => handlePrompt(prompt.label)}
                                className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-left text-xs font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                                data-testid="pr-ai-prompt"
                            >
                                {prompt.label}
                            </button>
                        ))}
                    </div>
                </header>
                <div
                    ref={chatRef}
                    className="flex-1 overflow-y-auto px-4 py-3.5"
                    aria-live="polite"
                    data-testid="pr-ai-chat"
                >
                    {messages.map(message => (
                        <ChatBubble key={message.id} message={message} />
                    ))}
                </div>
                <form
                    className="border-t border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60"
                    onSubmit={handleSubmit}
                    data-testid="pr-ai-form"
                >
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={event => setInput(event.target.value)}
                        placeholder="Ask about risk, tests, files, or reviewer replies..."
                        className="w-full resize-y rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                        style={{ minHeight: 74 }}
                        data-testid="pr-ai-input"
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                            Grounded in PR{prNumber != null ? ` #${prNumber}` : ''}
                        </span>
                        <button
                            type="submit"
                            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-transparent bg-gradient-to-br from-purple-500 to-blue-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:opacity-95"
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
                className="mb-3 ml-8 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 dark:border-blue-900/40 dark:bg-blue-900/30"
                data-testid="pr-ai-message-user"
            >
                <p className="m-0 text-sm text-gray-900 dark:text-gray-100">{message.body}</p>
            </div>
        );
    }
    return (
        <div
            className="relative mb-3 mr-4 overflow-hidden rounded-lg border border-gray-200 bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-ai-message-ai"
        >
            <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-br from-purple-500 to-blue-500"
            />
            <p className="m-0 pl-1 text-sm text-gray-800 dark:text-gray-200">{message.body}</p>
            {message.sources && message.sources.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 pl-1">
                    {message.sources.map(source => (
                        <span
                            key={source}
                            className="rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[11px] text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
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
