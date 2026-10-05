import type { OpenUnifiedTabInput } from './unifiedPanelTabsModel';

/** Stable FNV-1a hash over UTF-16 code units, without putting paste text in ids. */
export function pasteResourceId(content: string): string {
    let hash = 0xcbf29ce484222325n;
    for (let index = 0; index < content.length; index += 1) {
        hash = BigInt.asUintN(64, (hash ^ BigInt(content.charCodeAt(index))) * 0x100000001b3n);
    }
    return `paste:${content.length}:${hash.toString(16).padStart(16, '0')}`;
}

/** Descriptor only: the raw snapshot stays in client memory, outside panel state. */
export function pasteOpenInput(
    content: string,
    context: Pick<OpenUnifiedTabInput, 'ownerWorkspaceId' | 'ownerRoutingRef' | 'chatId' | 'repoLabel'>,
): OpenUnifiedTabInput {
    return {
        ...context,
        kind: 'paste',
        resourceId: pasteResourceId(content),
        label: `Pasted text (${content.length} chars)`,
    };
}
