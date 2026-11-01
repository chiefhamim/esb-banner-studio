-- PROPOSAL for the esbpowerline repo: prisma/migrations/0025_outreach_settings_realtime/migration.sql
-- Written by the Studio side (branch outreach-pacing-fix, 2026-11-01). NOT applied. The lead/owner reviews and
-- applies it in the website repo; the Studio already works without it (settings stay per PC, the 60 s / 5 min poll
-- carries every change) and starts using it the moment it exists.
--
-- 1. public.outreach_settings — two rows the Studio reads and writes with the staff JWT:
--      id 'autopilot': the sending ACCOUNT's Autopilot settings (hours, days, time zone, daily limit, warm-up, pace,
--                      wait at least / at most, per-organisation limit and spacing, contact cooldown) +
--                      sharedUpdatedAt (ms) — newest wins. Both office PCs send from the same Gmail address, so a
--                      limit that differs per PC is not a limit. Per-PC options (tray, assistant) never go here.
--      id 'desk':      signatures, saved templates, house prompt, letterhead look (newest wins by deskUpdatedAt) and
--                      the hand approvals (a union).
--    Same access model as 0024: staff (outreach_is_staff) read/write, anon nothing.
-- 2. Realtime: the four SMALL-row tables join the supabase_realtime publication so the Studio's one websocket channel
--    (src/outreach/cloudRealtime.ts, postgres_changes) is poked when another PC writes. Realtime applies the
--    subscriber's RLS to every change (authenticated + outreach_is_staff), so anon and non-staff receive nothing.
--    outreach_campaigns / outreach_lists / outreach_designs are deliberately NOT added: their rows are whole
--    campaigns / workbooks and would be broadcast in full on every change.
--
-- Additive and idempotent, like 0024.

CREATE TABLE IF NOT EXISTS public.outreach_settings (
    id          text PRIMARY KEY CHECK (id IN ('autopilot', 'desk')),
    data        jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid
);

ALTER TABLE public.outreach_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Outreach staff select" ON public.outreach_settings;
DROP POLICY IF EXISTS "Outreach staff insert" ON public.outreach_settings;
DROP POLICY IF EXISTS "Outreach staff update" ON public.outreach_settings;
DROP POLICY IF EXISTS "Outreach staff delete" ON public.outreach_settings;
CREATE POLICY "Outreach staff select" ON public.outreach_settings FOR SELECT TO authenticated USING (public.outreach_is_staff());
CREATE POLICY "Outreach staff insert" ON public.outreach_settings FOR INSERT TO authenticated WITH CHECK (public.outreach_is_staff());
CREATE POLICY "Outreach staff update" ON public.outreach_settings FOR UPDATE TO authenticated USING (public.outreach_is_staff()) WITH CHECK (public.outreach_is_staff());
CREATE POLICY "Outreach staff delete" ON public.outreach_settings FOR DELETE TO authenticated USING (public.outreach_is_staff());

REVOKE ALL ON TABLE public.outreach_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.outreach_settings TO authenticated;
GRANT ALL ON TABLE public.outreach_settings TO service_role;

-- Realtime publication (Supabase creates supabase_realtime; ADD TABLE fails if already a member, hence the check).
DO $$
DECLARE
    t text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        RAISE NOTICE 'supabase_realtime publication missing — Realtime not enabled on this project; skipped';
        RETURN;
    END IF;
    FOREACH t IN ARRAY ARRAY['outreach_sends', 'outreach_events', 'outreach_locks', 'outreach_settings'] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;

-- Rollback: ALTER PUBLICATION supabase_realtime DROP TABLE public.outreach_sends, public.outreach_events,
--           public.outreach_locks, public.outreach_settings; DROP TABLE public.outreach_settings;
