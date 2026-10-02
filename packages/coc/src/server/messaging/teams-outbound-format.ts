import { marked, type Token, type Tokens } from 'marked';

export const TEAMS_CHANNEL_PREFIX = 'AI: ';

export type TeamsOutboundSource = 'markdown' | 'html';

export function escapeTeamsMarkdown(text: string): string {
    return text.replace(/([\\`*_[\]~])/g, '\\$1');
}

export function teamsCodeSpan(text: string): string {
    let longest = 0;
    for (const match of text.matchAll(/`+/g)) {
        longest = Math.max(longest, match[0].length);
    }
    const fence = '`'.repeat(longest + 1);
    const padding = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
    return `${fence}${padding}${text}${padding}${fence}`;
}

export function escapeTeamsHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function safeTeamsHref(href: string): string | null {
    try {
        const url = new URL(href);
        if (url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:') {
            return escapeTeamsHtml(href);
        }
    } catch {
        // Unrecognized destinations remain visible without a link.
    }
    return null;
}

function childrenOf(token: Token): Token[] {
    if ('tokens' in token && Array.isArray(token.tokens)) {
        return token.tokens;
    }
    throw new TypeError('Invalid Teams Markdown token');
}

function renderInline(tokens: Token[]): string {
    return tokens.map(token => {
        switch (token.type) {
            case 'text':
                return 'tokens' in token && Array.isArray(token.tokens)
                    ? renderInline(token.tokens) : token.text;
            case 'escape':
                return token.text;
            case 'html':
                return escapeTeamsHtml(token.raw);
            case 'strong':
                return `<strong>${renderInline(childrenOf(token))}</strong>`;
            case 'em':
                return `<em>${renderInline(childrenOf(token))}</em>`;
            case 'del':
                return renderInline(childrenOf(token));
            case 'codespan':
                return `<code>${token.text}</code>`;
            case 'br':
                return '<br>';
            case 'link': {
                const label = renderInline(childrenOf(token));
                const href = safeTeamsHref(token.href);
                return href ? `<a href="${href}">${label}</a>` : label;
            }
            case 'image':
                return escapeTeamsHtml(token.text);
            default:
                return escapeTeamsHtml(token.raw);
        }
    }).join('');
}

function renderBlocks(tokens: Token[]): string {
    return tokens.map(token => {
        switch (token.type) {
            case 'paragraph':
                return `<p>${renderInline(childrenOf(token))}</p>`;
            case 'text':
                return 'tokens' in token && Array.isArray(token.tokens)
                    ? renderInline(token.tokens) : escapeTeamsHtml(token.text);
            case 'heading':
                return `<p><strong>${renderInline(childrenOf(token))}</strong></p>`;
            case 'code':
                return `<pre><code>${escapeTeamsHtml(token.text)}</code></pre>`;
            case 'list': {
                if (!('items' in token) || !Array.isArray(token.items)) {
                    throw new TypeError('Invalid Teams Markdown list');
                }
                const tag = token.ordered ? 'ol' : 'ul';
                const start = token.ordered && token.start !== 1 && token.start !== ''
                    ? ` start="${token.start}"` : '';
                const items: Tokens.ListItem[] = token.items;
                const rows = items.map(item => `<li>${renderBlocks(childrenOf(item))}</li>`).join('');
                return `<${tag}${start}>${rows}</${tag}>`;
            }
            case 'space':
                return '<br>';
            case 'blockquote':
                return renderBlocks(childrenOf(token));
            default:
                return `<p>${escapeTeamsHtml(token.raw)}</p>`;
        }
    }).join('');
}

export function formatTeamsOutbound(text: string, source: TeamsOutboundSource): string {
    return TEAMS_CHANNEL_PREFIX + (source === 'html'
        ? text
        : renderBlocks(marked.lexer(text, { gfm: true, breaks: true })));
}

export interface TeamsQuestion {
    progress?: string;
    question: string;
    options: string[];
    hint: string;
}

/** Phone-readable relayed question as safe Teams HTML (send with source `html`). */
export function formatTeamsQuestion(q: TeamsQuestion): string {
    const lines = (text: string) => text.split('\n').map(escapeTeamsHtml).join('<br>');
    return [
        ...(q.progress ? [`<p><em>${escapeTeamsHtml(q.progress)}</em></p>`] : []),
        `<p><strong>${lines(q.question)}</strong></p>`,
        ...(q.options.length ? [`<p>${q.options.map(escapeTeamsHtml).join('<br>')}</p>`] : []),
        `<p>${escapeTeamsHtml(q.hint)}</p>`,
    ].join('');
}
