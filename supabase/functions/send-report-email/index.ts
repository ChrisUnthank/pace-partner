// Sends a pre-built HTML report (weekly athlete report, coach summary,
// training plan report, etc.) via the Resend connector gateway. Deliberately
// generic — the caller builds the full HTML, this function just delivers it —
// so every report type (athlete weekly, coach weekly, plan weekly/monthly/
// block) can share one send path instead of one edge function each.
//
// Note: Resend is currently capped to sending to the account owner's own
// verified address until a sending domain is verified. Attempting to send
// to any other address will fail with a Resend-side error until then.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "Email service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { to, subject, html } = body ?? {};

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!to || !emailRe.test(to) || !subject || typeof subject !== "string" || !html || typeof html !== "string") {
      return new Response(JSON.stringify({ error: "Invalid input — expected { to, subject, html }" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendRes = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: "Strider Reports <onboarding@resend.dev>",
        to: [to],
        subject,
        html,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error(`Resend gateway error [${resendRes.status}]: ${errText}`);
      return new Response(JSON.stringify({ error: "Failed to send email", details: errText }), {
        status: resendRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resendRes.json();
    return new Response(JSON.stringify({ ok: true, data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-report-email error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
