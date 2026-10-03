export const IC3_RESOURCE = 'https://ic3.teams.office.com';
export const IC3_DIRECT_MESSAGE_TIMEOUT_MS = 10_000;
export const IC3_CREDENTIAL_EXPIRY_MARGIN_MS = 60_000;
export const IC3_SELF_CHAT = '48:notes';

/** Routing regions accepted by this experimental Teams cloud client. */
export type Ic3DirectMessageRegion = 'amer' | 'emea' | 'apac';

export function isIc3DirectMessageRegion(value: unknown): value is Ic3DirectMessageRegion {
    return value === 'amer' || value === 'emea' || value === 'apac';
}

/** Returns a JWT with IC3 audience, exp, oid, and name for the current account; must honor cancellation. */
export type Ic3TokenProvider = (signal: AbortSignal) => Promise<string>;

/** Authoritative, connection-scoped read; IDs alone never establish a chat's type or membership. */
export type Ic3ChatVerifier = (chatId: string, signal: AbortSignal) => Promise<{
    chatId: string;
    chatType: string;
    memberIds: readonly string[];
    connectionId: string;
}>;

export interface Ic3DirectMessageOptions {
    readonly connectionId?: string;
    readonly verifyChat?: Ic3ChatVerifier;
    /** Explicit routing only; unset disables IC3 writes until configured and reconnected. */
    readonly region?: Ic3DirectMessageRegion;
    /** IC3 audience: https://ic3.teams.office.com. Defaults to Azure CLI; injection needs no Azure CLI. */
    readonly acquireToken?: Ic3TokenProvider;
    /** Explicit identity pin for hybrid connections; both token claims must match. */
    readonly expectedAccount?: { readonly tenantId: string; readonly objectId: string };
}
