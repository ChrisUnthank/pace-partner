// ---------------------------------------------------------------------------
// Shared service-worker registration gate.
//
// Extracted from notification-bell.tsx, which previously defined its own
// copy of this logic purely to guard push-notification registration. The
// PWA install layer (src/lib/pwa-install.tsx) now ALSO needs to register the
// same worker — for installability and the offline fallback, independently
// of whether push permission has been granted — so this had to become a
// single shared source of truth. Two independent copies of "should we
// register" is exactly the kind of thing that quietly drifts: one gets
// tightened after an incident, the other doesn't, and now the SW is live in
// a context somebody explicitly excluded it from.
//
// THE GATE, AND WHY EACH PART OF IT EXISTS:
//   - PROD only — a dev-server service worker is a classic footgun (stale
//     module caching across hot-reloads).
//   - Top frame only (window.self === window.top) — Lovable's own editor
//     renders the live app inside an iframe for the in-editor preview; a
//     service worker registering itself inside that iframe is a scope
//     nobody wants persisting.
//   - Never on a Lovable preview hostname — same reasoning, belt and
//     braces, for preview URLs opened directly rather than iframed.
//   - `?sw=off` — manual escape hatch for debugging.
// ---------------------------------------------------------------------------

const SW_PATH = "/sw.js";

export function isLovablePreviewHost(host: string): boolean {
  return (
    host.startsWith("id-preview--") ||
    host.startsWith("preview--") ||
    host === "lovableproject.com" ||
    host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" ||
    host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" ||
    host.endsWith(".beta.lovable.dev")
  );
}

export function shouldRegisterServiceWorker(): boolean {
  if (typeof window === "undefined") return false;
  if (!import.meta.env.PROD) return false;
  try {
    if (window.self !== window.top) return false;
  } catch {
    return false;
  }
  if (new URL(window.location.href).searchParams.get("sw") === "off") return false;
  if (isLovablePreviewHost(window.location.hostname)) return false;
  return true;
}

/**
 * Idempotent — safe to call from multiple places (push setup, install-prompt
 * setup) without racing. The browser itself de-duplicates a repeat
 * `register()` call against the same URL+scope; this just adds the app's own
 * gate on top and swallows registration failures rather than throwing, since
 * neither caller treats "no service worker" as fatal.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!shouldRegisterServiceWorker()) return null;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SW_PATH);
  } catch (e) {
    console.warn("Service worker registration failed", e);
    return null;
  }
}

export async function unregisterServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) {
      const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "";
      if (url.endsWith(SW_PATH)) await r.unregister();
    }
  } catch {
    /* best-effort cleanup, nothing meaningful to surface if it fails */
  }
}
