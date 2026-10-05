param(
    [string]$WindowHandle
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class BrowserFocusInput {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    public struct GuiThreadInfo {
        public uint Size, Flags;
        public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
        public Rect CaretRect;
    }
    private delegate bool EnumWindow(IntPtr window, IntPtr data);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnumChildWindows(IntPtr parent, EnumWindow callback, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, System.Text.StringBuilder name, int size);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr process);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo info);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool PostMessage(IntPtr window, uint message, UIntPtr wparam, IntPtr lparam);
    public static void Slash(long owner) {
        var parent = new IntPtr(owner);
        var thread = GetWindowThreadProcessId(parent, IntPtr.Zero);
        EnumChildWindows(parent, (window, data) => {
            var name = new System.Text.StringBuilder(256);
            GetClassName(window, name, name.Capacity);
            if (name.ToString() == "CoCBrowserHost")
                thread = GetWindowThreadProcessId(window, IntPtr.Zero);
            return true;
        }, IntPtr.Zero);
        var info = new GuiThreadInfo { Size = (uint)Marshal.SizeOf(typeof(GuiThreadInfo)) };
        if (!GetGUIThreadInfo(thread, ref info) || info.Focus == IntPtr.Zero)
            throw new InvalidOperationException("Browser input queue has no native keyboard focus.");
        // Route the character to the native input queue's focused HWND, not a chosen renderer.
        var focusClass = new System.Text.StringBuilder(256);
        GetClassName(info.Focus, focusClass, focusClass.Capacity);
        Console.WriteLine(focusClass.ToString() + " owner=" + owner + " focus=" + info.Focus.ToInt64() + " thread=" + thread);
        if (!PostMessage(info.Focus, 0x102, new UIntPtr(47), new IntPtr(1)))
            throw new System.ComponentModel.Win32Exception();
    }
}
'@
[BrowserFocusInput]::Slash([long]$WindowHandle)
