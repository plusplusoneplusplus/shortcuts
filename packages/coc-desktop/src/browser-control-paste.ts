/** Injected in the exact ref-owned document; never changes focus, selection or HTML. */
export function browserPaste(ref: string, token: string, phase: 'prepare' | 'check' | 'result' | 'cleanup'): boolean {
    interface Paste {
        token: string;
        target: HTMLElement;
        active: Element;
        anchor: Node;
        anchorOffset: number;
        focus: Node;
        focusOffset: number;
        received: boolean;
        controller: AbortController;
    }
    const registry = (window as Window & { __cocBrowserControl?: { refs: Map<string, HTMLElement>; paste?: Paste } }).__cocBrowserControl;
    if (!registry) throw new Error('stale ref, re-snapshot');
    if (phase === 'cleanup') {
        if (registry.paste?.token === token) {
            registry.paste.controller.abort();
            delete registry.paste;
        }
        return true;
    }
    if (phase === 'result') return registry.paste?.token === token && registry.paste.received;
    const target = registry.refs.get(ref);
    let active = document.activeElement;
    let depth = 0;
    while (active?.shadowRoot?.activeElement) {
        if (++depth > 256) throw new Error('Browser focus depth limit exceeded');
        active = active.shadowRoot.activeElement;
    }
    const selection = document.getSelection();
    if (!target?.isConnected || !target.isContentEditable || !document.hasFocus()
        || !active || !(active === target || target.contains(active)) || !selection?.anchorNode || !selection.focusNode
        || !target.contains(selection.anchorNode) || !target.contains(selection.focusNode)) {
        throw new Error('Rich paste requires the focused editable ref and a selection inside it');
    }
    let ancestor: Element | null = target;
    for (let count = 0; ancestor; count++) {
        if (count >= 256) throw new Error('Rich paste ancestor limit exceeded');
        const style = getComputedStyle(ancestor);
        if (ancestor.hasAttribute('inert') || ancestor.hasAttribute('hidden') || style.display === 'none'
            || style.visibility !== 'visible' || style.contentVisibility === 'hidden') throw new Error('Rich paste target is hidden or inert');
        const root = ancestor.getRootNode();
        ancestor = ancestor.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    }
    if (phase === 'check') {
        const saved = registry.paste;
        if (!saved || saved.token !== token || saved.target !== target || saved.active !== active
            || saved.anchor !== selection.anchorNode || saved.anchorOffset !== selection.anchorOffset
            || saved.focus !== selection.focusNode || saved.focusOffset !== selection.focusOffset) {
            throw new Error('Rich paste selection changed; nothing was pasted');
        }
        return true;
    }
    registry.paste?.controller.abort();
    const controller = new AbortController();
    const saved: Paste = {
        token, target, active, anchor: selection.anchorNode, anchorOffset: selection.anchorOffset,
        focus: selection.focusNode, focusOffset: selection.focusOffset, received: false, controller,
    };
    registry.paste = saved;
    document.addEventListener('paste', event => {
        if (event.isTrusted && event.composedPath().includes(target) && document.hasFocus()
            && event.clipboardData?.types.includes('text/html') && event.clipboardData.types.includes('text/plain')) {
            saved.received = true;
        }
    }, { capture: true, once: true, signal: controller.signal });
    setTimeout(() => {
        controller.abort();
        if (registry.paste === saved) delete registry.paste;
    }, 5000);
    return true;
}
