import pino from 'pino';

let sdkLogger: pino.Logger | null = null;

export function initSDKLogger(loggerOrOptions: pino.Logger | pino.LoggerOptions): void {
    if (loggerOrOptions && typeof (loggerOrOptions as pino.Logger).child === 'function') {
        const l = loggerOrOptions as pino.Logger;
        sdkLogger = l.child({ store: 'coc-agent-sdk' });
    } else {
        sdkLogger = pino(loggerOrOptions as pino.LoggerOptions);
    }
}

export function resetSDKLogger(): void {
    sdkLogger = null;
}

export function getSDKLogger(): pino.Logger {
    if (!sdkLogger) {
        return pino({ level: 'silent' });
    }
    return sdkLogger;
}

export function createSessionLogger(sessionId: string): pino.Logger {
    return getSDKLogger().child({ sessionId });
}

export const getAIServiceLogger = getSDKLogger;
