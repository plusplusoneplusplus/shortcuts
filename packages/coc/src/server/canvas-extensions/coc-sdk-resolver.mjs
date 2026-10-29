import { registerHooks } from 'node:module';

// Resolve from CoC, even when the extension has its own SDK or lives outside node_modules.
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === '@github/copilot-sdk' || specifier.startsWith('@github/copilot-sdk/')) {
            return nextResolve(specifier, { ...context, parentURL: import.meta.url });
        }
        return nextResolve(specifier, context);
    },
});
