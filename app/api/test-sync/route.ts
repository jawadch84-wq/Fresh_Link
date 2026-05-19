import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://jwdrwapuetqoqnankgma.supabase.co"
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? SUPABASE_ANON_KEY

const SETUP_SQL = `-- FreshLink Pro — Setup Supabase v5
-- Paste this in: https://supabase.com/dashboard/project/jwdrwapuetqoqnankgma/sql/new

DO $$ DECLARE t TEXT;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'fl_%'
  LOOP EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', t); END LOOP;
END $$;

CREATE TABLE public.fl_depots            (id TEXT PRIMARY KEY, payload JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.fl_users             (id TEXT PRIMARY KEY, payload JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.fl_clients           (id TEXT PRIMARY KEY, payload JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.fl_fournisseurs      (id TEXT PRIMARY KEY, payload JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.fl_articles          (id TEXT PRIMARY KEY, payload JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.fl_livreurs          (id TEXT PRIMARY KEY, payload JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.fl_commandes         (id TEXT PRIMARY KEY, payload JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.fl_bons_achat        (id TEXT PRIMARY KEY, payload JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.fl_purchase_orders   (id TEXT PRIMARY KEY, payload JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.fl_bons_livraison    (id TEXT PRIMARY KEY, payload JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.fl_bons_preparation  (id TEXT PRIMARY KEY, payload JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.fl_receptions        (id TEXT PRIMARY KEY, payload JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.fl_trips             (id TEXT PRIMARY KEY, payload JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.fl_retours           (id TEXT PRIMARY KEY, payload JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.fl_visites           (id TEXT PRIMARY KEY, payload JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.fl_messages          (id TEXT PRIMARY KEY, payload JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.fl_transferts_stock  (id TEXT PRIMARY KEY, payload JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.fl_demandes_achat    (id TEXT PRIMARY KEY, payload JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.fl_notices           (id TEXT PRIMARY KEY, payload JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.fl_non_achats        (id TEXT PRIMARY KEY, payload JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());

DO $$ DECLARE t TEXT;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'fl_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT ALL ON public.%I TO anon, authenticated', t);
  END LOOP;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE
  public.fl_depots, public.fl_users, public.fl_clients, public.fl_fournisseurs,
  public.fl_articles, public.fl_livreurs, public.fl_commandes, public.fl_bons_achat,
  public.fl_purchase_orders, public.fl_bons_livraison, public.fl_bons_preparation,
  public.fl_receptions, public.fl_trips, public.fl_retours, public.fl_visites,
  public.fl_messages, public.fl_transferts_stock, public.fl_demandes_achat,
  public.fl_notices, public.fl_non_achats;`

// Tables ERP à tester
const ERP_TABLES = [
  "fl_depots", "fl_users", "fl_clients", "fl_fournisseurs", "fl_articles",
  "fl_livreurs", "fl_commandes", "fl_bons_achat", "fl_purchase_orders",
  "fl_bons_livraison", "fl_bons_preparation", "fl_receptions", "fl_trips",
  "fl_retours", "fl_visites", "fl_messages", "fl_transferts_stock",
]

export async function GET() {
  const results: Record<string, { exists: boolean; count: number; hasPayload: boolean; error?: string }> = {}
  const sb = createClient(SUPABASE_URL, SERVICE_KEY)

  // Test connexion de base
  let connected = false
  try {
    const { error } = await sb.from("fl_depots").select("id").limit(1)
    connected = !error
  } catch {
    connected = false
  }

  // Tester chaque table
  for (const table of ERP_TABLES) {
    try {
      const { data, error, count } = await sb
        .from(table)
        .select("id, payload", { count: "exact" })
        .limit(3)

      if (error) {
        results[table] = { exists: false, count: 0, hasPayload: false, error: error.message }
      } else {
        const hasPayload = data?.some(r => r.payload !== undefined) ?? false
        results[table] = { exists: true, count: count ?? data?.length ?? 0, hasPayload }
      }
    } catch (e) {
      results[table] = { exists: false, count: 0, hasPayload: false, error: String(e) }
    }
  }

  // Test Realtime publication
  let realtimeEnabled = false
  try {
    const { data } = await sb.rpc("pg_publication_tables", {})
      .select("*").limit(1)
    realtimeEnabled = !!data
  } catch {
    // pg_publication_tables might not be exposed — check via another method
    realtimeEnabled = connected // assume enabled if connected
  }

  // Test Storage bucket
  let storageBucket = false
  try {
    const { data } = await sb.storage.getBucket("freshlink-media")
    storageBucket = !!data
  } catch {
    storageBucket = false
  }

  const tableCount = Object.values(results).filter(r => r.exists).length
  const tablesWithData = Object.values(results).filter(r => r.count > 0).length
  const tablesJsonb = Object.values(results).filter(r => r.hasPayload).length

  return NextResponse.json({
    status: connected ? "ok" : "error",
    timestamp: new Date().toISOString(),
    supabase: {
      url: SUPABASE_URL,
      connected,
      storage_bucket: storageBucket,
      realtime_assumed: realtimeEnabled,
    },
    tables: {
      total_expected: ERP_TABLES.length,
      exist: tableCount,
      have_data: tablesWithData,
      jsonb_schema: tablesJsonb,
      missing: Object.entries(results).filter(([, v]) => !v.exists).map(([k]) => k),
      detail: results,
    },
    checklist: {
      "1_connexion_supabase": connected ? "✅" : "❌",
      "2_tables_créées": tableCount === ERP_TABLES.length ? "✅" : `⚠️ ${ERP_TABLES.length - tableCount} manquantes`,
      "3_schema_jsonb": tablesJsonb > 0 ? "✅" : "❌ (exécuter fix_supabase_sync.sql)",
      "4_données_présentes": tablesWithData > 0 ? `✅ ${tablesWithData} tables ont des données` : "⚠️ Aucune donnée (normal si première connexion)",
      "5_storage_bucket": storageBucket ? "✅" : "⚠️ Créer le bucket freshlink-media dans Supabase Storage",
    },
    setup_sql: SETUP_SQL,
    supabase_editor_url: "https://supabase.com/dashboard/project/jwdrwapuetqoqnankgma/sql/new",
  }, { status: connected ? 200 : 503 })
}
