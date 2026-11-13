using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

static class Program
{
    static string root;
    static string url;
    static TcpListener listener;
    static Form form;
    static Label status;
    static Label sub;
    static ProgressBar bar;
    static Button btnOpen;
    static Button btnSave;
    static Button btnExit;
    static bool collectOk = true;
    static string collectErr = "";

    static readonly string[] Assets = new string[] {
        "index.html", "style.css", "rules.js", "app.js",
        "sample.js", "sample-new.js", "collect.ps1"
    };

    static readonly Color Bg = Color.FromArgb(11, 13, 17);
    static readonly Color Fg = Color.FromArgb(230, 237, 243);
    static readonly Color Dim = Color.FromArgb(139, 148, 158);
    static readonly Color Accent = Color.FromArgb(61, 220, 151);

    [STAThread]
    static void Main()
    {
        try
        {
            root = Path.Combine(Path.GetTempPath(), "kaiguang_" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(root);
            Extract();
            BuildUi();

            Thread t = new Thread(Work);
            t.IsBackground = true;
            t.Start();

            Application.Run(form);
            StopServer();
        }
        catch (Exception ex)
        {
            try { File.WriteAllText(Path.Combine(Path.GetTempPath(), "kaiguang-crash.log"), ex.ToString()); } catch { }
        }
    }

    static void Extract()
    {
        Assembly a = Assembly.GetExecutingAssembly();
        for (int i = 0; i < Assets.Length; i++)
        {
            using (Stream s = a.GetManifestResourceStream(Assets[i]))
            {
                if (s == null) continue;
                using (FileStream f = File.Create(Path.Combine(root, Assets[i])))
                {
                    s.CopyTo(f);
                }
            }
        }
    }

    static void BuildUi()
    {
        form = new Form();
        form.Text = "开机第一天";
        form.ClientSize = new Size(420, 186);
        form.FormBorderStyle = FormBorderStyle.FixedSingle;
        form.MaximizeBox = false;
        form.StartPosition = FormStartPosition.CenterScreen;
        form.BackColor = Bg;
        form.ForeColor = Fg;
        form.Font = new Font("Microsoft YaHei UI", 9F);

        Label title = new Label();
        title.Text = "开机第一天";
        title.Font = new Font("Microsoft YaHei UI", 15F, FontStyle.Bold);
        title.ForeColor = Accent;
        title.AutoSize = true;
        title.Location = new Point(24, 20);
        form.Controls.Add(title);

        Label tag = new Label();
        tag.Text = "新电脑开荒 · 先体检，再决定装什么";
        tag.ForeColor = Dim;
        tag.AutoSize = true;
        tag.Location = new Point(26, 56);
        form.Controls.Add(tag);

        status = new Label();
        status.Text = "正在读这台电脑的信息…";
        status.ForeColor = Fg;
        status.AutoSize = false;
        status.Size = new Size(372, 24);
        status.Location = new Point(26, 88);
        form.Controls.Add(status);

        sub = new Label();
        sub.Text = "只读采集，不会改任何设置。大约 20 秒。";
        sub.ForeColor = Dim;
        sub.AutoSize = false;
        sub.Size = new Size(372, 20);
        sub.Location = new Point(26, 112);
        form.Controls.Add(sub);

        bar = new ProgressBar();
        bar.Style = ProgressBarStyle.Marquee;
        bar.MarqueeAnimationSpeed = 30;
        bar.Size = new Size(372, 6);
        bar.Location = new Point(26, 138);
        form.Controls.Add(bar);

        btnOpen = MakeButton("再打开一次", 190, 152, 92, Accent, Color.Black);
        btnOpen.Visible = false;
        btnOpen.Click += delegate { OpenBrowser(); };
        form.Controls.Add(btnOpen);

        btnSave = MakeButton("存一份 html", 288, 152, 92, Color.FromArgb(32, 38, 47), Fg);
        btnSave.Visible = false;
        btnSave.Click += delegate { SaveStandalone(); };
        form.Controls.Add(btnSave);

        btnExit = MakeButton("退出", 26, 152, 76, Color.FromArgb(32, 38, 47), Fg);
        btnExit.Click += delegate { form.Close(); };
        form.Controls.Add(btnExit);

        form.FormClosing += delegate { StopServer(); };
    }

    static Button MakeButton(string text, int x, int y, int w, Color back, Color fore)
    {
        Button b = new Button();
        b.Text = text;
        b.Location = new Point(x, y);
        b.Size = new Size(w, 30);
        b.FlatStyle = FlatStyle.Flat;
        b.FlatAppearance.BorderSize = 0;
        b.BackColor = back;
        b.ForeColor = fore;
        b.Cursor = Cursors.Hand;
        return b;
    }

    static void Work()
    {
        collectOk = RunCollect();
        if (collectOk)
        {
            try { StartServer(); }
            catch (Exception ex) { collectOk = false; collectErr = "启动本地服务失败：" + ex.Message; }
        }
        Ui(delegate { AfterStart(); });
    }

    static void AfterStart()
    {
        bar.Visible = false;
        if (collectOk)
        {
            status.Text = "报告已经在浏览器里打开了";
            sub.Text = "这个窗口关掉，页面就打不开了。";
            btnOpen.Visible = true;
            btnSave.Visible = true;
            OpenBrowser();
        }
        else
        {
            status.Text = "采集没跑通";
            status.ForeColor = Color.FromArgb(255, 107, 107);
            string e = collectErr.Replace("\r", " ").Replace("\n", " ");
            sub.Text = e.Length > 90 ? e.Substring(0, 90) + "…" : e;
        }
    }

    static void Ui(MethodInvoker f)
    {
        try { if (form != null && form.IsHandleCreated) form.BeginInvoke(f); } catch { }
    }

    static bool RunCollect()
    {
        string ps1 = Path.Combine(root, "collect.ps1");
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo("powershell.exe",
                "-NoProfile -ExecutionPolicy Bypass -Command \"[Console]::OutputEncoding=[Text.Encoding]::UTF8; & '" + ps1 + "'\"");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            psi.WorkingDirectory = root;

            using (Process p = Process.Start(psi))
            {
                StringBuilder err = new StringBuilder();
                p.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e2) { if (e2.Data != null) err.AppendLine(e2.Data); };
                p.BeginErrorReadLine();
                p.StandardOutput.ReadToEnd();
                if (!p.WaitForExit(180000)) { try { p.Kill(); } catch { } collectErr = "采集超时（180 秒）。"; return false; }
                if (p.ExitCode != 0)
                {
                    collectErr = err.ToString().Trim();
                    if (collectErr.Length == 0) collectErr = "PowerShell 退出码 " + p.ExitCode;
                    return false;
                }
            }
            if (!File.Exists(Path.Combine(root, "report.json")))
            {
                collectErr = "没有生成 report.json。";
                return false;
            }
            return true;
        }
        catch (Exception ex)
        {
            collectErr = ex.Message;
            return false;
        }
    }

    static void StartServer()
    {
        int want = 0;
        string env = Environment.GetEnvironmentVariable("KG_PORT");
        if (env != null && env.Length > 0) int.TryParse(env, out want);

        listener = new TcpListener(IPAddress.Loopback, want);
        listener.Start();
        url = "http://127.0.0.1:" + ((IPEndPoint)listener.LocalEndpoint).Port + "/";

        Thread t = new Thread(ServeLoop);
        t.IsBackground = true;
        t.Start();
    }

    static void StopServer()
    {
        try { if (listener != null) listener.Stop(); } catch { }
        try { if (root != null && Directory.Exists(root)) Directory.Delete(root, true); } catch { }
    }

    static void ServeLoop()
    {
        while (true)
        {
            TcpClient c;
            try { c = listener.AcceptTcpClient(); }
            catch { return; }
            try { Handle(c); }
            catch { }
            finally { try { c.Close(); } catch { } }
        }
    }

    static void Handle(TcpClient c)
    {
        c.ReceiveTimeout = 4000;
        NetworkStream ns = c.GetStream();
        MemoryStream ms = new MemoryStream();
        byte[] buf = new byte[2048];
        while (ms.Length < 16384)
        {
            int n = ns.Read(buf, 0, buf.Length);
            if (n <= 0) break;
            ms.Write(buf, 0, n);
            if (Encoding.ASCII.GetString(ms.ToArray()).IndexOf("\r\n\r\n") >= 0) break;
        }
        string head = Encoding.ASCII.GetString(ms.ToArray());
        string path = "/";
        if (head.StartsWith("GET "))
        {
            int e = head.IndexOf(' ', 4);
            if (e > 4) path = head.Substring(4, e - 4);
        }
        int q = path.IndexOf('?');
        if (q >= 0) path = path.Substring(0, q);

        if (path == "/" || path == "/index.html")
        {
            string html = BuildStandalone();
            Send(ns, "200 OK", "text/html; charset=utf-8", Encoding.UTF8.GetBytes(html));
            return;
        }
        if (path == "/report.json")
        {
            string f = Path.Combine(root, "report.json");
            if (!File.Exists(f)) { Send(ns, "404 Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("no report")); return; }
            Send(ns, "200 OK", "application/json; charset=utf-8", File.ReadAllBytes(f));
            return;
        }

        string rel = path.TrimStart('/');
        string full = Path.GetFullPath(Path.Combine(root, rel));
        if (!full.StartsWith(root) || !File.Exists(full))
        {
            Send(ns, "404 Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("not found"));
            return;
        }
        Send(ns, "200 OK", Mime(Path.GetExtension(full)), File.ReadAllBytes(full));
    }

    static void Send(NetworkStream ns, string code, string type, byte[] body)
    {
        string h = "HTTP/1.1 " + code + "\r\nContent-Type: " + type +
                   "\r\nContent-Length: " + body.Length + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
        byte[] hb = Encoding.ASCII.GetBytes(h);
        ns.Write(hb, 0, hb.Length);
        ns.Write(body, 0, body.Length);
        ns.Flush();
    }

    static string Mime(string ext)
    {
        string e = ext.ToLowerInvariant();
        if (e == ".html") return "text/html; charset=utf-8";
        if (e == ".js") return "text/javascript; charset=utf-8";
        if (e == ".css") return "text/css; charset=utf-8";
        if (e == ".json") return "application/json; charset=utf-8";
        if (e == ".png") return "image/png";
        if (e == ".svg") return "image/svg+xml";
        return "application/octet-stream";
    }

    static string BuildStandalone()
    {
        string h = File.ReadAllText(Path.Combine(root, "index.html"), Encoding.UTF8);
        string css = File.ReadAllText(Path.Combine(root, "style.css"), Encoding.UTF8);
        string rules = File.ReadAllText(Path.Combine(root, "rules.js"), Encoding.UTF8);
        string app = File.ReadAllText(Path.Combine(root, "app.js"), Encoding.UTF8);
        string data = File.ReadAllText(Path.Combine(root, "report.json"), Encoding.UTF8).Trim();

        h = h.Replace("<link rel=\"stylesheet\" href=\"style.css\">", "<style>\n" + css + "\n</style>");
        h = h.Replace("<script src=\"rules.js\"></script>", "<script>\n" + rules + "\n</script>");
        h = h.Replace("<script src=\"sample.js\"></script>", "");
        h = h.Replace("<script src=\"sample-new.js\"></script>", "");
        h = h.Replace("<script src=\"app.js\"></script>",
            "<script>window.KG_AUTO=" + data + ";</script>\n<script>\n" + app + "\n</script>");
        h = h.Replace("<h2>把 report.json 拖进来</h2>", "<h2>这份报告已经装好数据了</h2>");
        return h;
    }

    static void SaveStandalone()
    {
        try
        {
            string desk = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
            string name = "我的电脑体检报告-" + DateTime.Now.ToString("yyyyMMdd-HHmm") + ".html";
            string path = Path.Combine(desk, name);
            File.WriteAllText(path, BuildStandalone(), new UTF8Encoding(true));
            Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
            sub.Text = "已存到桌面：" + name;
        }
        catch (Exception ex)
        {
            sub.Text = "保存失败：" + ex.Message;
        }
    }

    static void OpenBrowser()
    {
        if (url == null) return;
        if (Environment.GetEnvironmentVariable("KG_NOOPEN") == "1") return;
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }
}
