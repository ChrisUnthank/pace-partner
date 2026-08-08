import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { registerServiceWorker, shouldRegisterServiceWorker } from "@/lib/service-worker";
import { useIsIOS, useIsStandalone } from "@/lib/device";

// ---------------------------------------------------------------------------
// "Add to Home Screen" plumbing.
//
// Chrome/Edge/Android fire a real `beforeinstallprompt` event this app can
// capture and replay later from its own button — the standard flow. iOS
// Safari never fires that event and has no programmatic install API at all;
// the only way onto an iPhone home screen is the user manually tapping
// Share → Add to Home Screen. So this provider exposes ONE unified
// `canPromptInstall` + `promptInstall()` pair for the real flow, plus a
// separate `isIOS` flag the UI uses to swap in written instructions instead
// of a button that would do nothing.
//
// Registers the service worker on mount (independently of push permission —
// see src/lib/service-worker.ts for why that used to be push-only and why it
// isn't anymore). This is what actually makes the app installable in the
// first place on browsers that require an active SW for the install
// heuristic; harmless on browsers that don't.
// ---------------------------------------------------------------------------

const DISMISS_KEY = "strider:pwa-install-dismissed-at";
// Re-offer the banner after a cooldown rather than never again — someone who
// dismissed it on a bad day (mid-workout, no time) shouldn't lose the option
// permanently. Two weeks is long enough not to nag, short enough to catch
// someone who's since started using the app daily from a browser tab.
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PwaInstallContextValue {
  /** True once a real, capturable browser install prompt is available. */
  canPromptInstall: boolean;
  /** Fires the captured native prompt. Resolves true if the person accepted. */
  promptInstall: () => Promise<boolean>;
  /** No programmatic prompt exists on iOS — UI should show manual steps. */
  isIOS: boolean;
  /** Already running as the installed app — nothing to offer. */
  isStandalone: boolean;
  /** Whether it's currently sensible to show ANY install nudge at all —
   *  folds in standalone, cooldown, and platform capability so callers don't
   *  have to re-derive this themselves. */
  shouldOfferInstall: boolean;
  dismiss: () => void;
}

const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);

function readDismissedRecently(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < DISMISS_COOLDOWN_MS;
  } catch {
    return false;
  }
}

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const isStandalone = useIsStandalone();
  const isIOS = useIsIOS();
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [dismissedRecently, setDismissedRecently] = useState(readDismissedRecently);

  useEffect(() => {
    if (!shouldRegisterServiceWorker()) return;
    void registerServiceWorker();
  }, []);

  useEffect(() => {
    function onBeforeInstall(e: Event) {
      // Stops Chrome's own mini-infobar from appearing automatically — the
      // app controls exactly when and where the prompt surfaces instead
      // (the install card / banner below), consistent with every other
      // piece of chrome in this app being deliberately placed rather than
      // browser-default.
      e.preventDefault();
      setDeferred(e as InstallPromptEvent);
    }
    function onInstalled() {
      setDeferred(null);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // A captured beforeinstallprompt event can only be used once — spent
    // either way, accepted or dismissed, so it's cleared here regardless of
    // outcome rather than only on acceptance.
    setDeferred(null);
    return outcome === "accepted";
  }, [deferred]);

  const dismiss = useCallback(() => {
    setDismissedRecently(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode / quota — worst case the banner reappears next visit */
    }
  }, []);

  const canPromptInstall = !!deferred;
  const shouldOfferInstall = !isStandalone && !dismissedRecently && (canPromptInstall || isIOS);

  const value = useMemo<PwaInstallContextValue>(
    () => ({ canPromptInstall, promptInstall, isIOS, isStandalone, shouldOfferInstall, dismiss }),
    [canPromptInstall, promptInstall, isIOS, isStandalone, shouldOfferInstall, dismiss],
  );

  return <PwaInstallContext.Provider value={value}>{children}</PwaInstallContext.Provider>;
}

export function usePwaInstall(): PwaInstallContextValue {
  const ctx = useContext(PwaInstallContext);
  if (!ctx) throw new Error("usePwaInstall must be used within a PwaInstallProvider");
  return ctx;
}
