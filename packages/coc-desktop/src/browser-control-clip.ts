/** Self-contained: injected into the owning document, never a cross-origin DOM walk. */
export function browserClipRect(element: Element) {
    const doc = element.ownerDocument;
    const win = doc.defaultView!;
    const root = doc.documentElement;
    const rootStyle = win.getComputedStyle(root);
    let left = 0, top = 0, right = win.innerWidth, bottom = win.innerHeight;
    let count = 0;
    let containingBlock: Element | null | undefined;
    for (let node: Element | null = element; node;) {
        if (++count > 20000) throw new Error('Browser clipping ancestor limit exceeded');
        const childStyle = win.getComputedStyle(node);
        if (childStyle.position === 'absolute' || childStyle.position === 'fixed') {
            containingBlock = (node as HTMLElement).offsetParent;
            if (containingBlock === doc.body) {
                const bodyStyle = win.getComputedStyle(containingBlock);
                // offsetParent reports the static body for the initial containing block.
                if (bodyStyle.position === 'static' && bodyStyle.transform === 'none'
                    && bodyStyle.perspective === 'none' && bodyStyle.filter === 'none'
                    && bodyStyle.contain === 'none' && bodyStyle.willChange === 'auto'
                    && bodyStyle.contentVisibility === 'visible'
                    && [bodyStyle.translate, bodyStyle.rotate, bodyStyle.scale, bodyStyle.backdropFilter]
                        .every(value => !value || value === 'none')) containingBlock = null;
            }
        }
        const tree = node.getRootNode();
        node = node.parentElement ?? (tree instanceof ShadowRoot ? tree.host : null);
        if (!node || node === root) continue;
        const style = win.getComputedStyle(node);
        const outsideContainingBlock = containingBlock !== undefined && node !== containingBlock;
        if (node === containingBlock) containingBlock = undefined;
        // Propagated body overflow clips the viewport, not the body's content box.
        if (node === doc.body && (rootStyle.overflowX || rootStyle.overflow || 'visible') === 'visible'
            && (rootStyle.overflowY || rootStyle.overflow || 'visible') === 'visible'
            && rootStyle.display !== 'none' && rootStyle.contain === 'none' && style.contain === 'none') continue;
        const clips = (value: string) => /^(auto|scroll|hidden|clip|overlay)$/.test(value);
        const overflowX = style.overflowX || style.overflow, overflowY = style.overflowY || style.overflow;
        // Overflow boxes between an out-of-flow descendant and its containing block do not clip it.
        const clipX = clips(overflowX) && !outsideContainingBlock;
        const clipY = clips(overflowY) && !outsideContainingBlock;
        if (!clipX && !clipY) continue;
        const rect = node.getBoundingClientRect();
        const host = node as HTMLElement;
        const sx = host.offsetWidth ? rect.width / host.offsetWidth : 1;
        const sy = host.offsetHeight ? rect.height / host.offsetHeight : 1;
        const x = rect.left + host.clientLeft * sx, y = rect.top + host.clientTop * sy;
        if (clipX) { left = Math.max(left, x); right = Math.min(right, x + (host.offsetWidth ? host.clientWidth * sx : rect.width)); }
        if (clipY) { top = Math.max(top, y); bottom = Math.min(bottom, y + (host.offsetHeight ? host.clientHeight * sy : rect.height)); }
    }
    return { left, top, right, bottom };
}
