/**
 * WhatsApp connector — via Baileys (lazy-loaded).
 */

export { WhatsAppBot } from './bot';
export type { InboundWAMessage, BotOptions, BotStatus, WASocket, WhatsAppOutboundMedia, WhatsAppMediaContent } from './types';
export { WHATSAPP_MEDIA_MAX_BYTES, WhatsAppMediaError, validateWhatsAppMedia } from './outbound-media';
export type { WhatsAppMediaErrorCode } from './outbound-media';
export { createBaileysConnection } from './connection';
export { formatWhatsAppOutbound, formatWhatsAppQuestion, chunkWhatsAppText, stripWhatsAppGlobalPrefix } from './message-utils';
export type { WhatsAppOutbound, WhatsAppQuestion } from './message-utils';
