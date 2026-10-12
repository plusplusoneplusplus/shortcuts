'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);

exports.inspectNativeChrome = async (pid, click = false) => {
    if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid <= 0 || pid > 0xffffffff) {
        throw new Error('A fixture-owned Windows native helper is required');
    }
    const script = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class FixtureChrome {
    public delegate bool Visitor(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] public static extern bool EnumWindows(Visitor visitor, IntPtr parameter);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr window, Visitor visitor, IntPtr parameter);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder text, int length);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    public static string Inspect(uint process, bool click) {
        bool badge = false, stop = false, clicked = false;
        EnumWindows((window, parameter) => {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            var name = new StringBuilder(256);
            GetClassName(window, name, name.Capacity);
            if (owner != process || name.ToString() != "CoCBrowserHost") return true;
            IntPtr button = IntPtr.Zero;
            EnumChildWindows(window, (child, ignored) => {
                uint childOwner;
                GetWindowThreadProcessId(child, out childOwner);
                if (childOwner != process) return true;
                var kind = new StringBuilder(256);
                var text = new StringBuilder(256);
                GetClassName(child, kind, kind.Capacity);
                if (!kind.ToString().Equals("STATIC", StringComparison.OrdinalIgnoreCase)
                    && !kind.ToString().Equals("BUTTON", StringComparison.OrdinalIgnoreCase)) return true;
                GetWindowText(child, text, text.Capacity);
                if (IsWindowVisible(child) && kind.ToString().Equals("STATIC", StringComparison.OrdinalIgnoreCase)
                    && text.ToString() == "AI controlling") badge = true;
                if (IsWindowVisible(child) && kind.ToString().Equals("BUTTON", StringComparison.OrdinalIgnoreCase)
                    && text.ToString() == "Stop") { stop = true; button = child; }
                return true;
            }, IntPtr.Zero);
            if (click && button != IntPtr.Zero) {
                SendMessage(button, 0x00F5, IntPtr.Zero, IntPtr.Zero);
                clicked = true;
            }
            return true;
        }, IntPtr.Zero);
        return "{\\"badge\\":" + (badge ? "true" : "false") + ",\\"stop\\":" + (stop ? "true" : "false")
            + ",\\"clicked\\":" + (clicked ? "true" : "false") + "}";
    }
}
'@
[FixtureChrome]::Inspect(${pid}, $${click ? 'true' : 'false'})`;
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 15000, windowsHide: true });
    return JSON.parse(stdout.trim());
};
