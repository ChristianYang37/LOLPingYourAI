// Disposable native windows. This is a test target, never shipped in the app.
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;

class Fixture {
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(uint pid);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    static JavaScriptSerializer json=new JavaScriptSerializer();
    static Form[] windows=new Form[2]; static TextBox[] notes=new TextBox[2];
    static int stealAfter; static Form cover;
    static void Print(object value) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); }
    static void Make(int i) {
        var f=new Form{Text="LOLPing Windows disposable fixture",StartPosition=FormStartPosition.Manual,Bounds=new Rectangle(120,120,560,360),MinimumSize=new Size(300,200)};
        var t=new TextBox{Multiline=true,Dock=DockStyle.Fill,MaxLength=20000}; f.Controls.Add(t);
        // .NET Framework multiline TextBox does not implement Ctrl+A by default.
        t.KeyDown+=(s,e)=> { if(e.Control && e.KeyCode==System.Windows.Forms.Keys.A) { t.SelectAll(); e.SuppressKeyPress=true; } };
        windows[i]=f; notes[i]=t;
        t.TextChanged+=(s,e)=> { Print(new{input=i,length=t.Text.Length}); if(i==0 && stealAfter>0 && t.Text.Length>=stealAfter) { stealAfter=0; windows[1].Activate(); notes[1].Focus(); SetForegroundWindow(windows[1].Handle); } };
        f.Show();
    }
    static object State() { return new {pid=System.Diagnostics.Process.GetCurrentProcess().Id,ids=new[]{windows[0].Handle.ToInt64().ToString(),windows[1].Handle.ToInt64().ToString()},values=new[]{notes[0].Text,notes[1].Text},held=new[]{17,18,16,1,2}.SelectHeld()}; }
    [STAThread] static void Main() {
        Console.InputEncoding=new System.Text.UTF8Encoding(false); Console.OutputEncoding=new System.Text.UTF8Encoding(false);
        SetProcessDpiAwarenessContext(new IntPtr(-4)); Make(0); Make(1); Print(new{ready=State()});
        var ui=windows[1];
        var reader=new Thread(()=> {
            string line; while((line=Console.ReadLine())!=null) {
                var d=json.Deserialize<System.Collections.Generic.Dictionary<string,object>>(line);
                ui.Invoke((Action)(()=> {
                    try {
                        string op=Convert.ToString(d["op"]); int i=d.ContainsKey("index")?Convert.ToInt32(d["index"]):0;
                        if(op=="focus") { windows[i].Activate(); notes[i].Focus(); SetForegroundWindow(windows[i].Handle); AllowSetForegroundWindow(0xffffffff); }
                        if(op=="clear") { notes[0].Clear(); notes[1].Clear(); }
                        if(op=="move") windows[i].Left+=40;
                        if(op=="steal") stealAfter=10;
                        if(op=="recreate") { windows[0].Close(); Make(0); }
                        if(op=="cover") { cover=new Form{Text="LOLPing fixture obstruction",Bounds=windows[0].Bounds,StartPosition=FormStartPosition.Manual,TopMost=true,ShowInTaskbar=false}; cover.Show(); }
                        if(op=="uncover") { cover.Close(); cover=null; }
                        if(op=="disable") windows[0].Enabled=false;
                        if(op=="enable") windows[0].Enabled=true;
                        if(op=="quit") { Print(new{reply=true}); Application.Exit(); return; }
                        Print(new{reply=State()});
                    } catch(Exception e) { Print(new{error=e.Message}); }
                }));
            }
            if(!ui.IsDisposed)ui.BeginInvoke((Action)(()=>Application.Exit()));
        }); reader.IsBackground=true; reader.Start(); Application.Run();
    }
    public static bool Held(int key) { return (GetAsyncKeyState(key)&0x8000)!=0; }
}
static class KeyStates { public static bool[] SelectHeld(this int[] keys) { return Array.ConvertAll(keys,Fixture.Held); } }
