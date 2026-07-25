/**
 * sidenoteAnchoring — resolve a Quick Ask side-note anchor to a DOM Range
 * inside a rendered assistant turn.
 *
 * This adapts the Notes-comment anchoring approach (`notes/editor/textAnchor`)
 * from ProseMirror positions to plain-DOM ranges: the plain-text offset
 * resolution (exact → context-scored → fuzzy → orphaned) is reused verbatim,
 * and this module adds the DOM half — mapping the resolved character offsets
 * back onto the container's text nodes to produce a live `Range`.
 *
 * Pure logic with no React dependency; the only DOM APIs used are the standard
 * `TreeWalker`/`Range` (available in the browser and in jsdom tests), so the
 * resolver is directly unit-testable.
 */

import { resolveAnchor, type TextAnchor } from '../../notes/editor/textAnchor';
import type { QuickAskAnchor } from './types';

/** Outcome of resolving a side-note anchor against a rendered turn. */
export type SidenoteResolution =
    | {
          located: true;
          /** How the source text was matched. */
          confidence: 'exact' | 'fuzzy';
          /** Live DOM range wrapping the matched source phrase. */
          range: Range;
          /** Plain-text character offsets (into `container.textContent`). */
          from: number;
          to: number;
      }
    | { located: false };

/** A resolved text-node point (node + offset within that node's data). */
export interface TextPoint {
    node: Text;
    offset: number;
}

/**
 * Map a Quick Ask anchor onto the Notes `TextAnchor` shape so the shared
 * offset resolver can be reused unchanged.
 */
export function anchorToTextAnchor(anchor: QuickAskAnchor): TextAnchor {
    return {
        quotedText: anchor.selectedText ?? '',
        prefix: anchor.contextBefore ?? '',
        suffix: anchor.contextAfter ?? '',
    };
}

/**
 * Collect the container's descendant text nodes in document order. The
 * concatenation of their `.data` equals `container.textContent`, so a
 * plain-text offset maps cleanly onto (node, localOffset).
 */
export function collectTextNodes(container: Node): Text[] {
    const doc = container.ownerDocument;
    if (!doc) {return [];}
    const nodes: Text[] = [];
    const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
        nodes.push(current as Text);
        current = walker.nextNode();
    }
    return nodes;
}

/**
 * Locate the (text node, local offset) for a plain-text character offset.
 * Returns the first text node whose accumulated span reaches `offset`; at a
 * node boundary the earlier node's end is chosen (equivalent for range text).
 */
export function pointAtOffset(nodes: Text[], offset: number): TextPoint | null {
    if (nodes.length === 0) {return null;}
    const clamped = Math.max(0, offset);
    let acc = 0;
    for (const node of nodes) {
        const len = node.data.length;
        if (clamped <= acc + len) {
            return { node, offset: clamped - acc };
        }
        acc += len;
    }
    // Offset past the end of all text — clamp to the end of the last node.
    const last = nodes[nodes.length - 1];
    return { node: last, offset: last.data.length };
}

/**
 * Build a DOM Range spanning the plain-text half-open interval `[from, to)`
 * within `container`. Returns null when the container has no text nodes.
 */
export function offsetsToRange(container: HTMLElement, from: number, to: number): Range | null {
    const doc = container.ownerDocument;
    if (!doc) {return null;}
    const nodes = collectTextNodes(container);
    const start = pointAtOffset(nodes, from);
    const end = pointAtOffset(nodes, to);
    if (!start || !end) {return null;}
    const range = doc.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
}

/**
 * Resolve a side-note anchor against a rendered turn's content container.
 *
 * Strategy (delegated to the shared resolver):
 *   1. Full-context exact match (prefix + quoted + suffix).
 *   2. Quoted-text exact match; ambiguity broken by context scoring.
 *   3. Fuzzy match tolerant of minor whitespace/markup drift.
 *   4. Otherwise "not located".
 */
export function resolveSidenoteAnchor(
    container: HTMLElement | null,
    anchor: QuickAskAnchor | null | undefined,
): SidenoteResolution {
    if (!container || !anchor || !anchor.selectedText) {return { located: false };}
    const fullText = container.textContent ?? '';
    if (!fullText) {return { located: false };}

    const match = resolveAnchor(fullText, anchorToTextAnchor(anchor));
    if (match.confidence === 'orphaned' || match.from < 0 || match.to < match.from) {
        return { located: false };
    }

    const range = offsetsToRange(container, match.from, match.to);
    if (!range) {return { located: false };}

    return { located: true, confidence: match.confidence, range, from: match.from, to: match.to };
}
