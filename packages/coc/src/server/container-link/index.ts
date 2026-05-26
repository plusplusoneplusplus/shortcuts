/**
 * Container Link — Module Index
 *
 * Exports the container-link client and protocol types.
 */

export { ContainerLinkClient, type ContainerLinkOptions, type ContainerLinkStatus } from './container-client';
export { registerContainerLinkRoutes, type ContainerLinkRouteContext, type ContainerLinkStatusResponse } from './container-link-routes';
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
