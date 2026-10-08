param([string]$WindowHandle)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class BrowserWindowGeometry {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    public struct Point { public int X, Y; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string name, string title);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool ClientToScreen(IntPtr window, ref Point point);
    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr window);
    public static string Read(long owner) {
        var parent = new IntPtr(owner);
        var renderer = FindWindowEx(parent, IntPtr.Zero, "Chrome_RenderWidgetHostHWND", null);
        var browser = FindWindowEx(parent, IntPtr.Zero, "CoCBrowserHost", null);
        if (renderer == IntPtr.Zero || browser == IntPtr.Zero)
            throw new InvalidOperationException("Renderer or browser window is missing.");
        var origin = new Point();
        Rect bounds;
        if (!ClientToScreen(renderer, ref origin) || !GetWindowRect(browser, out bounds))
            throw new System.ComponentModel.Win32Exception();
        return string.Format(
            "{{\"rendererX\":{0},\"rendererY\":{1},\"browserX\":{2},\"browserY\":{3},\"width\":{4},\"height\":{5},\"dpi\":{6}}}",
            origin.X, origin.Y, bounds.Left, bounds.Top,
            bounds.Right - bounds.Left, bounds.Bottom - bounds.Top, GetDpiForWindow(parent));
    }
}
'@
[BrowserWindowGeometry]::Read([long]$WindowHandle)
