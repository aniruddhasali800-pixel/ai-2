<#
    Creates the desktop launcher for the staff side of Sizzle, with the brand icon on it.

    A .bat or .url file always wears whatever picture Windows has for scripts and links, so the only
    desktop item that can show the flame is a real shortcut pointing at an .ico. That shortcut opens
    Edge (or Chrome) in --app mode, which is a window with no address bar - the operations console
    behaves like an installed program.

    Run it:
        powershell -ExecutionPolicy Bypass -File tools\sizzle-launcher\install-launcher.ps1

    The icon is copied to %LOCALAPPDATA%\Sizzle first, so the shortcut still resolves if the repo
    folder moves or is deleted.
#>

param(
    [string]$Url = 'https://smart.restaurant.aniruddhasali.in/staff.html',
    [string]$Name = 'Sizzle Operations OS',
    [string]$RetireBat = 'Sizzle-Operations-OS-Launcher.bat'
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Join-Path $env:LOCALAPPDATA 'Sizzle'
$iconPath = Join-Path $appDir 'Sizzle.ico'

New-Item -ItemType Directory -Force -Path $appDir | Out-Null
Copy-Item -Force (Join-Path $here 'Sizzle.ico') $iconPath

function Find-Browser {
    # App Paths is where a browser registers itself, so this survives canary builds and custom dirs.
    foreach ($exe in 'msedge.exe', 'chrome.exe') {
        foreach ($root in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths') {
            $found = (Get-ItemProperty -Path (Join-Path $root $exe) -ErrorAction SilentlyContinue).'(default)'
            if ($found -and (Test-Path $found)) { return $found }
        }
    }
    foreach ($candidate in @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
    )) {
        if ($candidate -and (Test-Path $candidate)) { return $candidate }
    }
    return $null
}

$browser = Find-Browser
if (-not $browser) {
    Write-Error 'Neither Edge nor Chrome was found, so there is nothing to open the app in. Install one and run this again.'
}

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcut = Join-Path $desktop "$Name.lnk"

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
$link.TargetPath = $browser
# --app gives a bare window; the site's own manifest supplies the in-window icon and the name.
$link.Arguments = "--app=`"$Url`""
$link.IconLocation = "$iconPath,0"
$link.WorkingDirectory = Split-Path -Parent $browser
$link.Description = "Sizzle staff console - back office, floor, kitchen and counter. Opens in app mode at $Url"
$link.WindowStyle = 1
$link.Save()

# The old script launcher is replaced, not deleted: it moves aside where it can be restored.
$old = Join-Path $desktop $RetireBat
if (Test-Path $old) {
    $graveyard = Join-Path $appDir 'retired-launchers'
    New-Item -ItemType Directory -Force -Path $graveyard | Out-Null
    Move-Item -Force $old (Join-Path $graveyard $RetireBat)
    Write-Host "moved the old iconless launcher to $graveyard\$RetireBat"
}

# Explorer keeps a per-path icon cache; this nudges it to re-read the new shortcut.
$ie4uinit = Join-Path $env:SystemRoot 'System32\ie4uinit.exe'
if (Test-Path $ie4uinit) { Start-Process $ie4uinit -ArgumentList '-show' -WindowStyle Hidden -ErrorAction SilentlyContinue }

Write-Host "installed $shortcut"
Write-Host "  opens   $browser --app=$Url"
Write-Host "  icon    $iconPath"
