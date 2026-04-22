import { useDisplaySettings } from '../preferences/useDisplaySettings';

export function useTerminalEnabled(): boolean {
    return useDisplaySettings().terminalEnabled;
}
