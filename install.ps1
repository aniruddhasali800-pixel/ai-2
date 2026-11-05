# ═══════════════════════════════════════════════════════════════════════
#  🔥 Sizzle Restaurant Operations OS — Automated One-Click Installer
#  Downloads and installs Sizzle-Operations-OS.exe to your PC
# ═══════════════════════════════════════════════════════════════════════

param(
    [string]$BaseUrl = "https://smart.restaurant.aniruddhasali.in"
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Yellow
Write-Host "║     🔥 SIZZLE RESTAURANT OPERATIONS OS — INSTALLER          ║" -ForegroundColor Yellow
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Yellow
Write-Host ""

$installDir = Join-Path $env:LOCALAPPDATA "Sizzle"
if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

$targetExe = Join-Path $installDir "Sizzle-Operations-OS.exe"
$downloadUrl = "$BaseUrl/Sizzle-Operations-OS.exe"

# 1. Download or copy executable
Write-Host "▶ Downloading Sizzle-Operations-OS.exe..." -ForegroundColor Cyan

$copiedLocal = $false
# If running within or near the project folder, copy direct binary
$localCandidate = "D:\New folder (2)\Sizzle-Operations-OS.exe"
if (Test-Path $localCandidate) {
    Copy-Item -Path $localCandidate -Destination $targetExe -Force
    $copiedLocal = $true
}

if (-not $copiedLocal) {
    try {
        # Check if local dev server is responding first
        $localTest = "http://127.0.0.1:5173/Sizzle-Operations-OS.exe"
        $req = [System.Net.WebRequest]::Create($localTest)
        $req.Timeout = 1000
        $req.Method = "HEAD"
        $resp = $req.GetResponse()
        $resp.Close()
        $downloadUrl = $localTest
    } catch {
        # Default to cloud URL
    }

    Write-Host "  Source: $downloadUrl" -ForegroundColor Gray
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $downloadUrl -OutFile $targetExe -UseBasicParsing
}

Write-Host "  ✓ Executable installed at $targetExe" -ForegroundColor Green

# 2. Create Desktop & Start Menu Shortcuts
Write-Host "▶ Creating Desktop and Start Menu shortcuts..." -ForegroundColor Cyan

$desktop = [Environment]::GetFolderPath("DesktopDirectory")
$startMenu = Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs\Sizzle"
if (-not (Test-Path $startMenu)) {
    New-Item -ItemType Directory -Path $startMenu -Force | Out-Null
}

$desktopLink = Join-Path $desktop "Sizzle Operations OS.lnk"
$startMenuLink = Join-Path $startMenu "Sizzle Operations OS.lnk"

$shell = New-Object -ComObject WScript.Shell

# Desktop shortcut
$shortcut = $shell.CreateShortcut($desktopLink)
$shortcut.TargetPath = $targetExe
$shortcut.WorkingDirectory = $installDir
$shortcut.Description = "Sizzle Restaurant Operations OS (Floor, Kitchen, POS & Admin)"
$shortcut.IconLocation = "$targetExe,0"
$shortcut.Save()

# Start Menu shortcut
$shortcut2 = $shell.CreateShortcut($startMenuLink)
$shortcut2.TargetPath = $targetExe
$shortcut2.WorkingDirectory = $installDir
$shortcut2.Description = "Sizzle Restaurant Operations OS (Floor, Kitchen, POS & Admin)"
$shortcut2.IconLocation = "$targetExe,0"
$shortcut2.Save()

# Individual Console Shortcuts on Desktop
$waiterLink = Join-Path $desktop "Sizzle Waiter Floor.lnk"
$sWaiter = $shell.CreateShortcut($waiterLink)
$sWaiter.TargetPath = $targetExe
$sWaiter.Arguments = "--waiter"
$sWaiter.WorkingDirectory = $installDir
$sWaiter.Description = "Sizzle Waiter Floor Plan & Order Taking"
$sWaiter.IconLocation = "$targetExe,0"
$sWaiter.Save()

$kdsLink = Join-Path $desktop "Sizzle Kitchen KDS.lnk"
$sKds = $shell.CreateShortcut($kdsLink)
$sKds.TargetPath = $targetExe
$sKds.Arguments = "--kitchen"
$sKds.WorkingDirectory = $installDir
$sKds.Description = "Sizzle Kitchen Display System (KDS)"
$sKds.IconLocation = "$targetExe,0"
$sKds.Save()

$posLink = Join-Path $desktop "Sizzle Cashier POS.lnk"
$sPos = $shell.CreateShortcut($posLink)
$sPos.TargetPath = $targetExe
$sPos.Arguments = "--pos"
$sPos.WorkingDirectory = $installDir
$sPos.Description = "Sizzle Cashier POS & Billing Drawer"
$sPos.IconLocation = "$targetExe,0"
$sPos.Save()

Write-Host "  ✓ Desktop shortcuts created:" -ForegroundColor Green
Write-Host "    - Sizzle Operations OS.lnk" -ForegroundColor White
Write-Host "    - Sizzle Waiter Floor.lnk" -ForegroundColor White
Write-Host "    - Sizzle Kitchen KDS.lnk" -ForegroundColor White
Write-Host "    - Sizzle Cashier POS.lnk" -ForegroundColor White

# 3. Launch App
Write-Host ""
Write-Host "🚀 Launching Sizzle Operations OS..." -ForegroundColor Green
Start-Process -FilePath $targetExe

Write-Host ""
Write-Host "✅ Installation completed successfully! You can now operate all things from your desktop." -ForegroundColor Yellow
Write-Host ""
