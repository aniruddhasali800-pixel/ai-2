/**
 * Generates desktop launcher shortcuts (.url and .bat) that run the application
 * in standalone app-window mode on desktop computers (Windows / Mac / Linux).
 */

export function downloadDesktopShortcut(title: string, urlPath: string) {
  const fullUrl = `${window.location.origin}${urlPath.startsWith('/') ? urlPath : `/${urlPath}`}`;
  
  // Windows .url Internet Shortcut
  const urlContent = `[InternetShortcut]\r\nURL=${fullUrl}\r\nIconFile=${window.location.origin}/favicon.ico\r\nIconIndex=0\r\n`;
  const blob = new Blob([urlContent], { type: 'application/internet-shortcut' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}.url`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

export function downloadWindowsAppLauncher(title: string, urlPath: string) {
  const fullUrl = `${window.location.origin}${urlPath.startsWith('/') ? urlPath : `/${urlPath}`}`;
  
  // Windows .bat file that opens the URL in dedicated standalone app-window mode
  const batContent = `@echo off\r\ntitle ${title}\r\necho Launching ${title} in standalone app mode...\r\nstart msedge --app="${fullUrl}" 2>nul || start chrome --app="${fullUrl}" 2>nul || start "" "${fullUrl}"\r\nexit\r\n`;
  const blob = new Blob([batContent], { type: 'application/x-bat' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}-Launcher.bat`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}
