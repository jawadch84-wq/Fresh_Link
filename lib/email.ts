// ============================================================
// Email Integration — FreshLink Pro
// Multi-provider: Resend | Brevo | EmailJS
// Configure via Paramètres → Email dans le back-office.
// Sends via /api/send-email (server-side, no CORS issues).
// Falls back to EmailJS browser API if server route unavailable.
// ============================================================

export type EmailProvider = "resend" | "brevo" | "emailjs"

// --------------- Config ---------------

export interface EmailProviderConfig {
  provider:  EmailProvider
  apiKey:    string
  from?:     string      // sender email (required for Resend/Brevo verified domains)
  fromName?: string      // sender display name
  // EmailJS only
  serviceId?:  string
  templateId?: string
}

const LS_KEY = "fl_email_provider_config"

export function getEmailProviderConfig(): EmailProviderConfig {
  if (typeof window === "undefined") {
    return { provider: "emailjs", apiKey: "" }
  }
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw) as EmailProviderConfig
  } catch { /* ignore */ }

  // Backward compat: migrate old EmailJS config
  try {
    const old = localStorage.getItem("fl_emailjs_config")
    if (old) {
      const p = JSON.parse(old) as { serviceId?: string; templateId?: string; publicKey?: string }
      return { provider: "emailjs", apiKey: p.publicKey ?? "", serviceId: p.serviceId, templateId: p.templateId }
    }
  } catch { /* ignore */ }

  return { provider: "emailjs", apiKey: "" }
}

export function saveEmailProviderConfig(cfg: EmailProviderConfig): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(LS_KEY, JSON.stringify(cfg))
  }
}

export function isEmailConfigured(): boolean {
  const cfg = getEmailProviderConfig()
  if (!cfg.apiKey) return false
  if (cfg.provider === "emailjs") return !!(cfg.serviceId && cfg.templateId)
  return true  // resend / brevo only need apiKey
}

// Backward compat exports used by BOSettings
export function saveEmailJSConfig(cfg: { serviceId: string; templateId: string; publicKey: string }): void {
  saveEmailProviderConfig({ provider: "emailjs", apiKey: cfg.publicKey, serviceId: cfg.serviceId, templateId: cfg.templateId })
}
export function getEmailJSConfigPublic() {
  const cfg = getEmailProviderConfig()
  return { serviceId: cfg.serviceId ?? "", templateId: cfg.templateId ?? "", publicKey: cfg.apiKey }
}
export function isEmailJSConfigured(): boolean { return isEmailConfigured() }

// --------------- Core types ---------------

export interface EmailPayload {
  to_email: string
  subject:  string
  body:     string
}

export interface SendResult {
  ok:      boolean
  error?:  string
  status?: number
}

// --------------- Core sender ---------------

export async function sendEmail(payload: EmailPayload): Promise<SendResult> {
  const cfg = getEmailProviderConfig()

  if (!payload.to_email?.includes("@")) {
    return { ok: false, error: "Adresse email destinataire invalide." }
  }

  if (!isEmailConfigured()) {
    return {
      ok: false,
      error: "Email non configuré. Allez dans Paramètres → Email pour configurer Resend, Brevo ou EmailJS.",
    }
  }

  // Try server-side API route first (no CORS issues, works for all providers)
  try {
    const res = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider:    cfg.provider,
        apiKey:      cfg.apiKey,
        from:        cfg.from,
        fromName:    cfg.fromName,
        to:          payload.to_email,
        subject:     payload.subject,
        body:        payload.body,
        serviceId:   cfg.serviceId,
        templateId:  cfg.templateId,
      }),
    })
    const json = await res.json() as { ok: boolean; error?: string }
    if (json.ok) return { ok: true }
    // If server route is available but provider returned an error — surface it
    if (res.status !== 404) return { ok: false, error: json.error ?? `Erreur ${res.status}` }
    // 404 means the route doesn't exist yet → fall through to direct call
  } catch { /* network error or route not deployed — fall through */ }

  // Direct fallback for EmailJS (can be called from browser)
  if (cfg.provider === "emailjs") {
    return callEmailJSDirect(cfg, payload)
  }

  return { ok: false, error: "La route /api/send-email n'est pas disponible. Vérifiez le déploiement Next.js." }
}

async function callEmailJSDirect(cfg: EmailProviderConfig, payload: EmailPayload): Promise<SendResult> {
  try {
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id:  cfg.serviceId,
        template_id: cfg.templateId,
        user_id:     cfg.apiKey,
        template_params: {
          to_email: payload.to_email, subject: payload.subject, message: payload.body,
          to: payload.to_email, email: payload.to_email, titre: payload.subject, contenu: payload.body, corps: payload.body,
        },
      }),
    })
    if (res.ok) return { ok: true }
    const text = await res.text().catch(() => "")
    return { ok: false, status: res.status, error: `EmailJS ${res.status}: ${text || res.statusText}` }
  } catch (err) {
    return { ok: false, error: `Erreur réseau: ${err instanceof Error ? err.message : String(err)}` }
  }
}

// --------------- Multi-send ---------------

export async function sendEmailMulti(
  to_emails: string[],
  subject: string,
  body: string
): Promise<{ sent: string[]; failed: Array<{ email: string; error: string }> }> {
  const sent: string[] = []
  const failed: Array<{ email: string; error: string }> = []
  for (const email of to_emails) {
    const result = await sendEmail({ to_email: email, subject, body })
    if (result.ok) { sent.push(email) }
    else { failed.push({ email, error: result.error ?? "Erreur inconnue" }) }
    await new Promise(r => setTimeout(r, 300))
  }
  return { sent, failed }
}

// --------------- Connection test ---------------

export async function testEmailConnection(to?: string): Promise<SendResult> {
  const cfg = getEmailProviderConfig()
  if (!isEmailConfigured()) return { ok: false, error: "Email non configuré." }
  const providerLabel = cfg.provider === "resend" ? "Resend" : cfg.provider === "brevo" ? "Brevo" : "EmailJS"
  return sendEmail({
    to_email: to ?? "test@freshlink.test",
    subject:  `Test connexion ${providerLabel} — FreshLink Pro`,
    body:     `Ce message confirme que votre configuration ${providerLabel} fonctionne correctement.\n\nFreshLink Pro — ${new Date().toLocaleString("fr-MA")}`,
  })
}

/** @deprecated Use testEmailConnection() */
export async function testEmailJSConnection(): Promise<SendResult> { return testEmailConnection() }

// --------------- Email body builders ---------------

function fmt(n: number): string {
  return n.toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function dateStr(): string {
  return new Date().toLocaleDateString("fr-MA", { day: "2-digit", month: "2-digit", year: "numeric" })
}

// ---- Récap journalier ----

export function buildRecapJournalier(data: {
  date: string
  totalAchats: number
  totalCommandes: number
  totalLivraisons: number
  totalRetours: number
  totalCash: number
  marge: number
  nbBonsAchat?: number
  nbCommandes?: number
  nbLivraisons?: number
  nbRetours?: number
}): string {
  const line = "─".repeat(48)
  return [
    line,
    "     RÉCAP JOURNALIER — FreshLink Pro",
    `     Date : ${data.date}`,
    line,
    "",
    `  Achats du jour        : ${fmt(data.totalAchats)} DH  (${data.nbBonsAchat ?? 0} bons)`,
    `  Commandes validées    : ${fmt(data.totalCommandes)} DH  (${data.nbCommandes ?? 0} commandes)`,
    `  Livraisons effectuées : ${fmt(data.totalLivraisons)} DH  (${data.nbLivraisons ?? 0} BLs)`,
    `  Retours               : ${fmt(data.totalRetours)} DH  (${data.nbRetours ?? 0} retours)`,
    `  Encaissements (Cash)  : ${fmt(data.totalCash)} DH`,
    "  " + "·".repeat(44),
    `  Marge brute estimée   : ${fmt(data.marge)} DH`,
    "",
    line,
    "  Rapport généré par FreshLink Pro",
    line,
  ].join("\n")
}

// ---- Bon d'achat ----

export function buildAchatEmail(bon: {
  id: string; fournisseurNom: string; date: string; acheteurNom: string
  lignes: { articleNom: string; quantite: number; prixAchat: number }[]
}): string {
  const total = bon.lignes.reduce((s, l) => s + l.quantite * l.prixAchat, 0)
  const line = "─".repeat(48)
  return [
    line,
    `  BON D'ACHAT #${bon.id}`,
    `  Date : ${bon.date}`,
    `  Acheteur : ${bon.acheteurNom}`,
    `  Fournisseur : ${bon.fournisseurNom}`,
    line,
    ...bon.lignes.map(l =>
      `  • ${l.articleNom.padEnd(20)} ${String(l.quantite).padStart(6)}  x  ${fmt(l.prixAchat)} DH = ${fmt(l.quantite * l.prixAchat)} DH`
    ),
    line,
    `  TOTAL : ${fmt(total)} DH`,
    line,
  ].join("\n")
}

// ---- Commande ----

export function buildCommandeEmail(cmd: {
  id: string; clientNom: string; commercialNom: string; date: string; heurelivraison: string
  lignes: { articleNom: string; quantite: number; prixVente: number }[]
}): string {
  const total = cmd.lignes.reduce((s, l) => s + l.quantite * l.prixVente, 0)
  const line = "─".repeat(48)
  return [
    line,
    `  COMMANDE #${cmd.id}`,
    `  Date : ${cmd.date}     Livraison : ${cmd.heurelivraison}`,
    `  Commercial : ${cmd.commercialNom}`,
    `  Client : ${cmd.clientNom}`,
    line,
    ...cmd.lignes.map(l =>
      `  • ${l.articleNom.padEnd(20)} ${String(l.quantite).padStart(6)}  x  ${fmt(l.prixVente)} DH = ${fmt(l.quantite * l.prixVente)} DH`
    ),
    line,
    `  TOTAL TTC : ${fmt(total)} DH`,
    line,
  ].join("\n")
}

// ---- Besoin d'achat net ----

export interface BesoinLigneEmail {
  articleNom:    string
  fournisseurNom?: string
  commandeTotal: number
  stockActuel:   number
  retours:       number
  besoinNet:     number
  unite?:        string
}

export function buildBesoinAchatEmail(
  lignes: BesoinLigneEmail[],
  options?: { date?: string; titre?: string }
): string {
  const d    = options?.date  ?? dateStr()
  const line = "─".repeat(56)
  const total = lignes.reduce((s, l) => s + l.besoinNet, 0)

  const header = [
    line,
    `  BESOIN D'ACHAT NET — FreshLink Pro`,
    `  Date : ${d}`,
    `  Calcul : Commandes prévendeurs − Stock − Retours validés`,
    line,
    `  ${"Article".padEnd(22)} ${"Cdes".padStart(6)} ${"Stock".padStart(6)} ${"Retours".padStart(8)} ${"Besoin".padStart(8)}`,
    `  ${"─".repeat(52)}`,
  ]

  const rows = lignes.map(l => {
    const unite = l.unite ? ` ${l.unite}` : ""
    const status = l.besoinNet > 0 ? `  *** COMMANDER ${l.besoinNet}${unite} ***` : "  OK"
    return [
      `  ${l.articleNom.slice(0, 22).padEnd(22)} ${String(l.commandeTotal).padStart(6)} ${String(l.stockActuel).padStart(6)} ${String(l.retours).padStart(8)} ${String(l.besoinNet).padStart(8)}${l.besoinNet > 0 ? status : ""}`,
      l.fournisseurNom ? `    → Fournisseur : ${l.fournisseurNom}` : "",
    ].filter(Boolean).join("\n")
  })

  const footer = [
    `  ${"─".repeat(52)}`,
    `  Total besoin net : ${total} unité(s)`,
    line,
    "  À envoyer au(x) fournisseur(s) pour approvisionnement",
    line,
  ]

  return [...header, ...rows, ...footer].join("\n")
}

// ---- Besoin d'achat consolidé par fournisseur ----

export interface BesoinParFournisseur {
  fournisseurNom: string
  fournisseurEmail?: string
  lignes: BesoinLigneEmail[]
}

export function buildBesoinAchatParFournisseur(
  groupes: BesoinParFournisseur[],
  date?: string
): Array<{ fournisseurNom: string; fournisseurEmail?: string; subject: string; body: string }> {
  const d = date ?? dateStr()
  return groupes
    .filter(g => g.lignes.some(l => l.besoinNet > 0))
    .map(g => {
      const lignesAvecBesoin = g.lignes.filter(l => l.besoinNet > 0)
      return {
        fournisseurNom:   g.fournisseurNom,
        fournisseurEmail: g.fournisseurEmail,
        subject: `Commande d'approvisionnement FreshLink — ${g.fournisseurNom} — ${d}`,
        body: buildBesoinAchatEmail(
          lignesAvecBesoin.map(l => ({ ...l, fournisseurNom: undefined })),
          { date: d, titre: `Commande pour ${g.fournisseurNom}` }
        ),
      }
    })
}
