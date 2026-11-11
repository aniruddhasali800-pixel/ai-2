# Sizzle desktop launcher

The staff console (`/staff.html`) opened as its own window, with the flame on the taskbar and the
Start menu instead of a browser tab.

Windows draws a `.bat` or `.url` file with its own stock script icon, whatever the app looks like,
so the launcher has to be a real `.lnk` shortcut carrying an `.ico`. Both parts live here.

## Install it

```powershell
powershell -ExecutionPolicy Bypass -File tools\sizzle-launcher\install-launcher.ps1
```

That puts `Sizzle Operations OS.lnk` on the desktop, pointing at:

```
msedge --app="https://smart.restaurant.aniruddhasali.in/staff.html"
```

Edge is found through the `App Paths` registry keys, falling back to the usual install folders, and
Chrome is used when Edge isn't there. The icon is copied to `%LOCALAPPDATA%\Sizzle\Sizzle.ico`
first, so the shortcut keeps its picture if this repo is moved or deleted.

Options:

| Switch | Default | |
| --- | --- | --- |
| `-Url` | `https://smart.restaurant.aniruddhasali.in/staff.html` | what the window opens |
| `-Name` | `Sizzle Operations OS` | the label under the icon |
| `-RetireBat` | `Sizzle-Operations-OS-Launcher.bat` | a desktop file to move aside, not delete |

An existing launcher by that name is moved to `%LOCALAPPDATA%\Sizzle\retired-launchers\` rather than
removed, so nothing is lost.

## Rebuild the icon

```bash
node tools/sizzle-launcher/make-ico.mjs
```

Writes `Sizzle.ico` (16/24/32/48/64/128/256 px) from `frontend/scripts/sizzle-mark.mjs`, the same
source the web icons come from. Run `install-launcher.ps1` again afterwards to re-copy it, then sign
out and in if Explorer insists on the cached picture.

## Phone

Nothing to install: the same page carries `/manifest-staff.webmanifest`, so **Add to home screen**
in Chrome or Edge gives the phone the flame, the name *Sizzle Staff*, and the four jump lists
(Office / Floor / Kitchen / Counter).
