import { targetSpans, type SentinelTargetSpan } from '../../../../shared/sentinel-target-reference';

const ATTRIBUTE = 'data-sentinel-target';
const blockSeparator = (child: Node, preceding: string) =>
    child instanceof HTMLElement && /^(DIV|P)$/.test(child.tagName) && preceding && !preceding.endsWith('\n') ? '\n' : '';
export function readAtomicText(root: Node): string {
    if (root.nodeType === Node.TEXT_NODE) return root.textContent ?? '';
    if (root instanceof HTMLElement && root.hasAttribute(ATTRIBUTE)) return root.getAttribute(ATTRIBUTE)!;
    if (root instanceof HTMLBRElement) return '\n';
    let result = '';
    for (const child of Array.from(root.childNodes)) {
        result += blockSeparator(child, result);
        result += readAtomicText(child);
    }
    return result;
}
export function atomicFragment(text: string): DocumentFragment {
    const fragment = document.createDocumentFragment();
    let pos = 0;
    for (const span of targetSpans(text)) {
        fragment.append(document.createTextNode(text.slice(pos, span.start)), targetElement(span));
        pos = span.end;
    }
    fragment.append(document.createTextNode(text.slice(pos)));
    return fragment;
}
function targetElement(span: SentinelTargetSpan): HTMLElement {
    const el = document.createElement('span');
    el.setAttribute(ATTRIBUTE, span.text);
    el.contentEditable = 'false';
    el.setAttribute('contenteditable', 'false');
    el.className = 'sentinel-target-token';
    el.style.cssText = 'border-radius:4px;background:rgba(20,184,166,.16);color:inherit;box-shadow:0 0 0 1px rgba(20,184,166,.35);';
    el.textContent = span.label;
    el.title = span.target.kind + ' · ' + span.target.serverIdentity;
    return el;
}
/** Set a raw serialization offset. Atomic nodes can only be selected whole. */
export function atomicPoint(root: Node, offset: number): [Node, number] {
    let remaining = offset;
    const walk = (node: Node): [Node, number] | undefined => {
        if (node instanceof HTMLElement && node.hasAttribute(ATTRIBUTE)) {
            const len = readAtomicText(node).length;
            if (remaining <= len) {
                const parent = node.parentNode!;
                const index = Array.from(parent.childNodes).indexOf(node);
                return [parent, index + (remaining > 0 ? 1 : 0)];
            }
            remaining -= len;
        } else if (node.nodeType === Node.TEXT_NODE) {
            const len = node.textContent?.length ?? 0;
            if (remaining <= len) return [node, remaining];
            remaining -= len;
        } else {
            const children = Array.from(node.childNodes);
            let preceding = '';
            for (let i = 0; i < children.length; i++) {
                const child = children[i];
                const separator = blockSeparator(child, preceding);
                if (separator) {
                    if (!remaining) return [node, i];
                    remaining--;
                }
                if (child instanceof HTMLBRElement) {
                    if (!remaining) return [node, i];
                    remaining--;
                } else {
                    const found = walk(child);
                    if (found) return found;
                }
                preceding += separator + readAtomicText(child);
            }
        }
        return undefined;
    };
    return walk(root) ?? [root, root.childNodes.length];
}
export function atomicSelection(root: HTMLElement): { start: number; end: number } | undefined {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
    const prefix = document.createRange();
    prefix.selectNodeContents(root);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = readAtomicText(prefix.cloneContents()).length;
    prefix.setEnd(range.endContainer, range.endOffset);
    return { start, end: readAtomicText(prefix.cloneContents()).length };
}
export function replaceAtomicRange(root: HTMLElement, start: number, end: number, text: string): void {
    root.focus();
    const range = document.createRange();
    range.setStart(...atomicPoint(root, start));
    range.setEnd(...atomicPoint(root, end));
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    const container = document.createElement('div');
    container.append(atomicFragment(text));
    if (document.execCommand) document.execCommand('insertHTML', false, container.innerHTML);
    else {
        range.deleteContents();
        const fragment = atomicFragment(text);
        const last = fragment.lastChild;
        range.insertNode(fragment);
        if (last) range.setStartAfter(last);
        range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
    }
}
