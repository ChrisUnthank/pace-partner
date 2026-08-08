import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Two genuinely different questions this file answers, kept separate on
// purpose because they drive different decisions:
//
//   isMobileViewport — is the screen narrow. Already covered elsewhere
//     (src/hooks/use-mobile.tsx, Tailwind's md: breakpoint) for pure layout
//     reflow. Re-exported here only for convenience so callers reasoning
//     about "app mode" don't need two imports.
//
//   isStandalone — is this browser tab actually the installed home-screen
//     app. A wide iPad running the installed PWA should get standalone
//     treatment (safe-area insets, no browser chrome to rely on) even
//     though its viewport isn't "mobile" by width. Conversely, someone on
//     a narrow phone browser tab (not installed) should NOT get
//     standalone-only treatment like safe-area padding for a notch the
//     browser itself is already drawing chrome around.
//
// isAppMode is the combination this codebase actually wants for "should
// this render the stripped-back, app-like experience" — mobile viewport OR
// installed standalone, either one is enough.
// ---------------------------------------------------------------------------

function readStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari doesn't support the standard media query at all — it exposes
  // its own non-standard navigator flag instead. Chrome/Edge/Android support
  // the media query and don't set the iOS flag, so checking both covers
  // every real installed case without a UA-string guess.
  const standardMatch = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  const iosStandalone = (window.navigator as any).standalone === true;
  return standardMatch || iosStandalone;
}

export function useIsStandalone(): boolean {
  const [standalone, setStandalone] = useState(readStandalone);

  useEffect(() => {
    const mql = window.matchMedia("(display-mode: standalone)");
    const onChange = () => setStandalone(readStandalone());
    // Older Safari only supports addListener/removeListener; both are kept
    // for the same reason readStandalone() checks navigator.standalone —
    // this needs to work correctly specifically on the browser most likely
    // to be a few years behind the spec.
    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else if ((mql as any).addListener) (mql as any).addListener(onChange);
    onChange();
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", onChange);
      else if ((mql as any).removeListener) (mql as any).removeListener(onChange);
    };
  }, []);

  return standalone;
}

const MOBILE_BREAKPOINT = 768; // matches src/hooks/use-mobile.tsx

export function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT,
  );
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

export function useIsIOS(): boolean {
  const [ios, setIos] = useState(false);
  useEffect(() => {
    const ua = window.navigator.userAgent;
    // Modern iPadOS reports as "Macintosh" with touch support — the
    // maxTouchPoints check is what actually catches an iPad in desktop-UA
    // mode; without it every iPad running the install-prompt logic would
    // silently get the "not iOS" (i.e. real beforeinstallprompt) branch,
    // which iPadOS Safari doesn't support either.
    const iPadOS = ua.includes("Macintosh") && navigator.maxTouchPoints > 1;
    setIos(/iPhone|iPad|iPod/.test(ua) || iPadOS);
  }, []);
  return ios;
}

/** The one flag most components actually want: render the stripped-back,
 *  app-like experience. */
export function useAppMode(): { isAppMode: boolean; isStandalone: boolean; isMobileViewport: boolean } {
  const isStandalone = useIsStandalone();
  const isMobileViewport = useIsMobileViewport();
  return { isAppMode: isStandalone || isMobileViewport, isStandalone, isMobileViewport };
}
