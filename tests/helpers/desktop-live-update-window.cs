using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

// A fresh Actions user owns the exact installed path. Never used on a local user.
public static class MotionBenchLiveUpdateWindow {
    public sealed class Window {
        public int ProcessId; public long StartedUtcTicks; public string Executable,Title,ClassName; public long Handle;
    }
    private delegate bool WindowCallback(IntPtr window,IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback,IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window,out uint processId);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr window,StringBuilder value,int length);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern int GetClassNameW(IntPtr window,StringBuilder value,int length);
    [DllImport("user32.dll",SetLastError=true)] private static extern bool PostMessageW(IntPtr window,uint message,IntPtr parameter,IntPtr extra);
    private static void Gate() {
        if(Environment.OSVersion.Platform!=PlatformID.Win32NT || Environment.GetEnvironmentVariable("GITHUB_ACTIONS")!="true" || Environment.GetEnvironmentVariable("CI")!="true" || Environment.GetEnvironmentVariable("RUNNER_OS")!="Windows") throw new InvalidOperationException("Live update windows are controlled only on an isolated Windows Actions worker");
    }
    public static Window[] Find(string ownedExecutable,int excludedProcess,long notBeforeUtcTicks) {
        Gate(); string expected=Path.GetFullPath(ownedExecutable); var found=new List<Window>();
        EnumWindows((handle,p)=>{
            if(!IsWindowVisible(handle))return true; uint owner;GetWindowThreadProcessId(handle,out owner);
            if(owner==0 || owner==excludedProcess)return true;
            try {
                using(var process=Process.GetProcessById((int)owner)) {
                    string actual=Path.GetFullPath(process.MainModule.FileName); long started=process.StartTime.ToUniversalTime().Ticks;
                    if(!String.Equals(actual,expected,StringComparison.OrdinalIgnoreCase) || started<notBeforeUtcTicks)return true;
                    var title=new StringBuilder(1024);GetWindowTextW(handle,title,title.Capacity);var name=new StringBuilder(256);GetClassNameW(handle,name,name.Capacity);
                    if(name.ToString()!="Chrome_WidgetWin_1" || (title.ToString()!="MotionBench" && title.ToString()!="MotionBench · 运动表现评估"))return true;
                    found.Add(new Window {ProcessId=(int)owner,StartedUtcTicks=started,Executable=actual,Title=title.ToString(),ClassName=name.ToString(),Handle=handle.ToInt64()});
                }
            } catch(ArgumentException) {} catch(InvalidOperationException) {} catch(Win32Exception) {}
            return true;
        },IntPtr.Zero);return found.ToArray();
    }
    public static void Close(Window owned,string expectedExecutable) {
        Gate(); using(var process=Process.GetProcessById(owned.ProcessId)) {
            if(!String.Equals(Path.GetFullPath(process.MainModule.FileName),Path.GetFullPath(expectedExecutable),StringComparison.OrdinalIgnoreCase) || process.StartTime.ToUniversalTime().Ticks!=owned.StartedUtcTicks)throw new InvalidOperationException("The observed window no longer belongs to the owned installed process");
            uint owner;var handle=new IntPtr(owned.Handle);GetWindowThreadProcessId(handle,out owner);
            if(owner!=owned.ProcessId || !IsWindowVisible(handle))throw new InvalidOperationException("The owned restarted application window has changed");
            if(!PostMessageW(handle,0x10,IntPtr.Zero,IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }
}
