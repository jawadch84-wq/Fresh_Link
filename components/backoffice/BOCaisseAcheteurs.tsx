"use client"

import { useState, useMemo } from "react"
import { store } from "@/lib/store"
import type { BonAchat, Reception } from "@/lib/store"

// ── helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return n.toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function isoWeek(dateStr: string): string {
  const d = new Date(dateStr)
  const jan1 = new Date(d.getFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7)
  return `${d.getFullYear()}-S${String(week).padStart(2, "0")}`
}
function weekLabel(w: string) {
  const [y, s] = w.split("-S")
  return `Semaine ${s} / ${y}`
}

// ── types ─────────────────────────────────────────────────────────────────────
interface CaisseRow {
  acheteurId: string
  acheteurNom: string
  date: string
  especesPrises: number   // argent pris par l'acheteur
  valeurAchat: number     // total des bons d'achat
  valeurReception: number // total des réceptions
  modeReception: boolean  // réception activée pour ce bon ?
  ecart: number           // calculé selon le mode
  bonsAchat: BonAchat[]
  receptions: Reception[]
}

// ── composant principal ───────────────────────────────────────────────────────
export default function BOCaisseAcheteurs() {
  const [vue, setVue] = useState<"jour" | "semaine">("jour")
  const [dateFiltre, setDateFiltre] = useState<string>(
    () => new Date().toISOString().slice(0, 10)
  )
  const [semaineFiltre, setSemaineFiltre] = useState<string>(
    () => isoWeek(new Date().toISOString().slice(0, 10))
  )
  const [editId, setEditId] = useState<string | null>(null)
  const [editEspeces, setEditEspeces] = useState<string>("")

  const bonsAchat = store.getBonsAchat()
  const receptions = store.getReceptions()
  const users = store.getUsers()

  // Build rows — one per (acheteur, date) pair
  const rows = useMemo<CaisseRow[]>(() => {
    // Group bons achat by (acheteur, date)
    const map = new Map<string, CaisseRow>()

    for (const b of bonsAchat) {
      const key = `${b.acheteurId}__${b.date}`
      if (!map.has(key)) {
        map.set(key, {
          acheteurId: b.acheteurId,
          acheteurNom: b.acheteurNom,
          date: b.date,
          especesPrises: (b as BonAchat & { especesPrises?: number }).especesPrises ?? 0,
          valeurAchat: 0,
          valeurReception: 0,
          modeReception: false,
          ecart: 0,
          bonsAchat: [],
          receptions: [],
        })
      }
      const row = map.get(key)!
      row.bonsAchat.push(b)
      row.valeurAchat += b.lignes.reduce((s, l) => s + l.quantite * l.prixAchat, 0)
      // merge especes — take max saved value
      const saved = (b as BonAchat & { especesPrises?: number }).especesPrises ?? 0
      if (saved > row.especesPrises) row.especesPrises = saved
    }

    // Attach receptions
    for (const rec of receptions) {
      const dateRec = rec.date ?? (rec as Reception & { dateReception?: string }).dateReception ?? ""
      // find matching acheteur via bonAchatId
      const bon = bonsAchat.find(b => b.id === rec.bonAchatId)
      if (!bon) continue
      const key = `${bon.acheteurId}__${dateRec.slice(0, 10)}`
      if (!map.has(key)) continue
      const row = map.get(key)!
      row.receptions.push(rec)
      row.modeReception = true
      row.valeurReception += rec.lignes.reduce(
        (s, l) => s + l.quantiteRecue * (l.prixAchat ?? l.prixFacture ?? 0),
        0
      )
    }

    // Compute écart
    for (const row of map.values()) {
      const base = row.modeReception ? row.valeurReception : row.valeurAchat
      row.ecart = row.especesPrises - base
    }

    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date) || a.acheteurNom.localeCompare(b.acheteurNom))
  }, [bonsAchat, receptions])

  // Filter by date or week
  const filtered = useMemo(() => {
    if (vue === "jour") return rows.filter(r => r.date === dateFiltre)
    return rows.filter(r => isoWeek(r.date) === semaineFiltre)
  }, [rows, vue, dateFiltre, semaineFiltre])

  // Totaux globaux
  const totaux = useMemo(() => ({
    especes: filtered.reduce((s, r) => s + r.especesPrises, 0),
    achat: filtered.reduce((s, r) => s + r.valeurAchat, 0),
    reception: filtered.reduce((s, r) => s + r.valeurReception, 0),
    ecart: filtered.reduce((s, r) => s + r.ecart, 0),
  }), [filtered])

  // Totaux par acheteur (semaine)
  const parAcheteur = useMemo(() => {
    const m = new Map<string, { nom: string; especes: number; base: number; ecart: number }>()
    for (const r of filtered) {
      if (!m.has(r.acheteurId)) m.set(r.acheteurId, { nom: r.acheteurNom, especes: 0, base: 0, ecart: 0 })
      const a = m.get(r.acheteurId)!
      a.especes += r.especesPrises
      a.base += r.modeReception ? r.valeurReception : r.valeurAchat
      a.ecart += r.ecart
    }
    return [...m.values()]
  }, [filtered])

  // Semaines disponibles
  const semaines = useMemo(() => {
    const s = new Set(rows.map(r => isoWeek(r.date)))
    return [...s].sort().reverse()
  }, [rows])

  // Save espèces on a bon d'achat
  function saveEspeces(row: CaisseRow, val: number) {
    const all = store.getBonsAchat()
    for (const b of all) {
      if (b.acheteurId === row.acheteurId && b.date === row.date) {
        ;(b as BonAchat & { especesPrises?: number }).especesPrises = val
      }
    }
    store.saveBonsAchat(all)
    setEditId(null)
  }

  const ecartColor = (e: number) =>
    e > 0 ? "text-emerald-700 font-semibold" :
    e < 0 ? "text-red-600 font-semibold" :
    "text-gray-500"

  return (
    <div className="p-4 space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <svg className="w-6 h-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          Caisse Acheteurs
        </h2>
        {/* Vue toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden ml-auto">
          {(["jour", "semaine"] as const).map(v => (
            <button key={v} onClick={() => setVue(v)}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${vue === v ? "bg-amber-500 text-white" : "bg-card text-muted-foreground hover:bg-muted"}`}>
              {v === "jour" ? "Par jour" : "Récap semaine"}
            </button>
          ))}
        </div>
      </div>

      {/* Légende calcul */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800 flex gap-4 flex-wrap">
        <span>📌 <strong>Sans réception :</strong> Écart = Espèces prises − Valeur achat</span>
        <span>📌 <strong>Avec réception :</strong> Écart = Espèces prises − Valeur réception</span>
      </div>

      {/* Filtre */}
      <div className="flex items-center gap-3">
        {vue === "jour" ? (
          <input type="date" value={dateFiltre}
            onChange={e => setDateFiltre(e.target.value)}
            className="border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground" />
        ) : (
          <select value={semaineFiltre}
            onChange={e => setSemaineFiltre(e.target.value)}
            className="border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground">
            {semaines.map(s => (
              <option key={s} value={s}>{weekLabel(s)}</option>
            ))}
          </select>
        )}
        <span className="text-sm text-muted-foreground">{filtered.length} ligne(s)</span>
      </div>

      {/* Totaux globaux */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Espèces prises", val: totaux.especes, color: "bg-blue-50 border-blue-200 text-blue-800" },
          { label: "Total Valeur Achat", val: totaux.achat, color: "bg-amber-50 border-amber-200 text-amber-800" },
          { label: "Total Valeur Réception", val: totaux.reception, color: "bg-purple-50 border-purple-200 text-purple-800" },
          { label: "Écart Global", val: totaux.ecart, color: totaux.ecart >= 0 ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-700" },
        ].map(({ label, val, color }) => (
          <div key={label} className={`rounded-xl border p-4 ${color}`}>
            <div className="text-xs font-medium opacity-70">{label}</div>
            <div className="text-xl font-bold mt-1">{fmt(val)} DH</div>
          </div>
        ))}
      </div>

      {/* Récap par acheteur (semaine) */}
      {vue === "semaine" && parAcheteur.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border font-semibold text-sm text-foreground">
            Récap par acheteur — {weekLabel(semaineFiltre)}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted text-muted-foreground text-xs">
                <th className="px-4 py-2 text-left">Acheteur</th>
                <th className="px-4 py-2 text-right">Espèces prises</th>
                <th className="px-4 py-2 text-right">Valeur base</th>
                <th className="px-4 py-2 text-right">Écart</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {parAcheteur.map(a => (
                <tr key={a.nom} className="hover:bg-muted/40">
                  <td className="px-4 py-3 font-medium text-foreground">{a.nom}</td>
                  <td className="px-4 py-3 text-right text-blue-700 font-semibold">{fmt(a.especes)} DH</td>
                  <td className="px-4 py-3 text-right text-amber-700">{fmt(a.base)} DH</td>
                  <td className={`px-4 py-3 text-right ${ecartColor(a.ecart)}`}>
                    {a.ecart >= 0 ? "+" : ""}{fmt(a.ecart)} DH
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tableau détail */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          Aucun bon d&apos;achat pour cette période
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="bg-muted text-muted-foreground text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Acheteur</th>
                <th className="px-4 py-3 text-right">Espèces prises</th>
                <th className="px-4 py-3 text-right">Valeur Achat</th>
                <th className="px-4 py-3 text-right">Valeur Réception</th>
                <th className="px-4 py-3 text-center">Mode</th>
                <th className="px-4 py-3 text-right">Écart</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(row => {
                const rowKey = `${row.acheteurId}__${row.date}`
                const isEditing = editId === rowKey
                return (
                  <tr key={rowKey} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-foreground font-medium">{row.date}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground">{row.acheteurNom}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.bonsAchat.length} bon(s) · {row.receptions.length} réception(s)
                      </div>
                    </td>

                    {/* Espèces prises — éditable */}
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          className="w-28 border border-amber-400 rounded px-2 py-1 text-right text-sm bg-amber-50 focus:outline-none"
                          value={editEspeces}
                          onChange={e => setEditEspeces(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") saveEspeces(row, parseFloat(editEspeces) || 0)
                            if (e.key === "Escape") setEditId(null)
                          }}
                          autoFocus
                        />
                      ) : (
                        <span className="text-blue-700 font-bold">
                          {fmt(row.especesPrises)} DH
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-right text-amber-700">{fmt(row.valeurAchat)} DH</td>
                    <td className="px-4 py-3 text-right text-purple-700">
                      {row.valeurReception > 0 ? `${fmt(row.valeurReception)} DH` : "—"}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${row.modeReception ? "bg-purple-100 text-purple-700" : "bg-amber-100 text-amber-700"}`}>
                        {row.modeReception ? "Réception" : "Achat"}
                      </span>
                    </td>

                    <td className={`px-4 py-3 text-right text-base ${ecartColor(row.ecart)}`}>
                      {row.ecart >= 0 ? "+" : ""}{fmt(row.ecart)} DH
                    </td>

                    <td className="px-4 py-3 text-center">
                      {isEditing ? (
                        <div className="flex gap-1 justify-center">
                          <button
                            onClick={() => saveEspeces(row, parseFloat(editEspeces) || 0)}
                            className="px-2 py-1 bg-emerald-500 text-white rounded text-xs hover:bg-emerald-600">
                            ✓
                          </button>
                          <button
                            onClick={() => setEditId(null)}
                            className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300">
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditId(rowKey); setEditEspeces(String(row.especesPrises)) }}
                          className="px-3 py-1 bg-amber-100 text-amber-800 rounded text-xs hover:bg-amber-200 transition-colors">
                          Saisir espèces
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>

            {/* Footer totaux */}
            <tfoot>
              <tr className="bg-muted font-bold text-sm border-t-2 border-border">
                <td colSpan={2} className="px-4 py-3 text-foreground">TOTAL</td>
                <td className="px-4 py-3 text-right text-blue-700">{fmt(totaux.especes)} DH</td>
                <td className="px-4 py-3 text-right text-amber-700">{fmt(totaux.achat)} DH</td>
                <td className="px-4 py-3 text-right text-purple-700">{fmt(totaux.reception)} DH</td>
                <td />
                <td className={`px-4 py-3 text-right text-base ${ecartColor(totaux.ecart)}`}>
                  {totaux.ecart >= 0 ? "+" : ""}{fmt(totaux.ecart)} DH
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
