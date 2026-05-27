/**
 * Inbound Module Index
 *
 * Exports the inbound agent manager, protocol types, and WebSocket handler.
 */

export { AgentManager, type InboundAgent, type DisconnectedAgent, type PendingRequest } from './agent-manager';
export {
    createMessage,
    parseMessage,
    type ChannelMessage,
    type ChannelMessageType,
    type RegisterPayload,
    type HeartbeatPayload,
    type EventPayload,
    type ResponsePayload,
    type SSEEventPayload,
    type RegisteredPayload,
    type RequestPayload,
    type SubscribeSSEPayload,
    type UnsubscribeSSEPayload,
} from './protocol';
