import { useCallback, useEffect, useState } from 'react';

type InstallOutcome = 'accepted' | 'dismissed';

type BeforeInstallPromptEvent = Event & {
  readonly platforms: readonly string[];
  readonly userChoice: Promise<{ outcome: InstallOutcome; platform: string }>;
  prompt: () => Promise<void>;
};

const STANDALONE_MODES = ['standalone', 'fullscreen', 'window-controls-overlay'];

const isStandalone = () =>
  STANDALONE_MODES.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches) ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIos = () =>
  /iP(?:hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * Captures `beforeinstallprompt` so a screen can offer a real install.
 * iOS Safari never fires that event, so `needsManualInstall` is the fallback
 * branch: show Share -> Add to Home Screen.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setInstalled(true);
    };
    const media = window.matchMedia(`(display-mode: ${STANDALONE_MODES[0]})`);
    const onDisplayMode = () => setInstalled(isStandalone());
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    media.addEventListener('change', onDisplayMode);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      media.removeEventListener('change', onDisplayMode);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<InstallOutcome | null> => {
    if (!deferred) return null;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === 'accepted') setDeferred(null);
    return choice.outcome;
  }, [deferred]);

  return {
    canInstall: deferred !== null && !installed,
    promptInstall,
    installed,
    needsManualInstall: isIos() && !installed,
    platform: deferred?.platforms.join(', ') ?? (isIos() ? 'ios' : 'web'),
  };
}
