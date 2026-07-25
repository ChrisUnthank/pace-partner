// Sends one athlete's "program delivered" email — same Resend connector
// gateway as send-report-email, but with an optional file attachment
// (the Excel-style export of their upcoming sessions).
//
// Note: Resend is currently capped to sending to the account owner's own
// verified address until a sending domain is verified. Attempting to send
// to any other address will fail with a Resend-side error until then —
// the caller (plan-delivery.functions.ts) records that as email_status
// 'failed' per recipient rather than surfacing a single all-or-nothing error.
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
    const { to, subject, html, attachment } = body ?? {};
    // attachment (optional): { filename: string, contentBase64: string }

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!to || !emailRe.test(to) || !subject || typeof subject !== "string" || !html || typeof html !== "string") {
      return new Response(JSON.stringify({ error: "Invalid input — expected { to, subject, html }" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (attachment && (typeof attachment.filename !== "string" || typeof attachment.contentBase64 !== "string")) {
      return new Response(JSON.stringify({ error: "Invalid attachment — expected { filename, contentBase64 }" }), {
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
        from: "Strider Training <onboarding@resend.dev>",
        to: [to],
        subject,
        html,
        ...(attachment
          ? { attachments: [{ filename: attachment.filename, content: attachment.contentBase64 }] }
          : {}),
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
    console.error("send-plan-delivery-email error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
