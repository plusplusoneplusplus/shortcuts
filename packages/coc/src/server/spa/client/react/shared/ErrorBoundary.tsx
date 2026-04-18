/**
 * ErrorBoundary — catches unhandled React render errors and displays
 * a recovery UI instead of a white screen.
 *
 * Without this, any uncaught error in the component tree causes React
 * to unmount the entire app, producing a blank page with no feedback.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        this.setState({ errorInfo });
        console.error('[CoC] Unhandled render error:', error, errorInfo);
    }

    private handleReload = () => {
        window.location.reload();
    };

    private handleClearAndReload = () => {
        try {
            // Remove CoC-specific localStorage keys to clear stale state
            const keysToRemove: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key?.startsWith('coc-') || key?.startsWith('coc.')) {
                    keysToRemove.push(key);
                }
            }
            for (const key of keysToRemove) {
                localStorage.removeItem(key);
            }
        } catch { /* storage unavailable */ }
        // Force a hard reload bypassing cache
        window.location.href = window.location.pathname + '?_t=' + Date.now();
    };

    render() {
        if (!this.state.hasError) {
            return this.props.children;
        }

        const { error } = this.state;

        return (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100vh',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                padding: '2rem',
                background: '#1e1e1e',
                color: '#cccccc',
            }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⚠️</div>
                <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
                    Something went wrong
                </h1>
                <p style={{ color: '#999', fontSize: '0.875rem', margin: '0 0 1.5rem', textAlign: 'center', maxWidth: 420 }}>
                    The dashboard encountered an unexpected error. This can happen when
                    the browser has cached stale data from a previous session.
                </p>

                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button
                        onClick={this.handleReload}
                        style={{
                            padding: '0.5rem 1.25rem',
                            border: '1px solid #555',
                            borderRadius: '4px',
                            background: 'transparent',
                            color: '#cccccc',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                        }}
                    >
                        Reload
                    </button>
                    <button
                        onClick={this.handleClearAndReload}
                        style={{
                            padding: '0.5rem 1.25rem',
                            border: 'none',
                            borderRadius: '4px',
                            background: '#0078d4',
                            color: '#ffffff',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                        }}
                    >
                        Clear Cache &amp; Reload
                    </button>
                </div>

                {error && (
                    <details style={{ marginTop: '1.5rem', width: '100%', maxWidth: 600 }}>
                        <summary style={{ cursor: 'pointer', color: '#848484', fontSize: '0.75rem' }}>
                            Error details
                        </summary>
                        <pre style={{
                            marginTop: '0.5rem',
                            padding: '0.75rem',
                            background: '#2d2d2d',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            overflow: 'auto',
                            maxHeight: 200,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                        }}>
                            {error.message}
                            {'\n'}
                            {error.stack}
                        </pre>
                    </details>
                )}
            </div>
        );
    }
}
