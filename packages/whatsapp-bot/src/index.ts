/**
 * @plusplusoneplusplus/whatsapp-bot
 *
 * Standalone WhatsApp bot package — no CoC/forge dependencies.
 */

export { WhatsAppBot } from './bot';
export type { InboundWAMessage, BotOptions, BotStatus, WASocket } from './types';
export { createBaileysConnection } from './connection';
