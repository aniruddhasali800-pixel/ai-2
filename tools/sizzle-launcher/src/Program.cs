using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Windows.Forms;
using Microsoft.Win32;

namespace SizzleLauncher
{
    static class Program
    {
        public const string DefaultLiveUrl = "https://smart.restaurant.aniruddhasali.in";
        public const string DefaultLocalUrl = "http://localhost:5173";

        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string targetUrl = DefaultLiveUrl;
            string specificPath = "/staff.html";
            bool directLaunch = false;
            bool silentInstall = false;

            // Parse command line arguments
            for (int i = 0; i < args.Length; i++)
            {
                string arg = args[i].ToLowerInvariant();
                if (arg == "--install" || arg == "-i")
                {
                    silentInstall = true;
                }
                else if (arg == "--app" || arg == "--staff" || arg == "-a")
                {
                    directLaunch = true;
                    specificPath = "/staff.html";
                }
                else if (arg == "--waiter" || arg == "--floor" || arg == "-w")
                {
                    directLaunch = true;
                    specificPath = "/floor";
                }
                else if (arg == "--kitchen" || arg == "--kds" || arg == "-k")
                {
                    directLaunch = true;
                    specificPath = "/kds";
                }
                else if (arg == "--pos" || arg == "--cashier" || arg == "-p")
                {
                    directLaunch = true;
                    specificPath = "/pos";
                }
                else if (arg == "--local" || arg == "-l")
                {
                    targetUrl = DefaultLocalUrl;
                }
                else if ((arg == "--url" || arg == "-u") && i + 1 < args.Length)
                {
                    targetUrl = args[++i];
                    specificPath = "";
                }
            }

            if (silentInstall)
            {
                InstallShortcuts(targetUrl);
                return;
            }

            if (directLaunch)
            {
                string full = CombineUrl(targetUrl, specificPath);
                LaunchBrowserApp(full);
                return;
            }

            Application.Run(new MainForm());
        }

        public static string CombineUrl(string baseUri, string path)
        {
            if (string.IsNullOrEmpty(path)) return baseUri;
            if (baseUri.EndsWith("/") && path.StartsWith("/"))
                return baseUri + path.Substring(1);
            if (!baseUri.EndsWith("/") && !path.StartsWith("/"))
                return baseUri + "/" + path;
            return baseUri + path;
        }

        public static string FindBrowserPath()
        {
            string[] browserExes = new string[] { "msedge.exe", "chrome.exe" };
            string[] registryRoots = new string[]
            {
                @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\",
                @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\"
            };

            foreach (string exe in browserExes)
            {
                foreach (string root in registryRoots)
                {
                    try
                    {
                        using (RegistryKey key = Registry.LocalMachine.OpenSubKey(root + exe))
                        {
                            if (key != null)
                            {
                                object val = key.GetValue("");
                                if (val != null && File.Exists(val.ToString()))
                                    return val.ToString();
                            }
                        }
                    }
                    catch { }

                    try
                    {
                        using (RegistryKey key = Registry.CurrentUser.OpenSubKey(root + exe))
                        {
                            if (key != null)
                            {
                                object val = key.GetValue("");
                                if (val != null && File.Exists(val.ToString()))
                                    return val.ToString();
                            }
                        }
                    }
                    catch { }
                }
            }

            // Fallback paths
            string progFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string progFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            string[] candidates = new string[]
            {
                Path.Combine(progFilesX86, @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(progFiles, @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(progFiles, @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(progFilesX86, @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(localAppData, @"Google\Chrome\Application\chrome.exe"),
            };

            foreach (string c in candidates)
            {
                if (File.Exists(c)) return c;
            }

            return null;
        }

        public static void LaunchBrowserApp(string url)
        {
            string browser = FindBrowserPath();
            if (!string.IsNullOrEmpty(browser))
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = browser,
                    Arguments = "--app=\"" + url + "\"",
                    UseShellExecute = false
                };
                Process.Start(psi);
            }
            else
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
        }

        public static void InstallShortcuts(string targetBaseUrl)
        {
            try
            {
                string appDataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Sizzle");
                if (!Directory.Exists(appDataDir)) Directory.CreateDirectory(appDataDir);

                string exePath = Application.ExecutablePath;
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");

                CreateShortcutFile(Path.Combine(desktop, "Sizzle Operations OS.lnk"), exePath, "--staff", "Sizzle Restaurant Management Platform");
                CreateShortcutFile(Path.Combine(desktop, "Sizzle Waiter Floor.lnk"), exePath, "--waiter", "Sizzle Waiter Floor Operations");
                CreateShortcutFile(Path.Combine(desktop, "Sizzle Kitchen KDS.lnk"), exePath, "--kitchen", "Sizzle Kitchen Display System");
                CreateShortcutFile(Path.Combine(desktop, "Sizzle Cashier POS.lnk"), exePath, "--pos", "Sizzle Cashier Point of Sale");

                if (Directory.Exists(startMenu))
                {
                    string sizzleMenuDir = Path.Combine(startMenu, "Sizzle");
                    if (!Directory.Exists(sizzleMenuDir)) Directory.CreateDirectory(sizzleMenuDir);
                    CreateShortcutFile(Path.Combine(sizzleMenuDir, "Sizzle Operations OS.lnk"), exePath, "--staff", "Sizzle Restaurant Management Platform");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("Shortcut creation note: " + ex.Message);
            }
        }

        private static void CreateShortcutFile(string shortcutPath, string targetPath, string arguments, string description)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            dynamic shell = Activator.CreateInstance(shellType);
            dynamic shortcut = shell.CreateShortcut(shortcutPath);
            shortcut.TargetPath = targetPath;
            shortcut.Arguments = arguments;
            shortcut.Description = description;
            shortcut.IconLocation = targetPath + ",0";
            shortcut.Save();
        }
    }

    public class MainForm : Form
    {
        private RadioButton rbLive;
        private RadioButton rbLocal;
        private RadioButton rbCustom;
        private TextBox txtCustomUrl;
        private Label lblServerStatus;
        private NotifyIcon trayIcon;
        private ContextMenuStrip trayMenu;

        public MainForm()
        {
            InitializeComponent();
            CheckLocalServerAsync();
        }

        private void InitializeComponent()
        {
            this.Text = "Sizzle — Restaurant Operations OS";
            this.Size = new Size(720, 620);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedSingle;
            this.MaximizeBox = false;
            this.BackColor = Color.FromArgb(15, 23, 42); // slate-900
            this.ForeColor = Color.White;

            try
            {
                this.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch { }

            // ─── Header ───
            Panel headerPanel = new Panel
            {
                Dock = DockStyle.Top,
                Height = 85,
                BackColor = Color.FromArgb(24, 34, 58),
                Padding = new Padding(24, 16, 24, 16)
            };

            Label lblTitle = new Label
            {
                Text = "🔥 SIZZLE OPERATIONS OS",
                Font = new Font("Segoe UI", 16F, FontStyle.Bold),
                ForeColor = Color.FromArgb(254, 215, 170), // orange-200
                AutoSize = true,
                Location = new Point(24, 14)
            };

            Label lblSubtitle = new Label
            {
                Text = "Restaurant Operations & Desktop Management Console",
                Font = new Font("Segoe UI", 9.5F, FontStyle.Regular),
                ForeColor = Color.FromArgb(148, 163, 184), // slate-400
                AutoSize = true,
                Location = new Point(26, 46)
            };

            headerPanel.Controls.Add(lblTitle);
            headerPanel.Controls.Add(lblSubtitle);
            this.Controls.Add(headerPanel);

            // ─── Environment Selection Panel ───
            GroupBox grpEnv = new GroupBox
            {
                Text = "  Connection Environment  ",
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                ForeColor = Color.FromArgb(226, 232, 240),
                Location = new Point(24, 98),
                Size = new Size(656, 82),
                BackColor = Color.FromArgb(30, 41, 59)
            };

            rbLive = new RadioButton
            {
                Text = "Cloud Production (smart.restaurant.aniruddhasali.in)",
                Font = new Font("Segoe UI", 9F, FontStyle.Regular),
                ForeColor = Color.FromArgb(241, 245, 249),
                Location = new Point(20, 22),
                Size = new Size(360, 24),
                Checked = true
            };

            rbLocal = new RadioButton
            {
                Text = "Local Machine (http://localhost:5173)",
                Font = new Font("Segoe UI", 9F, FontStyle.Regular),
                ForeColor = Color.FromArgb(241, 245, 249),
                Location = new Point(20, 48),
                Size = new Size(280, 24)
            };

            lblServerStatus = new Label
            {
                Text = "Checking local server...",
                Font = new Font("Segoe UI", 8.5F, FontStyle.Italic),
                ForeColor = Color.FromArgb(148, 163, 184),
                Location = new Point(380, 51),
                Size = new Size(260, 20),
                TextAlign = ContentAlignment.MiddleRight
            };

            grpEnv.Controls.Add(rbLive);
            grpEnv.Controls.Add(rbLocal);
            grpEnv.Controls.Add(lblServerStatus);
            this.Controls.Add(grpEnv);

            // ─── Operations Systems Grid ───
            Label lblGridTitle = new Label
            {
                Text = "LAUNCH OPERATIONAL DASHBOARDS",
                Font = new Font("Segoe UI", 10F, FontStyle.Bold),
                ForeColor = Color.FromArgb(203, 213, 225),
                Location = new Point(24, 192),
                AutoSize = true
            };
            this.Controls.Add(lblGridTitle);

            Panel gridPanel = new Panel
            {
                Location = new Point(24, 218),
                Size = new Size(656, 280),
                BackColor = Color.Transparent
            };

            // 4 Cards
            AddSystemCard(gridPanel, 0, 0, "🪑 Waiter System", "Floor plan, table seating, bill requests & calls", "/floor", Color.FromArgb(30, 58, 138), Color.FromArgb(59, 130, 246));
            AddSystemCard(gridPanel, 336, 0, "🍳 Kitchen KDS", "Cook's live rail, firing courses, prep tickets", "/kds", Color.FromArgb(120, 53, 15), Color.FromArgb(245, 158, 11));
            AddSystemCard(gridPanel, 0, 140, "💳 Cashier & POS", "Billing, payments, till drawer & settlements", "/pos", Color.FromArgb(6, 78, 59), Color.FromArgb(16, 185, 129));
            AddSystemCard(gridPanel, 336, 140, "🏢 Operations Hub", "Full staff console, back office & analytics", "/staff.html", Color.FromArgb(88, 28, 135), Color.FromArgb(168, 85, 247));

            this.Controls.Add(gridPanel);

            // ─── Bottom Actions ───
            Panel bottomPanel = new Panel
            {
                Dock = DockStyle.Bottom,
                Height = 65,
                BackColor = Color.FromArgb(24, 34, 58),
                Padding = new Padding(24, 12, 24, 12)
            };

            Button btnInstall = new Button
            {
                Text = "📌 Create Desktop Shortcuts",
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                BackColor = Color.FromArgb(51, 65, 85),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Size = new Size(200, 38),
                Location = new Point(24, 14),
                Cursor = Cursors.Hand
            };
            btnInstall.FlatAppearance.BorderColor = Color.FromArgb(100, 116, 139);
            btnInstall.Click += (s, e) =>
            {
                Program.InstallShortcuts(GetSelectedUrl());
                MessageBox.Show(this, "Desktop and Start Menu shortcuts created successfully!", "Sizzle Operations OS", MessageBoxButtons.OK, MessageBoxIcon.Information);
            };

            Button btnOpenMain = new Button
            {
                Text = "🚀 Launch Full Sizzle App Window",
                Font = new Font("Segoe UI", 9.5F, FontStyle.Bold),
                BackColor = Color.FromArgb(234, 88, 12), // orange-600
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Size = new Size(240, 38),
                Location = new Point(440, 14),
                Cursor = Cursors.Hand
            };
            btnOpenMain.FlatAppearance.BorderSize = 0;
            btnOpenMain.Click += (s, e) => LaunchSystem("/staff.html");

            bottomPanel.Controls.Add(btnInstall);
            bottomPanel.Controls.Add(btnOpenMain);
            this.Controls.Add(bottomPanel);

            // ─── System Tray Setup ───
            SetupTray();
        }

        private void AddSystemCard(Panel container, int x, int y, string title, string desc, string path, Color bgDark, Color accentColor)
        {
            Panel card = new Panel
            {
                Location = new Point(x, y),
                Size = new Size(320, 126),
                BackColor = Color.FromArgb(30, 41, 59),
                BorderStyle = BorderStyle.None
            };

            Panel accentBar = new Panel
            {
                Dock = DockStyle.Left,
                Width = 4,
                BackColor = accentColor
            };
            card.Controls.Add(accentBar);

            Label lblCardTitle = new Label
            {
                Text = title,
                Font = new Font("Segoe UI", 11F, FontStyle.Bold),
                ForeColor = Color.White,
                Location = new Point(14, 10),
                AutoSize = true
            };
            card.Controls.Add(lblCardTitle);

            Label lblCardDesc = new Label
            {
                Text = desc,
                Font = new Font("Segoe UI", 8.5F),
                ForeColor = Color.FromArgb(148, 163, 184),
                Location = new Point(14, 36),
                Size = new Size(292, 42)
            };
            card.Controls.Add(lblCardDesc);

            Button btnOpen = new Button
            {
                Text = "Open Window ↗",
                Font = new Font("Segoe UI", 8.5F, FontStyle.Bold),
                ForeColor = Color.White,
                BackColor = accentColor,
                FlatStyle = FlatStyle.Flat,
                Size = new Size(110, 28),
                Location = new Point(196, 88),
                Cursor = Cursors.Hand
            };
            btnOpen.FlatAppearance.BorderSize = 0;
            btnOpen.Click += (s, e) => LaunchSystem(path);
            card.Controls.Add(btnOpen);

            Label lblPath = new Label
            {
                Text = path,
                Font = new Font("Consolas", 8.5F),
                ForeColor = Color.FromArgb(100, 116, 139),
                Location = new Point(14, 93),
                AutoSize = true
            };
            card.Controls.Add(lblPath);

            container.Controls.Add(card);
        }

        private string GetSelectedUrl()
        {
            if (rbLocal.Checked) return Program.DefaultLocalUrl;
            return Program.DefaultLiveUrl;
        }

        private void LaunchSystem(string path)
        {
            string url = Program.CombineUrl(GetSelectedUrl(), path);
            Program.LaunchBrowserApp(url);
        }

        private async void CheckLocalServerAsync()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:4000/api/health");
                req.Timeout = 1500;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    if (resp.StatusCode == HttpStatusCode.OK)
                    {
                        lblServerStatus.Text = "● Local backend active (port 4000)";
                        lblServerStatus.ForeColor = Color.FromArgb(74, 222, 128); // green-400
                        rbLocal.Checked = true;
                    }
                }
            }
            catch
            {
                lblServerStatus.Text = "○ Local server offline (Cloud selected)";
                lblServerStatus.ForeColor = Color.FromArgb(148, 163, 184);
                rbLive.Checked = true;
            }
        }

        private void SetupTray()
        {
            trayMenu = new ContextMenuStrip();
            trayMenu.Items.Add("Open Sizzle Dashboard", null, (s, e) => { this.Show(); this.WindowState = FormWindowState.Normal; });
            trayMenu.Items.Add("-");
            trayMenu.Items.Add("🪑 Waiter Floor (/floor)", null, (s, e) => LaunchSystem("/floor"));
            trayMenu.Items.Add("🍳 Kitchen KDS (/kds)", null, (s, e) => LaunchSystem("/kds"));
            trayMenu.Items.Add("💳 Cashier POS (/pos)", null, (s, e) => LaunchSystem("/pos"));
            trayMenu.Items.Add("🏢 Staff Console (/staff.html)", null, (s, e) => LaunchSystem("/staff.html"));
            trayMenu.Items.Add("-");
            trayMenu.Items.Add("Exit", null, (s, e) => Application.Exit());

            trayIcon = new NotifyIcon
            {
                Text = "Sizzle Operations OS",
                ContextMenuStrip = trayMenu,
                Visible = true
            };

            try
            {
                trayIcon.Icon = this.Icon;
            }
            catch { }

            trayIcon.DoubleClick += (s, e) => { this.Show(); this.WindowState = FormWindowState.Normal; };
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                trayIcon.Visible = false;
                trayIcon.Dispose();
            }
            base.OnFormClosing(e);
        }
    }
}
