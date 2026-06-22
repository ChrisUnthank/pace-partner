import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/dispatch-push")({
  server: {
    handlers: {
      POST: async () => {
        const publicKey = process.env.VAPID_PUBLIC_KEY;
        const privateKey = process.env.VAPID_PRIVATE_KEY;
        const subject = process.env.VAPID_SUBJECT ?? "mailto:noreply@lovable.app";
        if (!publicKey || !privateKey) {
          return new Response(JSON.stringify({ ok: false, error: "VAPID keys missing" }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
        const { default: webpush } = await import("web-push");
        webpush.setVapidDetails(subject, publicKey, privateKey);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: pending } = await supabaseAdmin
          .from("notifications")
          .select("id, user_id, title, body, link, kind")
          .is("pushed_at", null)
          .lt("push_attempts", 3)
          .order("created_at", { ascending: true })
          .limit(100);

        if (!pending?.length) return new Response(JSON.stringify({ ok: true, sent: 0 }));

        let sent = 0, failed = 0;
        const userIds = Array.from(new Set(pending.map((n) => n.user_id)));
        const { data: subs } = await supabaseAdmin
          .from("push_subscriptions")
          .select("user_id, endpoint, p256dh, auth")
          .in("user_id", userIds);
        const subsByUser = new Map<string, any[]>();
        (subs ?? []).forEach((s) => {
          const arr = subsByUser.get(s.user_id) ?? [];
          arr.push(s); subsByUser.set(s.user_id, arr);
        });

        for (const n of pending) {
          const userSubs = subsByUser.get(n.user_id) ?? [];
          if (!userSubs.length) {
            await supabaseAdmin.from("notifications").update({
              pushed_at: new Date().toISOString(),
              push_attempts: 1,
            }).eq("id", n.id);
            continue;
          }
          const payload = JSON.stringify({
            title: n.title, body: n.body ?? "", link: n.link ?? "/app", tag: n.kind,
          });
          let anyOk = false;
          for (const s of userSubs) {
            try {
              await webpush.sendNotification(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } } as any,
                payload,
              );
              anyOk = true; sent++;
            } catch (err: any) {
              failed++;
              if (err?.statusCode === 404 || err?.statusCode === 410) {
                await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
              }
            }
          }
          await supabaseAdmin.from("notifications").update({
            pushed_at: anyOk ? new Date().toISOString() : null,
            push_attempts: 1,
          }).eq("id", n.id);
        }

        return new Response(JSON.stringify({ ok: true, sent, failed }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});