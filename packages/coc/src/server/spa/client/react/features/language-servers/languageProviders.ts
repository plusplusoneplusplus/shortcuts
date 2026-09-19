/**
 * Monaco providers over one live language document (AC-03).
 *
 * This is where the feature finally asks the language server a question.
 * `monacoBridge.ts` keeps the buffer in step, `languageFeatures.ts` converts the
 * answers, and this module owns the registration: which Monaco provider exists
 * for which model, when it may run, and what happens to a superseded request.
 *
 * The rules that shape it:
 *   - Registration is per document, but Monaco only registers per *language*.
 *     Every provider therefore starts by comparing the model it was handed with
 *     the model it was registered for and returns nothing for anyone else. That
 *     is what keeps a second Monaco instance showing a diff, a search buffer or
 *     a canvas snippet in the same language from being answered out of this
 *     document's buffer.
 *   - A provider only exists while the server advertises the matching
 *     capability. Capabilities arrive with the attach, and a restart or a
 *     configuration change can change them, so the registration is recomputed
 *     whenever the advertised set changes. While no session has reported
 *     capabilities yet we register optimistically: an unsupported request
 *     answers empty, whereas a missing provider would answer nothing at all
 *     even after the server turns out to support the feature.
 *   - Monaco's `CancellationToken` becomes an `AbortSignal`, so a superseded
 *     hover or completion sends `$/cancelRequest` instead of tying up the
 *     server behind work nobody will read.
 *   - A request that fails is an empty answer, never a thrown error: a language
 *     server going away must not break typing in the editor.
 *   - The default URI resolver drops results outside this workspace. A
 *     repo-group host supplies an owner-aware resolver that accepts live members
 *     and represents rejected targets with an unavailable in-memory model.
 *   - The preferred semantic server is authoritative for definitions. The
 *     `coc-symbols` attachment is queried alongside it, but its answer is used
 *     only when the semantic server has no locations. Mixing the two is what
 *     made a C++ jump land on a call site that merely shares the token's spelling.
 *
 * Runtime-Monaco-free like its neighbours: the `monaco` namespace arrives as an
 * argument, described structurally, so the tests drive real provider code
 * without a real editor.
 */

import type { LanguageDocumentView } from './documentStore';
import { SYMBOL_CANDIDATE_FRAGMENT } from './editorNavigation';
import { EXTERNAL_URI_SCHEME } from './externalSource';
import type { LanguageServerSessionStateView } from './languageServerClient';
import { toLspPosition, type MonacoPosition, type MonacoRange } from './monacoBridge';
import {
    toCompletionList,
    toHover,
    toLocationLinks,
    toSignatureHelp,
    type MonacoCompletionItem,
    type MonacoHover,
    type MonacoSignatureHelp,
} from './languageFeatures';

// ============================================================================
// The slice of Monaco this module needs, described structurally
// ============================================================================

export interface ProviderDisposable {
    dispose(): void;
}

export interface ProviderUri {
    toString(): string;
}

export interface ProviderModel {
    uri: ProviderUri;
    /** Monaco's word range at the cursor, used as the completion fallback range. */
    getWordUntilPosition(position: MonacoPosition): { startColumn: number; endColumn: number };
}

export interface ProviderCancellationToken {
    isCancellationRequested: boolean;
    onCancellationRequested(listener: () => void): ProviderDisposable | void;
}

export interface ProviderCompletionContext {
    triggerKind?: number;
    triggerCharacter?: string;
}

export interface ProviderReferenceContext {
    includeDeclaration?: boolean;
}

export interface ProviderSignatureHelpContext {
    triggerKind?: number;
    triggerCharacter?: string;
    isRetrigger?: boolean;
}

/** Monaco's `SignatureHelpResult`: the help plus the caller's release hook. */
export interface ProviderSignatureHelpResult {
    value: MonacoSignatureHelp;
    dispose(): void;
}

export interface ProviderLocationLink {
    uri: ProviderUri;
    range: MonacoRange;
    originSelectionRange?: MonacoRange;
    targetSelectionRange?: MonacoRange;
}

export interface ProviderCompletionList {
    suggestions: MonacoCompletionItem[];
    incomplete: boolean;
}

export interface MonacoLanguagesLike {
    registerHoverProvider(
        languageId: string,
        provider: {
            provideHover(
                model: ProviderModel,
                position: MonacoPosition,
                token: ProviderCancellationToken,
            ): Promise<MonacoHover | null>;
        },
    ): ProviderDisposable;
    registerDefinitionProvider(
        languageId: string,
        provider: {
            provideDefinition(
                model: ProviderModel,
                position: MonacoPosition,
                token: ProviderCancellationToken,
            ): Promise<ProviderLocationLink[] | null>;
        },
    ): ProviderDisposable;
    registerReferenceProvider(
        languageId: string,
        provider: {
            provideReferences(
                model: ProviderModel,
                position: MonacoPosition,
                context: ProviderReferenceContext,
                token: ProviderCancellationToken,
            ): Promise<ProviderLocationLink[] | null>;
        },
    ): ProviderDisposable;
    registerCompletionItemProvider(
        languageId: string,
        provider: {
            triggerCharacters?: string[];
            provideCompletionItems(
                model: ProviderModel,
                position: MonacoPosition,
                context: ProviderCompletionContext,
                token: ProviderCancellationToken,
            ): Promise<ProviderCompletionList | null>;
        },
    ): ProviderDisposable;
    registerSignatureHelpProvider(
        languageId: string,
        provider: {
            signatureHelpTriggerCharacters?: string[];
            signatureHelpRetriggerCharacters?: string[];
            provideSignatureHelpItems(
                model: ProviderModel,
                position: MonacoPosition,
                token: ProviderCancellationToken,
                context: ProviderSignatureHelpContext,
            ): Promise<ProviderSignatureHelpResult | null>;
        },
    ): ProviderDisposable;
}

export interface MonacoLike {
    languages: MonacoLanguagesLike;
    Uri: { parse(value: string): ProviderUri };
}

// ============================================================================
// Capabilities
// ============================================================================

export type LanguageFeature = 'hover' | 'definition' | 'references' | 'completion' | 'signatureHelp';

export const LANGUAGE_FEATURES: readonly LanguageFeature[] = [
    'hover',
    'definition',
    'references',
    'completion',
    'signatureHelp',
];

const CAPABILITY_KEYS: Record<LanguageFeature, string> = {
    hover: 'hoverProvider',
    definition: 'definitionProvider',
    references: 'referencesProvider',
    completion: 'completionProvider',
    signatureHelp: 'signatureHelpProvider',
};

/** The advertised capability record, or null while no session has reported one. */
function readCapabilities(state: LanguageServerSessionStateView | null | undefined): Record<string, unknown> | null {
    const capabilities = state?.capabilities;
    if (!capabilities || typeof capabilities !== 'object') {
        return null;
    }
    return capabilities as Record<string, unknown>;
}

/**
 * Whether a feature may be registered. `true` and an options object both mean
 * supported; `false`, `null` and a missing key mean not. Unknown capabilities —
 * no session yet — enable everything, so the first hover after the attach is
 * not silently dropped.
 */
export function supportsFeature(
    state: LanguageServerSessionStateView | null | undefined,
    feature: LanguageFeature,
): boolean {
    const capabilities = readCapabilities(state);
    if (!capabilities) {
        return true;
    }
    const value = capabilities[CAPABILITY_KEYS[feature]];
    if (value === true) {
        return true;
    }
    return typeof value === 'object' && value !== null;
}

function triggerCharacters(
    state: LanguageServerSessionStateView | null | undefined,
    feature: LanguageFeature,
    key: 'triggerCharacters' | 'retriggerCharacters',
): string[] | undefined {
    const capabilities = readCapabilities(state);
    const value = capabilities?.[CAPABILITY_KEYS[feature]];
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const characters = (value as Record<string, unknown>)[key];
    if (!Array.isArray(characters)) {
        return undefined;
    }
    const filtered = characters.filter((entry): entry is string => typeof entry === 'string');
    return filtered.length > 0 ? filtered : undefined;
}

/**
 * Everything a registration depends on, flattened to a string. When this
 * changes the providers are torn down and rebuilt; when it does not, a status
 * update (a reconnect, a diagnostic, a version bump) leaves them alone.
 */
export function capabilityFingerprint(state: LanguageServerSessionStateView | null | undefined): string {
    const parts: string[] = [];
    for (const feature of LANGUAGE_FEATURES) {
        parts.push(`${feature}:${supportsFeature(state, feature) ? 1 : 0}`);
    }
    parts.push(`completion+${(triggerCharacters(state, 'completion', 'triggerCharacters') ?? []).join('')}`);
    parts.push(`signature+${(triggerCharacters(state, 'signatureHelp', 'triggerCharacters') ?? []).join('')}`);
    parts.push(`signature~${(triggerCharacters(state, 'signatureHelp', 'retriggerCharacters') ?? []).join('')}`);
    return parts.join('|');
}

// ============================================================================
// Registration
// ============================================================================

export interface RegisterLanguageProvidersOptions {
    monaco: MonacoLike;
    /** The model these providers answer for; every other model is ignored. */
    model: ProviderModel;
    /** The authoritative document. Requests go through it, never the transport. */
    view: LanguageDocumentView;
    /** Monaco language id to register under, e.g. `typescript`. */
    languageId: string;
    /**
     * Turns a result URI into something Monaco can open. The default accepts
     * only URIs naming a document in this workspace and drops the rest.
     */
    resolveUri?: (
        uri: string,
        signal: AbortSignal,
        target: { lineNumber: number; column: number; waitForContent: boolean },
    ) => ProviderUri | null | Promise<ProviderUri | null>;
}

function definitionKey(link: ProviderLocationLink): string {
    return `${link.uri.toString().replace(/#.*$/, '')}:${link.range.startLineNumber}`;
}

/** First occurrence of each location, in the order the server reported them. */
function dedupeDefinitionLinks(links: readonly ProviderLocationLink[]): ProviderLocationLink[] {
    const seen = new Set<string>();
    return links.filter((link) => {
        const key = definitionKey(link);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** Same scheme and authority as the document itself, i.e. this workspace. */
function sameWorkspace(documentUri: string, target: string): boolean {
    const cut = documentUri.indexOf('/', documentUri.indexOf('//') + 2);
    const prefix = cut === -1 ? documentUri : documentUri.slice(0, cut + 1);
    return target.startsWith(prefix);
}

async function runRequest<T>(
    view: LanguageDocumentView,
    method: string,
    params: unknown,
    token: ProviderCancellationToken,
): Promise<unknown | null> {
    if (token.isCancellationRequested) {
        return null;
    }
    const controller = new AbortController();
    const subscription = token.onCancellationRequested(() => controller.abort());
    try {
        return await view.sendRequest<T>(method, params, { signal: controller.signal });
    } catch {
        // A timeout, a dead session or an unsupported method are all "no answer".
        return null;
    } finally {
        if (subscription && typeof subscription.dispose === 'function') {
            subscription.dispose();
        }
    }
}

async function runTargetedRequest<T>(
    view: LanguageDocumentView,
    definitionId: string,
    method: string,
    params: unknown,
    signal: AbortSignal,
): Promise<unknown | null> {
    if (signal.aborted) {
        return null;
    }
    try {
        return await view.sendRequestTo<T>(definitionId, method, params, { signal });
    } catch {
        return null;
    }
}

const SYMBOLS_DEFINITION_ID = 'coc-symbols';

/**
 * Registers the selected language features for one model and returns a single
 * disposable. Dispose it with the document: a provider outliving its buffer
 * would answer out of a document the host has already closed.
 */
export function registerLanguageProviders(options: RegisterLanguageProvidersOptions): ProviderDisposable {
    const { monaco, model, view, languageId } = options;
    const modelUri = model.uri.toString();
    const resolveUri = options.resolveUri
        ?? ((uri: string) => (sameWorkspace(view.uri, uri) ? monaco.Uri.parse(uri) : null));

    const owns = (candidate: ProviderModel): boolean => candidate === model || candidate.uri.toString() === modelUri;

    const toProviderLinks = async (result: unknown, signal: AbortSignal): Promise<ProviderLocationLink[]> => {
        const links = toLocationLinks(result);
        return (
            await Promise.all(links.map(async (link) => {
                const target = link.targetSelectionRange ?? link.range;
                const uri = await resolveUri(link.uri, signal, {
                    lineNumber: target.startLineNumber,
                    column: target.startColumn,
                    waitForContent: links.length > 1,
                });
                return uri ? { ...link, uri } : null;
            }))
        ).filter((link): link is ProviderLocationLink => link !== null);
    };

    /**
     * Exact targets, kept whole. A target the surface cannot load stays in the
     * list wearing its own URI: the server said this is the definition, and
     * reporting it as unavailable is honest where dropping it would leave the
     * request looking semantically empty and hand the list to the symbol index.
     */
    const resolveExactLinks = async (
        links: readonly ReturnType<typeof toLocationLinks>[number][],
        signal: AbortSignal,
    ): Promise<ProviderLocationLink[]> => Promise.all(links.map(async (link) => {
        const target = link.targetSelectionRange ?? link.range;
        const uri = await resolveUri(link.uri, signal, {
            lineNumber: target.startLineNumber,
            column: target.startColumn,
            // An external source is also waited for when it is the only
            // result: confirming it tears down the pane whose attachment may
            // read it, so the content has to exist before Monaco navigates.
            waitForContent: links.length > 1 || link.uri.startsWith(`${EXTERNAL_URI_SCHEME}:`),
        });
        return { ...link, uri: uri ?? monaco.Uri.parse(link.uri) };
    }));

    let registrations: ProviderDisposable[] = [];

    const register = (state: LanguageServerSessionStateView | null): void => {
        const next: ProviderDisposable[] = [];
        if (supportsFeature(state, 'hover')) {
            next.push(monaco.languages.registerHoverProvider(languageId, {
                provideHover: async (target, position, token) => {
                    if (!owns(target)) {
                        return null;
                    }
                    const result = await runRequest(
                        view,
                        'textDocument/hover',
                        view.documentParams({ position: toLspPosition(position) }),
                        token,
                    );
                    return toHover(result);
                },
            }));
        }
        const definitionServers = view.getServerInfos()
            .filter(info => supportsFeature(info.state, 'definition'));
        if (supportsFeature(state, 'definition') || definitionServers.length > 0) {
            next.push(monaco.languages.registerDefinitionProvider(languageId, {
                provideDefinition: async (target, position, token) => {
                    if (!owns(target)) {
                        return null;
                    }
                    const controller = new AbortController();
                    // The symbols request is speculative and gets its own signal,
                    // so a semantic answer can abandon it without cancelling
                    // the target resolution that is still running on `token`.
                    const speculative = new AbortController();
                    const subscription = token.onCancellationRequested(() => {
                        controller.abort();
                        speculative.abort();
                    });
                    try {
                        const params = view.documentParams({ position: toLspPosition(position) });
                        const servers = view.getServerInfos()
                            .filter(info => supportsFeature(info.state, 'definition'));
                        const symbolServer = servers.find(info => info.definitionId === SYMBOLS_DEFINITION_ID);
                        const semanticServer = servers.find(info => info.definitionId !== SYMBOLS_DEFINITION_ID);
                        const semanticPromise = semanticServer
                            ? runTargetedRequest(
                                view,
                                semanticServer.definitionId,
                                'textDocument/definition',
                                params,
                                controller.signal,
                            )
                            : symbolServer
                                ? Promise.resolve(null)
                                : runRequest(view, 'textDocument/definition', params, token);
                        // Started alongside the semantic request, not after it,
                        // so the fallback costs no extra latency when clangd has
                        // nothing to say. Its result is dropped when it does.
                        const candidatePromise = symbolServer
                            ? runTargetedRequest(
                                view,
                                symbolServer.definitionId,
                                'textDocument/definition',
                                params,
                                speculative.signal,
                            )
                            : Promise.resolve(null);

                        const semantic = await semanticPromise;
                        const semanticLinks = toLocationLinks(semantic);
                        if (semanticLinks.length > 0) {
                            speculative.abort();
                            return dedupeDefinitionLinks(
                                await resolveExactLinks(semanticLinks, controller.signal),
                            );
                        }

                        const results = await candidatePromise;
                        if (token.isCancellationRequested || speculative.signal.aborted) {
                            return [];
                        }
                        const candidates = await Promise.all(toLocationLinks(results).map(
                            async (result): Promise<ProviderLocationLink | null> => {
                                const candidateUri = `${
                                    result.uri.toString().replace(/#.*$/, '')
                                }#${SYMBOL_CANDIDATE_FRAGMENT}`;
                                const targetRange = result.targetSelectionRange ?? result.range;
                                const uri = await resolveUri(
                                    candidateUri,
                                    controller.signal,
                                    {
                                        lineNumber: targetRange.startLineNumber,
                                        column: targetRange.startColumn,
                                        waitForContent: true,
                                    },
                                );
                                return uri
                                    ? {
                                        ...result,
                                        uri,
                                    }
                                    : null;
                            },
                        ));
                        return dedupeDefinitionLinks(
                            candidates.filter((link): link is ProviderLocationLink => link !== null),
                        );
                    } finally {
                        if (subscription && typeof subscription.dispose === 'function') {
                            subscription.dispose();
                        }
                    }
                },
            }));
        }
        if (supportsFeature(state, 'references')) {
            next.push(monaco.languages.registerReferenceProvider(languageId, {
                provideReferences: async (target, position, context, token) => {
                    if (!owns(target)) {
                        return null;
                    }
                    const result = await runRequest(
                        view,
                        'textDocument/references',
                        view.documentParams({
                            position: toLspPosition(position),
                            context: { includeDeclaration: context?.includeDeclaration !== false },
                        }),
                        token,
                    );
                    const controller = new AbortController();
                    const subscription = token.onCancellationRequested(() => controller.abort());
                    try {
                        return await toProviderLinks(result, controller.signal);
                    } finally {
                        if (subscription && typeof subscription.dispose === 'function') {
                            subscription.dispose();
                        }
                    }
                },
            }));
        }
        if (supportsFeature(state, 'completion')) {
            next.push(monaco.languages.registerCompletionItemProvider(languageId, {
                triggerCharacters: triggerCharacters(state, 'completion', 'triggerCharacters'),
                provideCompletionItems: async (target, position, context, token) => {
                    if (!owns(target)) {
                        return null;
                    }
                    // Monaco already computed the word at the cursor; it is the
                    // range every item without an explicit edit replaces.
                    const word = target.getWordUntilPosition(position);
                    const fallbackRange: MonacoRange = {
                        startLineNumber: position.lineNumber,
                        startColumn: word.startColumn,
                        endLineNumber: position.lineNumber,
                        endColumn: position.column,
                    };
                    const params = view.documentParams({
                        position: toLspPosition(position),
                        context: {
                            triggerKind: context?.triggerKind ?? 1,
                            ...(context?.triggerCharacter ? { triggerCharacter: context.triggerCharacter } : {}),
                        },
                    });
                    const result = await runRequest(view, 'textDocument/completion', params, token);
                    if (result === null) {
                        return { suggestions: [], incomplete: false };
                    }
                    return toCompletionList(result, fallbackRange);
                },
            }));
        }
        if (supportsFeature(state, 'signatureHelp')) {
            next.push(monaco.languages.registerSignatureHelpProvider(languageId, {
                signatureHelpTriggerCharacters: triggerCharacters(state, 'signatureHelp', 'triggerCharacters'),
                signatureHelpRetriggerCharacters: triggerCharacters(state, 'signatureHelp', 'retriggerCharacters'),
                provideSignatureHelpItems: async (target, position, token, context) => {
                    if (!owns(target)) {
                        return null;
                    }
                    const params = view.documentParams({
                        position: toLspPosition(position),
                        ...(context
                            ? {
                                context: {
                                    triggerKind: context.triggerKind ?? 1,
                                    isRetrigger: context.isRetrigger === true,
                                    ...(context.triggerCharacter
                                        ? { triggerCharacter: context.triggerCharacter }
                                        : {}),
                                },
                            }
                            : {}),
                    });
                    const result = await runRequest(view, 'textDocument/signatureHelp', params, token);
                    const help = toSignatureHelp(result);
                    return help ? { value: help, dispose: () => {} } : null;
                },
            }));
        }
        registrations = next;
    };

    const disposeRegistrations = (): void => {
        for (const registration of registrations) {
            registration.dispose();
        }
        registrations = [];
    };

    const registrationFingerprint = (): string => [
        capabilityFingerprint(view.getSnapshot().state),
        ...view.getServerInfos().map(info => (
            `${info.definitionId}:${capabilityFingerprint(info.state)}`
        )),
    ].join('|server:');

    let fingerprint = registrationFingerprint();
    register(view.getSnapshot().state);

    // A restart or a configuration change can hand us a different server, and
    // therefore a different feature set, without the document ever closing.
    const unsubscribe = view.onStatus((snapshot) => {
        const next = registrationFingerprint();
        if (next === fingerprint) {
            return;
        }
        fingerprint = next;
        disposeRegistrations();
        register(snapshot.state);
    });

    let disposed = false;
    return {
        dispose: () => {
            if (disposed) {
                return;
            }
            disposed = true;
            unsubscribe();
            disposeRegistrations();
        },
    };
}
