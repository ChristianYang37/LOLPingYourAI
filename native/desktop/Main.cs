using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Diagnostics;
using System.IO;
using System.Threading;

class DesktopHelper {
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct GuiInfo { public uint size, flags; public IntPtr active, focus, capture, menu, move, caret; public Rect caretRect; }
    [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public InputUnion data; }
    [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public Keyboard keyboard; [FieldOffset(0)] public Mouse mouse; }
    [StructLayout(LayoutKind.Sequential)] struct Keyboard { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct Mouse { public int dx, dy; public uint mouseData, flags, time; public UIntPtr extra; }
    delegate bool EnumProc(IntPtr h, IntPtr p);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect r);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point p);
    [DllImport("user32.dll")] static extern bool MoveWindow(IntPtr h, int x, int y, int width, int height, bool repaint);
    [DllImport("user32.dll")] static extern uint SendInput(uint count, Input[] input, int size);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GuiInfo info);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetProp(IntPtr h, string name);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool SetProp(IntPtr h, string name, IntPtr value);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
    const string IdentityProperty = "LOLPingYourAI.WindowIdentity.v1";
    static string Birth(uint pid) {
        // Process.GetProcessById in .NET Framework enumerates process information;
        // doing that per stroke is expensive on systems with many processes.
        var process=OpenProcess(0x1000,false,pid);
        if(process==IntPtr.Zero)throw new Exception("Cannot inspect target process identity");
        try {
            long created,exited,kernel,user;
            if(!GetProcessTimes(process,out created,out exited,out kernel,out user))throw new Exception("Cannot read target process creation time");
            return DateTime.FromFileTimeUtc(created).Ticks.ToString();
        } finally { CloseHandle(process); }
    }
    static bool DesktopAvailable() { var d=OpenInputDesktop(0,false,0x0100); if(d==IntPtr.Zero)return false; CloseDesktop(d); return true; }
    static void Cancel(Dictionary<string,object> args) { if(S(args,"cancelFile")!="" && File.Exists(S(args,"cancelFile"))) throw new Exception("Desktop action cancelled"); }
    static Rect Validate(IntPtr h, Dictionary<string,object> args, bool foreground) {
        Cancel(args);
        if(!DesktopAvailable())throw new Exception("Input desktop unavailable or locked");
        uint pid; GetWindowThreadProcessId(h,out pid); Rect r;
        if(pid!=(uint)N(args,"pid") || !IsWindowVisible(h) || !GetWindowRect(h,out r))throw new Exception("Target window closed or changed");
        if(S(args,"processStartedAt")=="" || Birth(pid)!=S(args,"processStartedAt"))throw new Exception("Target process restarted; select the window again");
        if(S(args,"windowToken")=="" || GetProp(h,IdentityProperty).ToInt64().ToString()!=S(args,"windowToken"))throw new Exception("Target window closed or changed; select the window again");
        if(!IsWindowEnabled(h))throw new Exception("Target window is disabled by a modal dialog");
        if(args.ContainsKey("expectedBounds")) {
            var b=(Dictionary<string,object>)args["expectedBounds"];
            if(r.Left!=N(b,"x") || r.Top!=N(b,"y") || r.Right-r.Left!=N(b,"width") || r.Bottom-r.Top!=N(b,"height"))throw new Exception("Window moved. Take a fresh screenshot before acting.");
        }
        if(foreground && GetForegroundWindow()!=h)throw new Exception("Target lost foreground control");
        return r;
    }
    static IntPtr Focus(IntPtr h) {
        uint pid; uint thread=GetWindowThreadProcessId(h,out pid);
        var info=new GuiInfo{size=(uint)Marshal.SizeOf(typeof(GuiInfo))};
        if(!GetGUIThreadInfo(thread,ref info) || info.focus==IntPtr.Zero || GetAncestor(info.focus,2)!=h)throw new Exception("Target input focus unavailable");
        return info.focus;
    }
    static JavaScriptSerializer json = new JavaScriptSerializer();
    static double N(Dictionary<string,object> d, string key) { return d.ContainsKey(key) ? Convert.ToDouble(d[key]) : 0; }
    static string S(Dictionary<string,object> d, string key) { return d.ContainsKey(key) ? Convert.ToString(d[key]) : ""; }
    static Dictionary<string,object> Bounds(Rect r) { return new Dictionary<string,object>{{"x",r.Left},{"y",r.Top},{"width",r.Right-r.Left},{"height",r.Bottom-r.Top}}; }
    static List<Dictionary<string,object>> Windows(int exclude) {
        var result = new List<Dictionary<string,object>>();
        EnumWindows((h,p) => { uint pid; GetWindowThreadProcessId(h,out pid); Rect r; var title=new StringBuilder(1024); GetWindowText(h,title,1024);
            if(pid!=(uint)exclude && IsWindowVisible(h) && title.Length>0 && GetWindowRect(h,out r) && r.Right>r.Left && r.Bottom>r.Top) {
                string app=""; try { app=System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch {}
                string birth=""; try { birth=Birth(pid); } catch {}
                result.Add(new Dictionary<string,object>{{"id",h.ToInt64().ToString()},{"pid",pid},{"processStartedAt",birth},{"windowToken",GetProp(h,IdentityProperty).ToInt64().ToString()},{"app",app},{"title",title.ToString()},{"bounds",Bounds(r)}});
            } return true; },IntPtr.Zero); return result;
    }
    static void Send(Input input) { if(SendInput(1,new[]{input},Marshal.SizeOf(typeof(Input)))!=1) throw new Exception("Input was rejected; target may require elevated privileges"); }
    static void Key(ushort vk, ushort scan, uint flags) { Send(new Input{type=1,data=new InputUnion{keyboard=new Keyboard{vk=vk,scan=scan,flags=flags}}}); }
    static void Stroke(ushort vk, ushort scan, uint flags) { try { Key(vk,scan,flags); } finally { Key(vk,scan,flags|2); } }
    static void Main(string[] argv) {
        try {
            Console.InputEncoding=new UTF8Encoding(false); Console.OutputEncoding=new UTF8Encoding(false);
            try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch {}
            var args=json.Deserialize<Dictionary<string,object>>(Console.In.ReadToEnd()) ?? new Dictionary<string,object>();
            string op=argv.Length>0?argv[0]:"doctor"; object result=new {ok=true};
            var desk=OpenInputDesktop(0,false,0x0100); bool locked=desk==IntPtr.Zero; if(!locked)CloseDesktop(desk);
            if(op=="doctor") result=new {accessibility=!locked,screenRecording=!locked,locked=locked,platform="win32",inputDesktopAvailable=!locked,captureVerified=false,inputVerified=false,diagnostic="Desktop availability only; capture and target input are checked per operation"};
            else if(op=="cursor") { Point p; if(!GetCursorPos(out p))throw new Exception("Cannot read cursor position");result=new{x=p.X,y=p.Y}; }
            else {
                var windows=Windows((int)N(args,"excludePid"));
                if(op=="windows") result=windows;
                else {
                    if(locked)throw new Exception("Desktop is locked");
                    Dictionary<string,object> target=null;
                    foreach(var w in windows) { var b=(Dictionary<string,object>)w["bounds"];
                        if(op=="target" ? N(args,"x")>=N(b,"x") && N(args,"x")<N(b,"x")+N(b,"width") && N(args,"y")>=N(b,"y") && N(args,"y")<N(b,"y")+N(b,"height") : S(w,"id")==S(args,"id") && N(w,"pid")==N(args,"pid")) { target=w;break; }
                    }
                    if(target==null)throw new Exception("Target window closed or changed");
                    var h=new IntPtr(long.Parse(S(target,"id")));
                    if(op=="target" || op=="identify") {
                        if(S(target,"processStartedAt")=="")throw new Exception("Cannot inspect target process identity");
                        if(GetProp(h,IdentityProperty)==IntPtr.Zero) {
                            int token; using(var rng=System.Security.Cryptography.RandomNumberGenerator.Create()) { var bytes=new byte[4]; rng.GetBytes(bytes); token=BitConverter.ToInt32(bytes,0)&0x7fffffff; }
                            if(!SetProp(h,IdentityProperty,new IntPtr(token==0?1:token)))throw new Exception("Cannot track target window; it may require elevated privileges");
                        }
                        target["windowToken"]=GetProp(h,IdentityProperty).ToInt64().ToString(); result=target;
                    }
                    else if(op=="resolve") { Validate(h,args,false); result=target; }
                    else {
                        Validate(h,args,false); SetForegroundWindow(h);
                        for(int i=0;i<25 && GetForegroundWindow()!=h;i++) { Cancel(args); Thread.Sleep(20); }
                        if(GetForegroundWindow()!=h)throw new Exception("Windows did not grant foreground control");
                        var original=Validate(h,args,true);
                        if(op=="resize") {
                            var b=(Dictionary<string,object>)args["bounds"];
                            if(N(b,"width")<1 || N(b,"height")<1)throw new Exception("Invalid window bounds");
                            if(!MoveWindow(h,(int)N(b,"x"),(int)N(b,"y"),(int)N(b,"width"),(int)N(b,"height"),true))throw new Exception("Cannot resize window");
                            Rect actual;
                            if(!GetWindowRect(h,out actual))throw new Exception("Cannot read resized window bounds");
                            bool constrained=actual.Left!=N(b,"x") || actual.Top!=N(b,"y") || actual.Right-actual.Left!=N(b,"width") || actual.Bottom-actual.Top!=N(b,"height");
                            if(constrained) {
                                bool rolledBack=MoveWindow(h,original.Left,original.Top,original.Right-original.Left,original.Bottom-original.Top,true);
                                Rect restored; rolledBack=rolledBack && GetWindowRect(h,out restored) && restored.Left==original.Left && restored.Top==original.Top && restored.Right==original.Right && restored.Bottom==original.Bottom;
                                throw new Exception("Window constrained requested size; rollback "+(rolledBack?"verified":"failed"));
                            }
                            result=new{ok=true,requested=b,actual=Bounds(actual),constrained=false};
                        }
                        else if(op=="click" || op=="scroll") {
                            var b=(Dictionary<string,object>)target["bounds"]; int x=(int)N(args,"x"),y=(int)N(args,"y");
                            if(x<N(b,"x") || x>=N(b,"x")+N(b,"width") || y<N(b,"y") || y>=N(b,"y")+N(b,"height"))throw new Exception("Point outside target");
                            Validate(h,args,true);
                            if(GetAncestor(WindowFromPoint(new Point{X=x,Y=y}),2)!=h)throw new Exception("Point is obscured by another window");
                            if(!SetCursorPos(x,y))throw new Exception("Cannot move cursor");
                            Validate(h,args,true);
                            if(GetAncestor(WindowFromPoint(new Point{X=x,Y=y}),2)!=h)throw new Exception("Point is obscured by another window");
                            if(op=="scroll")Send(new Input{type=0,data=new InputUnion{mouse=new Mouse{flags=0x800,mouseData=unchecked((uint)(int)N(args,"delta"))}}});
                            else { bool right=S(args,"button")=="right"; try { Send(new Input{type=0,data=new InputUnion{mouse=new Mouse{flags=right?8u:2u}}}); } finally { Send(new Input{type=0,data=new InputUnion{mouse=new Mouse{flags=right?16u:4u}}}); } }
                        } else if(op=="type") {
                            string text=S(args,"text");if(text.Length>10000)throw new Exception("Text too long"); var focus=Focus(h);
                            // SendInput queues Unicode globally and can deliver queued characters
                            // to a different window after focus theft. WM_CHAR is bound to the
                            // verified control and synchronous, so there is no global text backlog.
                            // Controls that do not support standard Unicode text must be verified
                            // by readback; never fall back to unscoped global input.
                            // WM_CHAR expects carriage returns. Collapse CRLF to one line break.
                            foreach(char c in text.Replace("\r\n","\n").Replace('\n','\r')) {
                                Validate(h,args,true); if(Focus(h)!=focus)throw new Exception("Target input focus changed");
                                // No timeout: a timed-out WndProc can still apply the character.
                                // A hung control must keep cancellation unconfirmed until it returns.
                                if(c=='\r') {
                                    // Chromium handles Enter on keydown; native edit controls use
                                    // WM_CHAR. Both messages stay bound to this same control.
                                    try {
                                        SendMessage(focus,0x0100,new UIntPtr(13),new IntPtr(0x001c0001));
                                        Validate(h,args,true); if(Focus(h)!=focus)throw new Exception("Target input focus changed");
                                        SendMessage(focus,0x0102,new UIntPtr(c),new IntPtr(1));
                                    } finally { SendMessage(focus,0x0101,new UIntPtr(13),new IntPtr(unchecked((int)0xc01c0001))); }
                                } else SendMessage(focus,0x0102,new UIntPtr(c),new IntPtr(1));
                            }
                        }
                        else if(op=="key") {
                            string[] parts=S(args,"key").ToLowerInvariant().Split('+'); var held=new List<ushort>();
                            var keys=new Dictionary<string,ushort>{{"return",13},{"escape",27},{"tab",9},{"backspace",8},{"left",37},{"right",39},{"up",38},{"down",40},{"plus",187},{"=",187},{"-",189},{"0",48}};
                            string last=parts[parts.Length-1];ushort code;
                            if(keys.ContainsKey(last))code=keys[last];else if(last.Length==1 && last[0]>='a' && last[0]<='z')code=(ushort)Char.ToUpperInvariant(last[0]);else throw new Exception("Unsupported key");
                            var focus=Focus(h);
                            try { for(int i=0;i<parts.Length-1;i++){ Validate(h,args,true); ushort mod=parts[i]=="ctrl"||parts[i]=="cmd"? (ushort)17:parts[i]=="shift"?(ushort)16:parts[i]=="alt"?(ushort)18:parts[i]=="super"?(ushort)91:(ushort)0;if(mod==0)throw new Exception("Unknown modifier");held.Add(mod);Key(mod,0,0); }Validate(h,args,true);if(Focus(h)!=focus)throw new Exception("Target input focus changed");Stroke(code,0,0); }
                            finally { held.Reverse();Exception releaseError=null;foreach(ushort mod in held)try{Key(mod,0,2);}catch(Exception e){releaseError=e;}if(releaseError!=null)throw releaseError; }
                        } else throw new Exception("Unknown desktop operation");
                    }
                }
            }
            Console.WriteLine(json.Serialize(result));
        } catch(Exception e) { Console.WriteLine(json.Serialize(new {error=e.Message}));Environment.Exit(1); }
    }
}
