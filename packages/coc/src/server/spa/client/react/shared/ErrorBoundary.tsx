import { Component, type ReactNode, type ErrorInfo } from 'react';

interface ErrorBoundaryProps {
    children: ReactNode;
    /** Shown in the fallback UI heading. Defaults to "Something went wrong". */
    label?: string;
    /** When true, renders a compact inline error instead of a full-page overlay. */
    inline?: boolean;
}

interface ErrorBoundaryState {
    error: Error | null;
}

/**
 * Generic React ErrorBoundary.
 *
 * - **Top-level** (`inline=false`, default): full-screen overlay with reload button.
 * - **Inline** (`inline=true`): compact card suitable for wrapping dialogs or panels.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[ErrorBoundary]', this.props.label ?? 'Uncaught render error', error, info.componentStack);
    }

    private handleReload = () => {
        window.location.reload();
    };

    private handleDismiss = () => {
        this.setState({ error: null });
    };

    render() {
        if (!this.state.error) {
            return this.props.children;
        }

        const heading = this.props.label ?? 'Something went wrong';

        if (this.props.inline) {
            return (
                <div
                    role="alert"
                    className="flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-[#1e1e1e] dark:text-[#cccccc]"
                >
                    <span className="text-2xl">⚠️</span>
                    <p className="font-semibold">{heading}</p>
                    <p className="text-xs text-[#848484] max-w-xs break-words">{this.state.error.message}</p>
                    <div className="flex gap-2">
                        <button
                            onClick={this.handleDismiss}
                            className="px-3 py-1 rounded text-xs bg-[#e8e8e8] dark:bg-[#3c3c3c] hover:bg-[#d4d4d4] dark:hover:bg-[#505050] transition-colors"
                        >
                            Dismiss
                        </button>
                        <button
                            onClick={this.handleReload}
                            className="px-3 py-1 rounded text-xs bg-[#0078d4] text-white hover:bg-[#106ebe] transition-colors"
                        >
                            Reload
                        </button>
                    </div>
                </div>
            );
        }

        return (
            <div
                role="alert"
                className="fixed inset-0 z-[99999] flex flex-col items-center justify-center gap-4 bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc]"
            >
                <span className="text-5xl">😵</span>
                <h1 className="text-lg font-semibold">{heading}</h1>
                <p className="text-sm text-[#848484] max-w-md text-center break-words">{this.state.error.message}</p>
                <button
                    onClick={this.handleReload}
                    className="mt-2 px-4 py-2 rounded bg-[#0078d4] text-white text-sm hover:bg-[#106ebe] transition-colors"
                >
                    Reload
                </button>
            </div>
        );
    }
}
