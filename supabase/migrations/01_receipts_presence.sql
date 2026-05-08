-- ============================================================================
-- Migration 01 — Read receipts realtime + last-seen presence
-- ============================================================================
-- Additive, idempotent. Safe to re-run. No data loss.
--
-- Adds:
--   * profiles.last_seen_at — heartbeat-driven timestamp powering
--     "last seen 5m ago" / "online" UI.
--   * supabase_realtime publication on message_reads — so the sender's
--     UI can light up ✓✓ the moment the recipient marks a message read.
-- ============================================================================

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

create index if not exists profiles_last_seen_idx
  on public.profiles(last_seen_at desc);

-- Add message_reads to the realtime publication exactly once. ALTER
-- PUBLICATION ADD TABLE has no IF NOT EXISTS form, so we guard manually.
do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'message_reads'
  ) then
    alter publication supabase_realtime add table public.message_reads;
  end if;
end$$;
