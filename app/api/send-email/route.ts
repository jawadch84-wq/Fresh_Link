// ============================================================
// /api/send-email — FreshLink Pro
// Multi-provider email sender (server-side, no CORS issues)
// Supports: Resend | Brevo | EmailJS (fallback)
// ============================================================
import { NextRequest, NextResponse } from "next/server"

export const runtime = "edge"

interface SendRequest {
  provider: "resend" | "brevo" | "emailjs"
  apiKey: string
  from?: string          // sender address
  fromName?: string      // sender display name
  to: string
  subject: string
  body: string           // plain text body
  // EmailJS specific
  serviceId?: string
  templateId?: string
}

async function sendResend(req: SendRequest) {
  const from = req.from
    ? `${req.fromName ?? "FreshLink Pro"} <${req.from}>`
    : "FreshLink Pro <onboarding@resend.dev>"   // sandbox sender for testing

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${req.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [req.to],
      subject: req.subject,
      text: req.body,
      html: bodyToHtml(req.body, req.subject),
    }),
  })
  if (res.ok) return { ok: true }
  const json = await res.json().catch(() => ({}))
  return { ok: false, error: `Resend ${res.status}: ${(json as { message?: string }).message ?? res.statusText}` }
}

async function sendBrevo(req: SendRequest) {
  const senderEmail = req.from ?? "no-reply@freshlink.ma"
  const senderName  = req.fromName ?? "FreshLink Pro"

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": req.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender:  { name: senderName, email: senderEmail },
      to:      [{ email: req.to }],
      subject: req.subject,
      textContent: req.body,
      htmlContent: bodyToHtml(req.body, req.subject),
    }),
  })
  if (res.ok) return { ok: true }
  const json = await res.json().catch(() => ({}))
  return { ok: false, error: `Brevo ${res.status}: ${(json as { message?: string }).message ?? res.statusText}` }
}

async function sendEmailJS(req: SendRequest) {
  if (!req.serviceId || !req.templateId) {
    return { ok: false, error: "EmailJS: serviceId et templateId requis." }
  }
  const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id:  req.serviceId,
      template_id: req.templateId,
      user_id:     req.apiKey,
      template_params: {
        to_email: req.to, subject: req.subject, message: req.body,
        to: req.to, email: req.to, titre: req.subject, contenu: req.body, corps: req.body,
      },
    }),
  })
  if (res.ok) return { ok: true }
  const text = await res.text().catch(() => "")
  return { ok: false, error: `EmailJS ${res.status}: ${text || res.statusText}` }
}

/** Convert plain text body to a clean HTML email */
function bodyToHtml(text: string, subject: string): string {
  const escaped = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .split("\n").map(l => `<p style="margin:4px 0;font-family:monospace;font-size:13px;color:#334155">${l || "&nbsp;"}</p>`).join("")
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="background:#f8fafc;padding:24px;font-family:sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
    <div style="background:linear-gradient(135deg,#1B4332,#166534);padding:20px 24px">
      <div style="color:#4ADE80;font-size:20px;font-weight:900;letter-spacing:-.5px">🌿 FRESH<span style="color:#fff">LINK</span> <span style="font-size:11px;font-weight:700;opacity:.8">PRO</span></div>
    </div>
    <div style="padding:24px">
      <h2 style="margin:0 0 16px;font-size:16px;color:#1e293b">${subject}</h2>
      <div style="background:#f8fafc;border-radius:8px;padding:16px;border:1px solid #e2e8f0">${escaped}</div>
    </div>
    <div style="padding:12px 24px;border-top:1px solid #f1f5f9;font-size:11px;color:#94a3b8;text-align:center">FreshLink Pro — Distribution fruits &amp; légumes frais · Casablanca</div>
  </div></body></html>`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as SendRequest

    if (!body.apiKey || !body.to || !body.subject || !body.body) {
      return NextResponse.json({ ok: false, error: "Paramètres manquants: apiKey, to, subject, body" }, { status: 400 })
    }
    if (!body.to.includes("@")) {
      return NextResponse.json({ ok: false, error: "Adresse email invalide." }, { status: 400 })
    }

    let result: { ok: boolean; error?: string }
    switch (body.provider) {
      case "resend":  result = await sendResend(body);  break
      case "brevo":   result = await sendBrevo(body);   break
      case "emailjs": result = await sendEmailJS(body); break
      default: return NextResponse.json({ ok: false, error: `Provider inconnu: ${body.provider}` }, { status: 400 })
    }

    return NextResponse.json(result, { status: result.ok ? 200 : 502 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: `Erreur serveur: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}
