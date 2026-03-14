/**
 * NotificationContext — in-memory notification center state.
 * Stores up to 20 recent process events (newest first), tracks unread count.
 */

import { createContext, useContext, useReducer, useCallback, type ReactNode } from 'react';

export interface NotificationEntry {
    id: string;
    type: 'success' | 'error' | 'warning' | 'info';
    title: string;
    detail: string;
    timestamp: number;
    read: boolean;
    processId?: string;
}

export interface NotificationContextValue {
    notifications: NotificationEntry[];
    unreadCount: number;
    addNotification: (entry: Omit<NotificationEntry, 'id' | 'read' | 'timestamp'>) => void;
    markAllRead: () => void;
    clearAll: () => void;
}

const MAX_ENTRIES = 20;

interface State {
    notifications: NotificationEntry[];
}

type Action =
    | { type: 'ADD'; entry: NotificationEntry }
    | { type: 'MARK_ALL_READ' }
    | { type: 'CLEAR_ALL' };

let nextId = 1;

export function notificationReducer(state: State, action: Action): State {
    switch (action.type) {
        case 'ADD': {
            const updated = [action.entry, ...state.notifications];
            return { notifications: updated.slice(0, MAX_ENTRIES) };
        }
        case 'MARK_ALL_READ':
            return {
                notifications: state.notifications.map(n => (n.read ? n : { ...n, read: true })),
            };
        case 'CLEAR_ALL':
            return { notifications: [] };
        default:
            return state;
    }
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotifications(): NotificationContextValue {
    const ctx = useContext(NotificationContext);
    if (!ctx) throw new Error('useNotifications must be used within <NotificationProvider>');
    return ctx;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(notificationReducer, { notifications: [] });

    const addNotification = useCallback(
        (entry: Omit<NotificationEntry, 'id' | 'read' | 'timestamp'>) => {
            dispatch({
                type: 'ADD',
                entry: {
                    ...entry,
                    id: `notif-${nextId++}`,
                    read: false,
                    timestamp: Date.now(),
                },
            });
        },
        [],
    );

    const markAllRead = useCallback(() => dispatch({ type: 'MARK_ALL_READ' }), []);
    const clearAll = useCallback(() => dispatch({ type: 'CLEAR_ALL' }), []);

    const unreadCount = state.notifications.filter(n => !n.read).length;

    return (
        <NotificationContext.Provider
            value={{ notifications: state.notifications, unreadCount, addNotification, markAllRead, clearAll }}
        >
            {children}
        </NotificationContext.Provider>
    );
}
