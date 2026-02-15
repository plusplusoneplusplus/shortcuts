/**
 * Ask AI widget and Deep Dive script.
 *
 * Contains: updateAskSubject, expandWidget, collapseWidget, askPanelSend,
 * SSE streaming, message helpers, addDeepDiveButton, and keyboard shortcuts.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { componentGraph, escapeHtml } from './core';

let conversationHistory: Array<{ role: string; content: string }> = [];
let askStreaming = false;
let askPanelOpen = false;
let currentSessionId: string | null = null;

export function updateAskSubject(name: string): void {
    const el = document.getElementById('ask-bar-subject');
    if (el) el.textContent = name;
}

export function expandWidget(): void {
    if (askPanelOpen) return;
    askPanelOpen = true;
    const widget = document.getElementById('ask-widget');
    if (widget) widget.classList.add('expanded');
    const header = document.getElementById('ask-widget-header');
    if (header) header.classList.remove('hidden');
    const messages = document.getElementById('ask-messages');
    if (messages) messages.classList.remove('hidden');
}

export function collapseWidget(): void {
    askPanelOpen = false;
    const widget = document.getElementById('ask-widget');
    if (widget) widget.classList.remove('expanded');
    const header = document.getElementById('ask-widget-header');
    if (header) header.classList.add('hidden');
    const messages = document.getElementById('ask-messages');
    if (messages) messages.classList.add('hidden');
}

function askPanelSend(): void {
    if (askStreaming) return;
    const input = document.getElementById('ask-textarea') as HTMLTextAreaElement | null;
    if (!input) return;
    const question = input.value.trim();
    if (!question) return;

    expandWidget();

    input.value = '';
    input.style.height = 'auto';

    appendAskMessage('user', question);
    conversationHistory.push({ role: 'user', content: question });

    askStreaming = true;
    const sendBtn = document.getElementById('ask-widget-send') as HTMLButtonElement | null;
    if (sendBtn) sendBtn.disabled = true;

    let typingEl: HTMLElement | null = appendAskTyping();

    const requestBody: any = { question: question };
    if (currentSessionId) {
        requestBody.sessionId = currentSessionId;
    } else {
        requestBody.conversationHistory = conversationHistory.slice(0, -1);
    }

    fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
    }).then(function (response) {
        if (!response.ok) {
            return response.json().then(function (err: any) {
                throw new Error(err.error || 'Request failed');
            });
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullResponse = '';
        let contextShown = false;
        let responseEl: HTMLElement | null = null;

        function processChunk(result: ReadableStreamReadResult<Uint8Array>): any {
            if (result.done) {
                if (buffer.trim()) {
                    const remaining = buffer.trim();
                    if (remaining.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(remaining.slice(6));
                            if (data.type === 'chunk') {
                                fullResponse += data.content;
                                if (!responseEl) responseEl = appendAskAssistantStreaming('');
                                updateAskAssistantStreaming(responseEl, fullResponse);
                            } else if (data.type === 'done') {
                                fullResponse = data.fullResponse || fullResponse;
                                if (data.sessionId) currentSessionId = data.sessionId;
                            }
                        } catch (_e) { /* ignore */ }
                    }
                }
                finishStreaming(fullResponse, typingEl);
                return;
            }

            buffer += decoder.decode(result.value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line.startsWith('data: ')) continue;
                try {
                    const data = JSON.parse(line.slice(6));
                    if (data.type === 'context' && !contextShown) {
                        contextShown = true;
                        appendAskContext(data.componentIds, data.themeIds);
                    } else if (data.type === 'chunk') {
                        if (typingEl && typingEl.parentNode) {
                            typingEl.parentNode.removeChild(typingEl);
                            typingEl = null;
                        }
                        fullResponse += data.content;
                        if (!responseEl) responseEl = appendAskAssistantStreaming('');
                        updateAskAssistantStreaming(responseEl, fullResponse);
                    } else if (data.type === 'done') {
                        fullResponse = data.fullResponse || fullResponse;
                        if (data.sessionId) currentSessionId = data.sessionId;
                        finishStreaming(fullResponse, typingEl);
                        return;
                    } else if (data.type === 'error') {
                        appendAskError(data.message);
                        finishStreaming('', typingEl);
                        return;
                    }
                } catch (_e) { /* ignore */ }
            }

            return reader.read().then(processChunk);
        }

        return reader.read().then(processChunk);
    }).catch(function (err: any) {
        if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
        appendAskError(err.message || 'Failed to connect');
        finishStreaming('', null);
    });
}

function finishStreaming(fullResponse: string, typingEl: HTMLElement | null): void {
    if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
    askStreaming = false;
    const sendBtn = document.getElementById('ask-widget-send') as HTMLButtonElement | null;
    if (sendBtn) sendBtn.disabled = false;
    if (fullResponse) {
        conversationHistory.push({ role: 'assistant', content: fullResponse });
    }
}

function appendAskMessage(role: string, content: string): HTMLElement {
    const messages = document.getElementById('ask-messages')!;
    const div = document.createElement('div');
    div.className = 'ask-message';
    const inner = document.createElement('div');
    inner.className = 'ask-message-' + role;
    inner.textContent = content;
    div.appendChild(inner);
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
}

function appendAskAssistantStreaming(content: string): HTMLElement {
    const messages = document.getElementById('ask-messages')!;
    const div = document.createElement('div');
    div.className = 'ask-message';
    const inner = document.createElement('div');
    inner.className = 'ask-message-assistant';
    inner.innerHTML = '<div class="markdown-body">' + (typeof marked !== 'undefined' ? marked.parse(content) : escapeHtml(content)) + '</div>';
    div.appendChild(inner);
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return inner;
}

function updateAskAssistantStreaming(el: HTMLElement | null, content: string): void {
    if (!el) return;
    el.innerHTML = '<div class="markdown-body">' + (typeof marked !== 'undefined' ? marked.parse(content) : escapeHtml(content)) + '</div>';
    const messages = document.getElementById('ask-messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
}

function appendAskContext(componentIds: string[] | undefined, themeIds: string[] | undefined): void {
    if ((!componentIds || componentIds.length === 0) && (!themeIds || themeIds.length === 0)) return;
    const messages = document.getElementById('ask-messages');
    if (!messages) return;
    const div = document.createElement('div');
    div.className = 'ask-message-context';
    let parts: string[] = [];

    if (componentIds && componentIds.length > 0) {
        const links = componentIds.map(function (id: string) {
            const mod = componentGraph.components.find(function (m: any) { return m.id === id; });
            const name = mod ? mod.name : id;
            return '<a onclick="loadComponent(\'' + id.replace(/'/g, "\\'") + '\')">\ud83d\udce6 ' + escapeHtml(name) + '</a>';
        });
        parts = parts.concat(links);
    }

    if (themeIds && themeIds.length > 0) {
        const themeLinks = themeIds.map(function (ref: string) {
            const refParts = ref.split('/');
            const themeId = refParts[0] || ref;
            const slug = refParts[1] || themeId;
            return '<a onclick="loadThemeArticle(\'' + themeId.replace(/'/g, "\\'") + '\', \'' + slug.replace(/'/g, "\\'") + '\')">\ud83d\udccb ' + escapeHtml(ref) + '</a>';
        });
        parts = parts.concat(themeLinks);
    }

    div.innerHTML = 'Context: ' + parts.join(', ');
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
}

function appendAskTyping(): HTMLElement {
    const messages = document.getElementById('ask-messages')!;
    const div = document.createElement('div');
    div.className = 'ask-message';
    const inner = document.createElement('div');
    inner.className = 'ask-message-typing';
    inner.textContent = 'Thinking';
    div.appendChild(inner);
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
}

function appendAskError(message: string): void {
    const messages = document.getElementById('ask-messages');
    if (!messages) return;
    const div = document.createElement('div');
    div.className = 'ask-message-error';
    div.textContent = 'Error: ' + message;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
}

// Deep Dive (Explore Further)
let deepDiveStreaming = false;

export function addDeepDiveButton(componentId: string): void {
    const content = document.getElementById('content');
    if (!content) return;
    const markdownBody = content.querySelector('.markdown-body');
    if (!markdownBody) return;

    const btn = document.createElement('button');
    btn.className = 'deep-dive-btn';
    btn.innerHTML = '&#128269; Explore Further';
    btn.onclick = function () { toggleDeepDiveSection(componentId, btn); };
    markdownBody.insertBefore(btn, markdownBody.firstChild);
}

function toggleDeepDiveSection(componentId: string, btn: HTMLElement): void {
    const existing = document.getElementById('deep-dive-section');
    if (existing) { existing.parentNode!.removeChild(existing); return; }

    const section = document.createElement('div');
    section.id = 'deep-dive-section';
    section.className = 'deep-dive-section';
    section.innerHTML =
        '<div class="deep-dive-input-area">' +
        '<input type="text" class="deep-dive-input" id="deep-dive-input" ' +
        'placeholder="Ask a specific question about this component... (optional)">' +
        '<button class="deep-dive-submit" id="deep-dive-submit">Explore</button>' +
        '</div>' +
        '<div class="deep-dive-result" id="deep-dive-result"></div>';

    btn.insertAdjacentElement('afterend', section);

    const submitBtn = document.getElementById('deep-dive-submit');
    if (submitBtn) submitBtn.onclick = function () { startDeepDive(componentId); };
    const deepDiveInput = document.getElementById('deep-dive-input') as HTMLInputElement | null;
    if (deepDiveInput) {
        deepDiveInput.addEventListener('keydown', function (e: KeyboardEvent) {
            if (e.key === 'Enter') { e.preventDefault(); startDeepDive(componentId); }
        });
        deepDiveInput.focus();
    }
}

function startDeepDive(componentId: string): void {
    if (deepDiveStreaming) return;
    deepDiveStreaming = true;

    const input = document.getElementById('deep-dive-input') as HTMLInputElement | null;
    const submitBtn = document.getElementById('deep-dive-submit') as HTMLButtonElement | null;
    const resultDiv = document.getElementById('deep-dive-result');
    const question = input ? input.value.trim() : '';

    if (submitBtn) submitBtn.disabled = true;
    if (resultDiv) resultDiv.innerHTML = '<div class="deep-dive-status">Analyzing component...</div>';

    const body: any = {};
    if (question) body.question = question;
    body.depth = 'deep';

    fetch('/api/explore/' + encodeURIComponent(componentId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }).then(function (response) {
        if (!response.ok) {
            return response.json().then(function (err: any) { throw new Error(err.error || 'Request failed'); });
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullResponse = '';

        function processChunk(result: ReadableStreamReadResult<Uint8Array>): any {
            if (result.done) {
                if (buffer.trim()) {
                    const remaining = buffer.trim();
                    if (remaining.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(remaining.slice(6));
                            if (data.type === 'chunk') fullResponse += data.text;
                            else if (data.type === 'done') fullResponse = data.fullResponse || fullResponse;
                        } catch (_e) { /* ignore */ }
                    }
                }
                finishDeepDive(fullResponse, resultDiv, submitBtn);
                return;
            }

            buffer += decoder.decode(result.value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line.startsWith('data: ')) continue;
                try {
                    const data = JSON.parse(line.slice(6));
                    if (data.type === 'status') {
                        if (resultDiv) resultDiv.innerHTML = '<div class="deep-dive-status">' + escapeHtml(data.message) + '</div>';
                    } else if (data.type === 'chunk') {
                        fullResponse += data.text;
                        if (resultDiv) {
                            resultDiv.innerHTML = '<div class="markdown-body">' +
                                (typeof marked !== 'undefined' ? marked.parse(fullResponse) : escapeHtml(fullResponse)) + '</div>';
                        }
                    } else if (data.type === 'done') {
                        fullResponse = data.fullResponse || fullResponse;
                        finishDeepDive(fullResponse, resultDiv, submitBtn);
                        return;
                    } else if (data.type === 'error') {
                        if (resultDiv) resultDiv.innerHTML = '<div class="ask-message-error">Error: ' + escapeHtml(data.message) + '</div>';
                        finishDeepDive('', resultDiv, submitBtn);
                        return;
                    }
                } catch (_e) { /* ignore */ }
            }

            return reader.read().then(processChunk);
        }

        return reader.read().then(processChunk);
    }).catch(function (err: any) {
        if (resultDiv) resultDiv.innerHTML = '<div class="ask-message-error">Error: ' + escapeHtml(err.message) + '</div>';
        finishDeepDive('', resultDiv, submitBtn);
    });
}

function finishDeepDive(fullResponse: string, resultDiv: HTMLElement | null, submitBtn: HTMLButtonElement | null): void {
    deepDiveStreaming = false;
    if (submitBtn) submitBtn.disabled = false;
    if (fullResponse && resultDiv) {
        resultDiv.innerHTML = '<div class="markdown-body">' +
            (typeof marked !== 'undefined' ? marked.parse(fullResponse) : escapeHtml(fullResponse)) + '</div>';
        resultDiv.querySelectorAll('pre code').forEach(function (block) { hljs.highlightElement(block as Element); });
    }
}

/**
 * Set up Ask AI event listeners. Called once from index.ts.
 */
export function setupAskAiListeners(): void {
    const closeBtn = document.getElementById('ask-close');
    if (closeBtn) closeBtn.addEventListener('click', collapseWidget);

    const clearBtn = document.getElementById('ask-clear');
    if (clearBtn) {
        clearBtn.addEventListener('click', function () {
            if (currentSessionId) {
                fetch('/api/ask/session/' + encodeURIComponent(currentSessionId), { method: 'DELETE' }).catch(function () { /* ignore */ });
                currentSessionId = null;
            }
            conversationHistory = [];
            const messages = document.getElementById('ask-messages');
            if (messages) messages.innerHTML = '';
        });
    }

    const sendBtn = document.getElementById('ask-widget-send');
    if (sendBtn) sendBtn.addEventListener('click', askPanelSend);

    const textarea = document.getElementById('ask-textarea') as HTMLTextAreaElement | null;
    if (textarea) {
        textarea.addEventListener('keydown', function (e: KeyboardEvent) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                askPanelSend();
            }
        });
        textarea.addEventListener('input', function () {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
        });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', function (e: KeyboardEvent) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
            e.preventDefault();
            const collapseBtn = document.getElementById('sidebar-collapse');
            if (collapseBtn) collapseBtn.click();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
            e.preventDefault();
            if (askPanelOpen) collapseWidget();
            else {
                expandWidget();
                const ta = document.getElementById('ask-textarea');
                if (ta) ta.focus();
            }
        }
        if (e.key === 'Escape') {
            if (askPanelOpen) collapseWidget();
        }
    });
}
