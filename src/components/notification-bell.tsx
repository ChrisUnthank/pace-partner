import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Bell, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import {
  listMyNotifications, markNotificationRead, markAllNotificationsRead,
  subscribeToPush, getVapidPublicKey,
} from "@/lib/notifications.functions";
import { useAuthUser } from "@/lib/use-auth";
import { formatDistanceToNow } from "date-fns";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const b = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isLovablePreviewHost(host: string) {
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

function shouldRegisterServiceWorker() {
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

async function unregisterAppServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) {
      const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "";
      if (url.endsWith("/sw.js")) await r.unregister();
    }
  } catch {}
}

export function NotificationBell() {
  const list = useServerFn(listMyNotifications);
  const markOne = useServerFn(markNotificationRead);
  const markAll = useServerFn(markAllNotificationsRead);
  const sub = useServerFn(subscribeToPush);
  const vapid = useServerFn(getVapidPublicKey);
  const qc = useQueryClient();
  const { user } = useAuthUser();

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", user?.id],
    enabled: !!user,
    queryFn: () => list(),
    refetchInterval: 60_000,
  });

  const unread = notifications.filter((n: any) => !n.read_at).length;

  // Realtime: refresh on insert
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`notif-${user.id}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["notifications", user.id] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, qc]);

  // Auto-subscribe to web push when permission already granted
  useEffect(() => {
    if (!user || typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (!shouldRegisterServiceWorker()) {
      // Clean up any worker that was registered in preview previously.
      void unregisterAppServiceWorker();
      return;
    }
    if (Notification.permission !== "granted") return;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const { key } = await vapid();
        if (!key) return;
        const existing = await reg.pushManager.getSubscription();
        if (existing) return;
        const newSub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        });
        const json: any = newSub.toJSON();
        await sub({ data: {
          endpoint: json.endpoint,
          p256dh: json.keys?.p256dh,
          auth: json.keys?.auth,
          userAgent: navigator.userAgent,
        }});
      } catch (e) { console.warn("Push setup failed", e); }
    })();
  }, [user?.id]);

  const enablePush = async () => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (!shouldRegisterServiceWorker()) {
      console.warn("Push notifications are only available on the published site.");
      return;
    }
    await Notification.requestPermission();
  };

  const mAll = useMutation({
    mutationFn: () => markAll(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", user?.id] }),
  });
  const mOne = useMutation({
    mutationFn: (id: string) => markOne({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", user?.id] }),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="relative" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--accent-red)] text-[10px] font-bold text-white flex items-center justify-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-[480px] overflow-y-auto p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-popover">
          <span className="text-xs font-bold uppercase tracking-wider">Notifications</span>
          <div className="flex gap-1">
            {typeof window !== "undefined" && "Notification" in window && Notification.permission !== "granted" && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={enablePush}>Enable push</Button>
            )}
            {unread > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => mAll.mutate()}>
                <Check className="h-3 w-3 mr-1" /> All read
              </Button>
            )}
          </div>
        </div>
        {notifications.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">You're all caught up.</div>
        )}
        {notifications.map((n: any) => {
          const inner = (
            <div className={`px-3 py-2 border-b border-border/60 hover:bg-muted/40 ${!n.read_at ? "bg-muted/20" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{n.title}</p>
                  {n.body && <p className="text-xs text-muted-foreground line-clamp-2">{n.body}</p>}
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </p>
                </div>
                {!n.read_at && <span className="mt-1 h-2 w-2 rounded-full bg-[var(--accent-red)] shrink-0" />}
              </div>
            </div>
          );
          return n.link ? (
            <Link key={n.id} to={n.link} onClick={() => !n.read_at && mOne.mutate(n.id)}>{inner}</Link>
          ) : (
            <button key={n.id} className="w-full text-left" onClick={() => !n.read_at && mOne.mutate(n.id)}>{inner}</button>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}