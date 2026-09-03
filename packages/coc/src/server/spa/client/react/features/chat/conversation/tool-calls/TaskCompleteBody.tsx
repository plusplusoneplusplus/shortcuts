/**
 * TaskCompleteBody — the expanded body of a `task_complete` tool call.
 *
 * The summary is authored by the model as chat markdown, so it goes through the
 * same pipeline an assistant message uses: `chatMarkdownToHtml` for the HTML and
 * the shared `MarkdownView` for rendering. That keeps code highlighting,
 * mermaid/svg fences, interactive tables, canvas embeds and the image lightbox
 * working here exactly as they do in a chat bubble. Workspace-scoped behavior
 * (local image URLs, canvas embeds) comes from the surrounding conversation's
 * `ChatRenderContext`, so nothing global is consulted.
 *
 * Both the card and whisper-row variants render this same component.
 */
import React, { useMemo } from 'react';
import { MarkdownView } from '../../../../shared/MarkdownView';
import { chatMarkdownToHtml } from '../markdownHtml';
import { useChatRenderContext } from '../ChatRenderContext';

export function TaskCompleteBody({ summary }: { summary: string }) {
    const { wsId, htmlEmbedEnabled, excalidrawEmbedEnabled, canvasEmbedEnabled } = useChatRenderContext();

    const html = useMemo(
        () => chatMarkdownToHtml(summary, wsId, { htmlEmbedEnabled, excalidrawEmbedEnabled, canvasEmbedEnabled }),
        [summary, wsId, htmlEmbedEnabled, excalidrawEmbedEnabled, canvasEmbedEnabled],
    );

    if (!html) return null;

    return (
        <div className="task-complete-body" data-testid="task-complete-markdown">
            <MarkdownView html={html} />
        </div>
    );
}
