/**
 * Semantic colors for an external definition source.
 *
 * Peek and the read-only tab both show text that has no language-server
 * document behind it, so nothing can be asked when Monaco wants tokens. The
 * tokens were fetched once, through the capability, and stored on the
 * external-source record. This provider serves exactly that record to exactly
 * one model and repaints when the record changes; anything else gets null and
 * keeps its basic syntax colors.
 *
 * Runtime-Monaco-free: the namespace is taken structurally.
 */

import { onExternalSourceChange, readExternalSourceRecord } from './externalSourceStore';
import { COC_SEMANTIC_TOKENS_LEGEND, type SemanticTokensLegend } from './semanticTokens';

interface Disposable {
    dispose(): void;
}

export interface ExternalSemanticTokensModel {
    getValue(): string;
}

export interface ExternalSemanticTokensMonaco {
    languages: {
        registerDocumentSemanticTokensProvider?(
            languageId: string,
            provider: {
                onDidChange(listener: () => void): Disposable;
                getLegend(): SemanticTokensLegend;
                provideDocumentSemanticTokens(model: ExternalSemanticTokensModel): { data: Uint32Array } | null;
                releaseDocumentSemanticTokens(resultId: string | undefined): void;
            },
        ): Disposable;
    };
}

/** Color `model` from the stored tokens of `resourceId`. Returns the disposer. */
export function registerExternalSemanticTokens(options: {
    monaco: ExternalSemanticTokensMonaco;
    languageId: string;
    model: ExternalSemanticTokensModel;
    resourceId: string;
}): () => void {
    const { monaco, languageId, model, resourceId } = options;
    const register = monaco.languages.registerDocumentSemanticTokensProvider;
    if (!register) return () => {};
    const listeners = new Set<() => void>();
    const unsubscribe = onExternalSourceChange(resourceId, () => {
        for (const listener of [...listeners]) listener();
    });
    const registration = register.call(monaco.languages, languageId, {
        onDidChange: (listener) => {
            listeners.add(listener);
            return { dispose: () => { listeners.delete(listener); } };
        },
        getLegend: () => COC_SEMANTIC_TOKENS_LEGEND,
        provideDocumentSemanticTokens: (target) => {
            if (target !== model) return null;
            const record = readExternalSourceRecord(resourceId);
            const tokens = record?.semanticTokens;
            // Tokens computed for other text would land on the wrong characters.
            if (!tokens || record.failure || target.getValue() !== record.content) return null;
            return { data: tokens.slice() };
        },
        releaseDocumentSemanticTokens: () => {},
    });
    return () => {
        unsubscribe();
        listeners.clear();
        registration.dispose();
    };
}
