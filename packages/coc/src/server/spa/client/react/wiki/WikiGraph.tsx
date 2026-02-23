/**
 * WikiGraph — D3 force-directed dependency graph.
 * D3 v7 loaded from CDN lazily.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Spinner } from '../shared';
import { cn } from '../shared/cn';

interface ComponentInfo {
    id: string;
    name: string;
    path: string;
    purpose: string;
    category: string;
    dependencies?: string[];
    complexity?: 'low' | 'medium' | 'high';
}

interface ComponentGraph {
    components: ComponentInfo[];
    categories: { id: string; name: string }[];
    domains?: any[];
    project: { name: string; description: string };
}

interface WikiGraphProps {
    wikiId: string;
    graph: ComponentGraph;
    onSelectComponent: (id: string) => void;
}

const D3_CDN_URL = 'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js';

const CATEGORY_COLORS = [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
    '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
];

const COMPLEXITY_RADIUS: Record<string, number> = { low: 8, medium: 12, high: 18 };

let d3Promise: Promise<void> | null = null;
function ensureD3(): Promise<void> {
    if (typeof (window as any).d3 !== 'undefined') {
        return Promise.resolve();
    }
    if (d3Promise) return d3Promise;
    d3Promise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = D3_CDN_URL;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load D3'));
        document.head.appendChild(script);
    });
    return d3Promise;
}

function getCategoryColor(category: string, allCategories: string[]): string {
    const idx = allCategories.indexOf(category);
    return CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
}

export function WikiGraph({ wikiId, graph, onSelectComponent }: WikiGraphProps) {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [disabledCategories, setDisabledCategories] = useState<Set<string>>(new Set());
    const simulationRef = useRef<any>(null);
    const nodeRef = useRef<any>(null);
    const linkRef = useRef<any>(null);

    const allCategories = useRef<string[]>([]);

    useEffect(() => {
        const cats: string[] = [];
        graph.components.forEach(m => {
            if (!cats.includes(m.category)) cats.push(m.category);
        });
        cats.sort();
        allCategories.current = cats;
    }, [graph]);

    const renderGraph = useCallback(() => {
        const d3 = (window as any).d3;
        if (!d3 || !svgRef.current || !containerRef.current) return;

        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();

        const width = containerRef.current.clientWidth || 800;
        const height = containerRef.current.clientHeight || 600;

        svg.attr('width', width).attr('height', height);

        const cats = allCategories.current;

        const nodes = graph.components.map(m => ({
            id: m.id, name: m.name, category: m.category,
            complexity: m.complexity || 'medium', purpose: m.purpose,
        }));

        const nodeIds = new Set(nodes.map(n => n.id));
        const links: any[] = [];
        graph.components.forEach(m => {
            (m.dependencies || []).forEach(dep => {
                if (nodeIds.has(dep)) links.push({ source: m.id, target: dep });
            });
        });

        svg.append('defs').append('marker')
            .attr('id', 'wiki-arrowhead')
            .attr('viewBox', '0 -5 10 10').attr('refX', 20).attr('refY', 0)
            .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
            .append('path').attr('d', 'M0,-5L10,0L0,5').attr('class', 'wiki-graph-link-arrow');

        const g = svg.append('g');

        const link = g.selectAll('.wiki-graph-link').data(links).join('line')
            .attr('class', 'wiki-graph-link').attr('marker-end', 'url(#wiki-arrowhead)')
            .style('stroke', '#999').style('stroke-opacity', 0.4).style('stroke-width', 1);

        const node = g.selectAll('.wiki-graph-node').data(nodes).join('g')
            .attr('class', 'wiki-graph-node').style('cursor', 'pointer')
            .call(d3.drag()
                .on('start', (event: any, d: any) => {
                    if (!event.active) simulation.alphaTarget(0.3).restart();
                    d.fx = d.x; d.fy = d.y;
                })
                .on('drag', (event: any, d: any) => { d.fx = event.x; d.fy = event.y; })
                .on('end', (event: any, d: any) => {
                    if (!event.active) simulation.alphaTarget(0);
                    d.fx = null; d.fy = null;
                })
            );

        node.append('circle')
            .attr('r', (d: any) => COMPLEXITY_RADIUS[d.complexity] || 10)
            .attr('fill', (d: any) => getCategoryColor(d.category, cats))
            .attr('stroke', '#fff').attr('stroke-width', 1.5);

        node.append('text')
            .attr('dx', (d: any) => (COMPLEXITY_RADIUS[d.complexity] || 10) + 4)
            .attr('dy', 4)
            .text((d: any) => d.name)
            .style('font-size', '11px')
            .style('fill', 'currentColor');

        node.on('click', (_event: any, d: any) => {
            onSelectComponent(d.id);
        });

        const simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links).id((d: any) => d.id).distance(100))
            .force('charge', d3.forceManyBody().strength(-300))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius((d: any) => (COMPLEXITY_RADIUS[d.complexity] || 10) + 8))
            .on('tick', () => {
                link.attr('x1', (d: any) => d.source.x).attr('y1', (d: any) => d.source.y)
                    .attr('x2', (d: any) => d.target.x).attr('y2', (d: any) => d.target.y);
                node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
            });

        simulationRef.current = simulation;
        nodeRef.current = node;
        linkRef.current = link;

        const zoom = d3.zoom().scaleExtent([0.1, 4])
            .on('zoom', (event: any) => g.attr('transform', event.transform));
        svg.call(zoom);
    }, [graph, onSelectComponent]);

    // Effect 1: Load D3 library
    useEffect(() => {
        setLoading(true);
        setError(null);
        ensureD3()
            .then(() => setLoading(false))
            .catch(() => { setLoading(false); setError('Failed to load graph library'); });

        return () => {
            if (simulationRef.current) simulationRef.current.stop();
        };
    }, []);

    // Effect 2: Render graph once D3 is loaded and SVG is in the DOM
    useEffect(() => {
        if (!loading && !error) {
            renderGraph();
        }
    }, [loading, error, renderGraph]);

    // Update visibility when categories toggled
    useEffect(() => {
        if (!nodeRef.current || !linkRef.current) return;
        nodeRef.current.style('display', (d: any) => disabledCategories.has(d.category) ? 'none' : null);
        linkRef.current.style('display', (d: any) => {
            const src = typeof d.source === 'object' ? d.source : { category: '' };
            const tgt = typeof d.target === 'object' ? d.target : { category: '' };
            return (disabledCategories.has(src.category) || disabledCategories.has(tgt.category)) ? 'none' : null;
        });
    }, [disabledCategories]);

    const toggleCategory = (cat: string) => {
        setDisabledCategories(prev => {
            const next = new Set(prev);
            if (next.has(cat)) next.delete(cat);
            else next.add(cat);
            return next;
        });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Spinner size="lg" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-full text-sm text-[#848484]">
                {error}
            </div>
        );
    }

    return (
        <div ref={containerRef} className="relative h-full w-full" id="wiki-graph-container">
            <svg ref={svgRef} className="w-full h-full" />
            <div className="absolute top-2 right-2 bg-white/90 dark:bg-[#252526]/90 border border-[#e0e0e0] dark:border-[#3c3c3c] rounded p-2 text-xs max-h-60 overflow-y-auto" id="wiki-graph-legend">
                <div className="font-medium mb-1 text-[#1e1e1e] dark:text-[#cccccc]">Categories</div>
                {allCategories.current.map(cat => (
                    <div
                        key={cat}
                        className={cn(
                            'wiki-graph-legend-item flex items-center gap-1.5 py-0.5 cursor-pointer select-none',
                            disabledCategories.has(cat) && 'opacity-30 line-through'
                        )}
                        data-category={cat}
                        onClick={() => toggleCategory(cat)}
                    >
                        <div
                            className="wiki-graph-legend-swatch w-3 h-3 rounded-full flex-shrink-0"
                            style={{ background: getCategoryColor(cat, allCategories.current) }}
                        />
                        <span>{cat}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
