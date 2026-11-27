/**
 * The Notes paper-link decoration: the embeds package's extension with the CoC
 * classifier (arXiv in any form, or a `.pdf` URL) and the desktop-shell check.
 */
import type { Node as PMNode } from '@tiptap/pm/model';
import {
    PaperLinkEmbedDecorationExtension as BasePaperLinkEmbedDecorationExtension,
    findPaperLinkRuns as findPaperLinkRunsWith,
    type PaperLinkEmbedOptions as BasePaperLinkEmbedOptions,
    type PaperLinkRun as BasePaperLinkRun,
} from '@plusplusoneplusplus/tiptap-embeds/paper';
import { classifyPaperLink, type PaperLinkInfo } from './paperLink';
import { isDesktopShell } from '../../../../hooks/ui/useDesktopShell';

export {
    buildPaperLinkButtons,
    paperLinkEmbedPluginKey,
    type PaperLinkButtonsOptions,
} from '@plusplusoneplusplus/tiptap-embeds/paper';

export type PaperLinkEmbedOptions = BasePaperLinkEmbedOptions<PaperLinkInfo>;
export type PaperLinkRun = BasePaperLinkRun<PaperLinkInfo>;

/** Every paper link-mark run in `doc`, classified with the Notes rules. */
export function findPaperLinkRuns(doc: PMNode): PaperLinkRun[] {
    return findPaperLinkRunsWith(doc, classifyPaperLink);
}

export const PaperLinkEmbedDecorationExtension = BasePaperLinkEmbedDecorationExtension.extend<PaperLinkEmbedOptions>({
    addOptions() {
        return {
            classifyLink: classifyPaperLink,
            isDesktopShell,
            onRequestPopout: undefined,
            renderInlineViewer: undefined,
        };
    },
});
