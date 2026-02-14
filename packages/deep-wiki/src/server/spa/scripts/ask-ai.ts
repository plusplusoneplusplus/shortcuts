/**
 * Ask AI widget and Deep Dive script.
 *
 * Contains: updateAskSubject, expandWidget, collapseWidget, askPanelSend,
 * SSE streaming, appendAskMessage, appendAskAssistantStreaming,
 * updateAskAssistantStreaming, appendAskContext, appendAskTyping,
 * appendAskError, addDeepDiveButton, toggleDeepDiveSection, startDeepDive,
 * finishDeepDive, and keyboard shortcuts.
 */
export function getAskAiScript(): string {
    return `
        // ================================================================
        // Ask AI
        // ================================================================

        var conversationHistory = [];
        var askStreaming = false;
        var askPanelOpen = false;
        var currentSessionId = null;

        function updateAskSubject(name) {
            var el = document.getElementById('ask-bar-subject');
            if (el) el.textContent = name;
        }

        // Widget controls
        document.getElementById('ask-close').addEventListener('click', collapseWidget);
        document.getElementById('ask-clear').addEventListener('click', function() {
            if (currentSessionId) {
                fetch('/api/ask/session/' + encodeURIComponent(currentSessionId), { method: 'DELETE' }).catch(function() {});
                currentSessionId = null;
            }
            conversationHistory = [];
            document.getElementById('ask-messages').innerHTML = '';
        });
        document.getElementById('ask-widget-send').addEventListener('click', askPanelSend);
        document.getElementById('ask-textarea').addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                askPanelSend();
            }
        });
        document.getElementById('ask-textarea').addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });

        function expandWidget() {
            if (askPanelOpen) return;
            askPanelOpen = true;
            var widget = document.getElementById('ask-widget');
            widget.classList.add('expanded');
            document.getElementById('ask-widget-header').classList.remove('hidden');
            document.getElementById('ask-messages').classList.remove('hidden');
        }

        function collapseWidget() {
            askPanelOpen = false;
            var widget = document.getElementById('ask-widget');
            widget.classList.remove('expanded');
            document.getElementById('ask-widget-header').classList.add('hidden');
            document.getElementById('ask-messages').classList.add('hidden');
        }

        function askPanelSend() {
            if (askStreaming) return;
            var input = document.getElementById('ask-textarea');
            var question = input.value.trim();
            if (!question) return;

            expandWidget();

            input.value = '';
            input.style.height = 'auto';

            appendAskMessage('user', question);
            conversationHistory.push({ role: 'user', content: question });

            askStreaming = true;
            document.getElementById('ask-widget-send').disabled = true;

            var typingEl = appendAskTyping();

            var requestBody = { question: question };
            if (currentSessionId) {
                requestBody.sessionId = currentSessionId;
            } else {
                requestBody.conversationHistory = conversationHistory.slice(0, -1);
            }

            fetch('/api/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            }).then(function(response) {
                if (!response.ok) {
                    return response.json().then(function(err) {
                        throw new Error(err.error || 'Request failed');
                    });
                }

                var reader = response.body.getReader();
                var decoder = new TextDecoder();
                var buffer = '';
                var fullResponse = '';
                var contextShown = false;
                var responseEl = null;

                function processChunk(result) {
                    if (result.done) {
                        if (buffer.trim()) {
                            var remaining = buffer.trim();
                            if (remaining.startsWith('data: ')) {
                                try {
                                    var data = JSON.parse(remaining.slice(6));
                                    if (data.type === 'chunk') {
                                        fullResponse += data.content;
                                        if (!responseEl) responseEl = appendAskAssistantStreaming('');
                                        updateAskAssistantStreaming(responseEl, fullResponse);
                                    } else if (data.type === 'done') {
                                        fullResponse = data.fullResponse || fullResponse;
                                        if (data.sessionId) currentSessionId = data.sessionId;
                                    }
                                } catch(e) {}
                            }
                        }
                        finishStreaming(fullResponse, typingEl);
                        return;
                    }

                    buffer += decoder.decode(result.value, { stream: true });
                    var lines = buffer.split('\\n');
                    buffer = lines.pop() || '';

                    for (var i = 0; i < lines.length; i++) {
                        var line = lines[i].trim();
                        if (!line.startsWith('data: ')) continue;
                        try {
                            var data = JSON.parse(line.slice(6));
                            if (data.type === 'context' && !contextShown) {
                                contextShown = true;
                                appendAskContext(data.moduleIds);
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
                        } catch(e) {}
                    }

                    return reader.read().then(processChunk);
                }

                return reader.read().then(processChunk);
            }).catch(function(err) {
                if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
                appendAskError(err.message || 'Failed to connect');
                finishStreaming('', null);
            });
        }

        function finishStreaming(fullResponse, typingEl) {
            if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
            askStreaming = false;
            document.getElementById('ask-widget-send').disabled = false;
            if (fullResponse) {
                conversationHistory.push({ role: 'assistant', content: fullResponse });
            }
        }

        function appendAskMessage(role, content) {
            var messages = document.getElementById('ask-messages');
            var div = document.createElement('div');
            div.className = 'ask-message';
            var inner = document.createElement('div');
            inner.className = 'ask-message-' + role;
            inner.textContent = content;
            div.appendChild(inner);
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
            return div;
        }

        function appendAskAssistantStreaming(content) {
            var messages = document.getElementById('ask-messages');
            var div = document.createElement('div');
            div.className = 'ask-message';
            var inner = document.createElement('div');
            inner.className = 'ask-message-assistant';
            inner.innerHTML = '<div class="markdown-body">' + (typeof marked !== 'undefined' ? marked.parse(content) : escapeHtml(content)) + '</div>';
            div.appendChild(inner);
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
            return inner;
        }

        function updateAskAssistantStreaming(el, content) {
            if (!el) return;
            el.innerHTML = '<div class="markdown-body">' + (typeof marked !== 'undefined' ? marked.parse(content) : escapeHtml(content)) + '</div>';
            var messages = document.getElementById('ask-messages');
            messages.scrollTop = messages.scrollHeight;
        }

        function appendAskContext(moduleIds) {
            if (!moduleIds || moduleIds.length === 0) return;
            var messages = document.getElementById('ask-messages');
            var div = document.createElement('div');
            div.className = 'ask-message-context';
            var links = moduleIds.map(function(id) {
                var mod = moduleGraph.modules.find(function(m) { return m.id === id; });
                var name = mod ? mod.name : id;
                return '<a onclick="loadModule(\\'' + id.replace(/'/g, "\\\\'") + '\\')">' + escapeHtml(name) + '</a>';
            });
            div.innerHTML = 'Context: ' + links.join(', ');
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
        }

        function appendAskTyping() {
            var messages = document.getElementById('ask-messages');
            var div = document.createElement('div');
            div.className = 'ask-message';
            var inner = document.createElement('div');
            inner.className = 'ask-message-typing';
            inner.textContent = 'Thinking';
            div.appendChild(inner);
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
            return div;
        }

        function appendAskError(message) {
            var messages = document.getElementById('ask-messages');
            var div = document.createElement('div');
            div.className = 'ask-message-error';
            div.textContent = 'Error: ' + message;
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
        }

        // Deep Dive (Explore Further)
        var deepDiveStreaming = false;

        function addDeepDiveButton(moduleId) {
            var content = document.getElementById('content');
            if (!content) return;
            var markdownBody = content.querySelector('.markdown-body');
            if (!markdownBody) return;

            var btn = document.createElement('button');
            btn.className = 'deep-dive-btn';
            btn.innerHTML = '&#128269; Explore Further';
            btn.onclick = function() { toggleDeepDiveSection(moduleId, btn); };
            markdownBody.insertBefore(btn, markdownBody.firstChild);
        }

        function toggleDeepDiveSection(moduleId, btn) {
            var existing = document.getElementById('deep-dive-section');
            if (existing) { existing.parentNode.removeChild(existing); return; }

            var section = document.createElement('div');
            section.id = 'deep-dive-section';
            section.className = 'deep-dive-section';
            section.innerHTML =
                '<div class="deep-dive-input-area">' +
                '<input type="text" class="deep-dive-input" id="deep-dive-input" ' +
                'placeholder="Ask a specific question about this module... (optional)">' +
                '<button class="deep-dive-submit" id="deep-dive-submit">Explore</button>' +
                '</div>' +
                '<div class="deep-dive-result" id="deep-dive-result"></div>';

            btn.insertAdjacentElement('afterend', section);

            document.getElementById('deep-dive-submit').onclick = function() { startDeepDive(moduleId); };
            document.getElementById('deep-dive-input').addEventListener('keydown', function(e) {
                if (e.key === 'Enter') { e.preventDefault(); startDeepDive(moduleId); }
            });
            document.getElementById('deep-dive-input').focus();
        }

        function startDeepDive(moduleId) {
            if (deepDiveStreaming) return;
            deepDiveStreaming = true;

            var input = document.getElementById('deep-dive-input');
            var submitBtn = document.getElementById('deep-dive-submit');
            var resultDiv = document.getElementById('deep-dive-result');
            var question = input ? input.value.trim() : '';

            submitBtn.disabled = true;
            resultDiv.innerHTML = '<div class="deep-dive-status">Analyzing module...</div>';

            var body = {};
            if (question) body.question = question;
            body.depth = 'deep';

            fetch('/api/explore/' + encodeURIComponent(moduleId), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }).then(function(response) {
                if (!response.ok) {
                    return response.json().then(function(err) { throw new Error(err.error || 'Request failed'); });
                }

                var reader = response.body.getReader();
                var decoder = new TextDecoder();
                var buffer = '';
                var fullResponse = '';

                function processChunk(result) {
                    if (result.done) {
                        if (buffer.trim()) {
                            var remaining = buffer.trim();
                            if (remaining.startsWith('data: ')) {
                                try {
                                    var data = JSON.parse(remaining.slice(6));
                                    if (data.type === 'chunk') fullResponse += data.text;
                                    else if (data.type === 'done') fullResponse = data.fullResponse || fullResponse;
                                } catch(e) {}
                            }
                        }
                        finishDeepDive(fullResponse, resultDiv, submitBtn);
                        return;
                    }

                    buffer += decoder.decode(result.value, { stream: true });
                    var lines = buffer.split('\\n');
                    buffer = lines.pop() || '';

                    for (var i = 0; i < lines.length; i++) {
                        var line = lines[i].trim();
                        if (!line.startsWith('data: ')) continue;
                        try {
                            var data = JSON.parse(line.slice(6));
                            if (data.type === 'status') {
                                resultDiv.innerHTML = '<div class="deep-dive-status">' + escapeHtml(data.message) + '</div>';
                            } else if (data.type === 'chunk') {
                                fullResponse += data.text;
                                resultDiv.innerHTML = '<div class="markdown-body">' +
                                    (typeof marked !== 'undefined' ? marked.parse(fullResponse) : escapeHtml(fullResponse)) + '</div>';
                            } else if (data.type === 'done') {
                                fullResponse = data.fullResponse || fullResponse;
                                finishDeepDive(fullResponse, resultDiv, submitBtn);
                                return;
                            } else if (data.type === 'error') {
                                resultDiv.innerHTML = '<div class="ask-message-error">Error: ' + escapeHtml(data.message) + '</div>';
                                finishDeepDive('', resultDiv, submitBtn);
                                return;
                            }
                        } catch(e) {}
                    }

                    return reader.read().then(processChunk);
                }

                return reader.read().then(processChunk);
            }).catch(function(err) {
                resultDiv.innerHTML = '<div class="ask-message-error">Error: ' + escapeHtml(err.message) + '</div>';
                finishDeepDive('', resultDiv, submitBtn);
            });
        }

        function finishDeepDive(fullResponse, resultDiv, submitBtn) {
            deepDiveStreaming = false;
            if (submitBtn) submitBtn.disabled = false;
            if (fullResponse && resultDiv) {
                resultDiv.innerHTML = '<div class="markdown-body">' +
                    (typeof marked !== 'undefined' ? marked.parse(fullResponse) : escapeHtml(fullResponse)) + '</div>';
                resultDiv.querySelectorAll('pre code').forEach(function(block) { hljs.highlightElement(block); });
            }
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
                e.preventDefault();
                document.getElementById('sidebar-collapse').click();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
                e.preventDefault();
                if (askPanelOpen) collapseWidget();
                else { expandWidget(); document.getElementById('ask-textarea').focus(); }
            }
            if (e.key === 'Escape') {
                if (askPanelOpen) collapseWidget();
            }
        });`;
}
