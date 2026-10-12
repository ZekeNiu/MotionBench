using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

// Used only by the gated GitHub Actions installer probe, on its own desktop.
public sealed class MotionBenchInstallerDesktop : IDisposable {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct StartupInfo {
        public int cb; public string reserved, desktop, title;
        public int x,y,width,height,xChars,yChars,fill,flags; public short showWindow,reserved2;
        public IntPtr reservedPointer,input,output,error;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInfo { public IntPtr process,thread; public uint processId,threadId; }
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left,top,right,bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct BitmapInfo {
        public uint size; public int width,height; public ushort planes,bits;
        public uint compression,imageSize; public int xPixels,yPixels; public uint colors,importantColors;
    }
    private delegate bool WindowCallback(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern IntPtr CreateDesktopW(string name,IntPtr device,IntPtr mode,uint flags,uint access,IntPtr security);
    [DllImport("user32.dll")] private static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll")] private static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern bool GetUserObjectInformationW(IntPtr handle,int index,StringBuilder value,uint length,out uint needed);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern bool CreateProcessW(string app,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string directory,ref StartupInfo startup,out ProcessInfo process);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
    [DllImport("kernel32.dll")] private static extern bool TerminateProcess(IntPtr process,uint code);
    [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr OpenProcess(uint access,bool inherit,uint processId);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window,out uint processId);
    [DllImport("user32.dll")] private static extern bool EnumDesktopWindows(IntPtr desktop,WindowCallback callback,IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr window,WindowCallback callback,IntPtr parameter);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern int GetClassNameW(IntPtr window,StringBuilder value,int length);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr window,int id);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window,out Rect rectangle);
    [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="SendMessageTimeoutW",SetLastError=true)] private static extern IntPtr ReadMessage(IntPtr window,uint message,UIntPtr parameter,StringBuilder text,uint flags,uint timeout,out UIntPtr result);
    [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="SendMessageTimeoutW",SetLastError=true)] private static extern IntPtr WriteMessage(IntPtr window,uint message,UIntPtr parameter,string text,uint flags,uint timeout,out UIntPtr result);
    [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",SetLastError=true)] private static extern IntPtr ButtonMessage(IntPtr window,uint message,IntPtr parameter,IntPtr extra,uint flags,uint timeout,out UIntPtr result);
    [DllImport("user32.dll")] private static extern IntPtr GetWindowDC(IntPtr window);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window,IntPtr dc);
    [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr window,IntPtr dc,uint flags);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleBitmap(IntPtr dc,int width,int height);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc,IntPtr item);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr item);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern int GetDIBits(IntPtr dc,IntPtr bitmap,uint start,uint lines,[Out]byte[] pixels,ref BitmapInfo info,uint usage);
    private IntPtr handle;
    private ProcessInfo process;
    public string Name { get; private set; }
    public uint ProcessId { get { return process.processId; } }
    public bool DesktopClosed {get; private set;}
    public MotionBenchInstallerDesktop(string executable) {
        Name="MotionBench-Installer-"+Guid.NewGuid().ToString("N");
        handle=CreateDesktopW(Name,IntPtr.Zero,IntPtr.Zero,0,0x1ff,IntPtr.Zero);
        if(handle==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            uint needed;var station=new StringBuilder(256);
            if(!GetUserObjectInformationW(GetProcessWindowStation(),2,station,512,out needed)) throw new Win32Exception(Marshal.GetLastWin32Error());
            var startup=new StartupInfo {cb=Marshal.SizeOf(typeof(StartupInfo)),desktop=station.ToString()+"\\"+Name,flags=1,showWindow=1};
            if(!CreateProcessW(executable,new StringBuilder("\""+executable+"\""),IntPtr.Zero,IntPtr.Zero,false,0x200,IntPtr.Zero,Path.GetDirectoryName(executable),ref startup,out process)) throw new Win32Exception(Marshal.GetLastWin32Error());
        } catch {CloseDesktop(handle);handle=IntPtr.Zero;throw;}
    }
    public IntPtr[] Windows() {var values=new List<IntPtr>();EnumDesktopWindows(handle,(window,p)=>{if(IsWindowVisible(window))values.Add(window);return true;},IntPtr.Zero);return values.ToArray();}
    public static IntPtr[] Children(IntPtr window) {var values=new List<IntPtr>();EnumChildWindows(window,(child,p)=>{if(IsWindowVisible(child))values.Add(child);return true;},IntPtr.Zero);return values.ToArray();}
    public uint[] WindowProcessIds() {var values=new HashSet<uint>();foreach(IntPtr window in Windows()){uint owner;GetWindowThreadProcessId(window,out owner);if(owner!=0)values.Add(owner);}var result=new uint[values.Count];values.CopyTo(result);return result;}
    public static string ClassName(IntPtr window) {var value=new StringBuilder(256);GetClassNameW(window,value,value.Capacity);return value.ToString();}
    public static string Text(IntPtr window) {var value=new StringBuilder(8192);UIntPtr result;ReadMessage(window,0x0d,new UIntPtr((uint)value.Capacity),value,2,1000,out result);return value.ToString();}
    public static void SetText(IntPtr window,string value) {UIntPtr result;if(WriteMessage(window,0x0c,UIntPtr.Zero,value,2,1000,out result)==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());}
    public static void Click(IntPtr control) {if(control==IntPtr.Zero)return;UIntPtr result;ButtonMessage(control,0xf5,IntPtr.Zero,IntPtr.Zero,2,1000,out result);}
    public bool Exited {get{return WaitForSingleObject(process.process,0)!=258;}}
    public static void Screenshot(IntPtr window,string file) {
        Rect rect;if(!GetWindowRect(window,out rect))throw new Win32Exception();int width=rect.right-rect.left,height=rect.bottom-rect.top;
        if(width<100||height<100||width>4096||height>4096)throw new Exception("Invalid installer window bounds");
        IntPtr original=GetWindowDC(window),memory=CreateCompatibleDC(original),bitmap=CreateCompatibleBitmap(original,width,height),prior=SelectObject(memory,bitmap);
        try {
            if(!PrintWindow(window,memory,2))throw new Exception("Private installer window capture failed");
            SelectObject(memory,prior);prior=IntPtr.Zero;
            int stride=((width*3+3)/4)*4;var pixels=new byte[stride*height];var info=new BitmapInfo {size=40,width=width,height=height,planes=1,bits=24,imageSize=(uint)pixels.Length};
            if(GetDIBits(memory,bitmap,0,(uint)height,pixels,ref info,0)!=height)throw new Exception("Installer bitmap capture incomplete");
            byte first=pixels[0];bool varied=false;foreach(byte value in pixels)if(value!=first){varied=true;break;}if(!varied)throw new Exception("Installer capture is blank");
            using(var output=new BinaryWriter(File.Create(file))) {
                output.Write((ushort)0x4d42);output.Write(54+pixels.Length);output.Write(0);output.Write(54);
                output.Write(40);output.Write(width);output.Write(height);output.Write((ushort)1);output.Write((ushort)24);output.Write(0);output.Write(pixels.Length);
                output.Write(0);output.Write(0);output.Write(0);output.Write(0);output.Write(pixels);
            }
        } finally {if(prior!=IntPtr.Zero)SelectObject(memory,prior);DeleteObject(bitmap);DeleteDC(memory);ReleaseDC(window,original);}
    }
    public void Dispose() {
        // A NSIS bootstrap may create another GUI process. Only processes with
        // windows on this newly created private desktop belong to the probe.
        foreach(uint owner in WindowProcessIds())if(owner!=process.processId){IntPtr child=OpenProcess(0x100001,false,owner);if(child!=IntPtr.Zero){try{TerminateProcess(child,1);WaitForSingleObject(child,1000);}finally{CloseHandle(child);}}}
        if(process.process!=IntPtr.Zero){if(!Exited)TerminateProcess(process.process,1);CloseHandle(process.process);CloseHandle(process.thread);process.process=IntPtr.Zero;}
        if(handle!=IntPtr.Zero){DesktopClosed=CloseDesktop(handle);handle=IntPtr.Zero;}
    }
}
