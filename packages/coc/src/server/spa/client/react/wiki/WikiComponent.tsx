/**
 * WikiComponent — renders a component article with TOC and mermaid support.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Spinner } from '../shared';
import { cn } from '../shared/cn';
import { fetchApi } from '../hooks/useApi';
import { useMermaid } from '../hooks/useMermaid';

declare const marked: { parse(md: string): string } | undefined;
declare const hljs: { highlightElement(el: Element): void } | undefined;

function preserveMermaidBlocks(md: string): string {
    return md.replace(/```mermaid\n([\s\S]*?)```/g, (_match, code: string) => {
        const preserved = code.replace(/\n\n/g, '\n \n');
        return '```mermaid\n' + preserved + '```';
    });
}

interface ComponentInfo {
    id: string;
    name: string;
    path: string;
    purpose: string;
    category: string;
    dependencies?: string[];
    dependents?: string[];
    complexity?: 'low' | 'medium' | 'high';
    keyFiles?: string[];
}

interface ComponentGraph {
    components: ComponentInfo[];
    categories: { id: string; name: string }[];
    domains?: any[];
    project: { name: string; description: string };
}

interface WikiComponentProps {
    wikiId: string;
    componentId: string;
    graph: ComponentGraph;
    onSelectComponent?: (id: string) => void;
}

interface TocItem {
    id: string;
    text: string;
    level: number;
}

export function WikiComponent({ wikiId, componentId, graph, onSelectComponent }: WikiComponentProps) {
    const [html, setHtml] = useState('');
    const [loading, setLoading] = useState(false);
    const [toc, setToc] = useState<TocItem[]>([]);
    const [activeHeading, setActiveHeading] = useState<string | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const cacheRef = useRef<Record<string, string>>({});

    const comp = useMemo(
        () => graph.components.find(c => c.id === componentId),
        [graph.components, componentId]
    );

    // Fetch article
    useEffect(() => {
        if (cacheRef.current[componentId]) {
            setHtml(cacheRef.current[componentId]);
            setLoading(false);
            return;
        }
        setLoading(true);
        fetchApi('/wikis/' + encodeURIComponent(wikiId) + '/components/' + encodeURIComponent(componentId))
            .then(data => {
                if (data?.markdown && typeof marked !== 'undefined') {
                    const rendered = marked.parse(preserveMermaidBlocks(data.markdown));
                    cacheRef.current[componentId] = rendered;
                    setHtml(rendered);
                } else if (data?.markdown) {
                    const fallback = '<pre>' + data.markdown.replace(/</g, '&lt;') + '</pre>';
                    cacheRef.current[componentId] = fallback;
                    setHtml(fallback);
                }
            })
            .catch(() => setHtml('<p style="color:var(--status-failed)">Failed to load article</p>'))
            .finally(() => setLoading(false));
    }, [wikiId, componentId]);

    // Post-render: highlight, mermaid, TOC
    useEffect(() => {
        if (!contentRef.current || !html) return;
        const container = contentRef.current;

        // Highlight code
        if (typeof hljs !== 'undefined') {
            container.querySelectorAll('pre code').forEach(block => {
                if (!block.classList.contains('language-mermaid')) {
                    hljs!.highlightElement(block);
                }
            });
        }

        // Add heading IDs and build TOC
        // GitHub-style slug: lowercase, strip non-alphanumeric/space/hyphen, spaces→hyphens.
        // Preserves consecutive dashes so AI-generated TOC anchors like #purpose--scope match.
        const headings: TocItem[] = [];
        container.querySelectorAll('h1, h2, h3, h4').forEach(heading => {
            const id = (heading.textContent || '').toLowerCase()
                .replace(/[^a-z0-9 -]/g, '')
                .replace(/ /g, '-')
                .replace(/^-+|-+$/g, '');
            heading.id = id;
            const level = parseInt(heading.tagName.charAt(1));
            headings.push({ id, text: (heading.textContent || '').replace(/#$/, '').trim(), level });
        });
        setToc(headings);

        // Transform mermaid blocks to structure expected by useMermaid hook
        container.querySelectorAll('pre code.language-mermaid').forEach(block => {
            const pre = block.parentElement;
            if (!pre) return;
            const code = block.textContent || '';
            const wrapper = document.createElement('div');
            wrapper.className = 'mermaid-container';
            wrapper.innerHTML =
                '<div class="mermaid-header">Diagram</div>' +
                '<div class="mermaid-source" style="display:none"><code>' +
                code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
                '</code></div>' +
                '<div class="mermaid-content"></div>';
            pre.parentNode!.replaceChild(wrapper, pre);
        });

        // Scroll spy (article container scroll)
        const scrollContainer = scrollRef.current;
        if (!scrollContainer) return;
        const onScroll = () => {
            let activeId: string | null = null;
            const scrollTop = scrollContainer.getBoundingClientRect().top;
            container.querySelectorAll('h2, h3, h4').forEach(h => {
                if ((h as HTMLElement).getBoundingClientRect().top - scrollTop <= 120) {
                    activeId = h.id;
                }
            });
            setActiveHeading(activeId);
        };
        onScroll();
        scrollContainer.addEventListener('scroll', onScroll);
        return () => scrollContainer.removeEventListener('scroll', onScroll);
    }, [html]);

    // Intercept in-article anchor clicks so they scroll instead of replacing the hash route
    useEffect(() => {
        const container = contentRef.current;
        if (!container) return;
        const handleClick = (e: MouseEvent) => {
            const anchor = (e.target as HTMLElement).closest('a');
            if (!anchor) return;
            const href = anchor.getAttribute('href');
            if (!href || !href.startsWith('#') || href === '#') return;
            const targetId = href.slice(1);
            const target = container.querySelector('#' + CSS.escape(targetId));
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        };
        container.addEventListener('click', handleClick);
        return () => container.removeEventListener('click', handleClick);
    }, [html]);

    // Mermaid zoom/pan/source-toggle/collapse via shared hook
    useMermaid(contentRef, html);

    // Scroll to top on component change
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = 0;
        }
    }, [componentId]);

    const scrollToHeading = useCallback((id: string) => {
        const el = contentRef.current?.querySelector('#' + CSS.escape(id));
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Spinner size="lg" />
            </div>
        );
    }

    const complexityColors: Record<string, string> = {
        low: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
        medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
        high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    };

    return (
        <div className="h-full overflow-y-auto" ref={scrollRef} id="wiki-article-content">
            <div className="flex items-start" id="wiki-content-scroll">
                <div className="flex-1 min-w-0 p-4 wiki-content-scroll">
                    {comp && (
                        <div className="mb-4 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h2 className="text-lg font-semibold text-[#1e1e1e] dark:text-[#cccccc]">{comp.name}</h2>
                                {comp.complexity && (
                                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', complexityColors[comp.complexity])}>
                                        {comp.complexity}
                                    </span>
                                )}
                                <span className="text-xs text-[#848484]">{comp.category}</span>
                            </div>
                            {comp.purpose && <p className="text-xs text-[#848484]">{comp.purpose}</p>}
                            {comp.dependencies && comp.dependencies.length > 0 && (
                                <div className="flex items-center gap-1 flex-wrap">
                                    <span className="text-[10px] text-[#848484]">Depends on:</span>
                                    {comp.dependencies.map(dep => (
                                        <button
                                            key={dep}
                                            className="text-[10px] px-1.5 py-0.5 rounded bg-[#0078d4]/10 text-[#0078d4] hover:bg-[#0078d4]/20"
                                            onClick={() => onSelectComponent?.(dep)}
                                        >
                                            {graph.components.find(c => c.id === dep)?.name || dep}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {comp.dependents && comp.dependents.length > 0 && (
                                <div className="flex items-center gap-1 flex-wrap">
                                    <span className="text-[10px] text-[#848484]">Used by:</span>
                                    {comp.dependents.map(dep => (
                                        <button
                                            key={dep}
                                            className="text-[10px] px-1.5 py-0.5 rounded bg-[#0078d4]/10 text-[#0078d4] hover:bg-[#0078d4]/20"
                                            onClick={() => onSelectComponent?.(dep)}
                                        >
                                            {graph.components.find(c => c.id === dep)?.name || dep}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    <div
                        ref={contentRef}
                        className="wiki-body markdown-body text-sm text-[#1e1e1e] dark:text-[#cccccc]"
                        dangerouslySetInnerHTML={{ __html: html }}
                    />
                </div>

                {toc.length > 0 && (
                    <aside className="wiki-toc-sidebar w-48 flex-shrink-0 border-l border-[#e0e0e0] dark:border-[#3c3c3c] p-3 hidden lg:block sticky top-0 max-h-screen overflow-y-auto" id="wiki-toc-sidebar">
                        <h4 className="text-[10px] font-semibold uppercase text-[#848484] mb-2">On this page</h4>
                        <nav id="wiki-toc-nav" className="space-y-0.5">
                            {toc.map(item => (
                                <a
                                    key={item.id}
                                    href={'#' + item.id}
                                    className={cn(
                                        'block text-xs py-0.5 truncate hover:text-[#0078d4]',
                                        item.level >= 3 && 'pl-3',
                                        item.level >= 4 && 'pl-6',
                                        activeHeading === item.id ? 'text-[#0078d4] font-medium' : 'text-[#848484]'
                                    )}
                                    onClick={e => {
                                        e.preventDefault();
                                        scrollToHeading(item.id);
                                    }}
                                >
                                    {item.text}
                                </a>
                            ))}
                        </nav>
                    </aside>
                )}
            </div>
        </div>
    );
}
