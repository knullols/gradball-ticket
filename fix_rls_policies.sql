-- ==========================================
-- RUN THIS IN SUPABASE SQL EDITOR
-- This applies all required security policies
-- Safe to run even if tables already exist
-- ==========================================

-- 1. Enable Row Level Security on all tables
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- 2. user_roles: allow any logged-in user to read roles
DROP POLICY IF EXISTS "Allow authenticated to read roles" ON public.user_roles;
CREATE POLICY "Allow authenticated to read roles"
  ON public.user_roles FOR SELECT TO authenticated USING (true);

-- 3. events: allow any logged-in user full access
DROP POLICY IF EXISTS "Allow authenticated to read events" ON public.events;
DROP POLICY IF EXISTS "Allow authenticated to insert events" ON public.events;
DROP POLICY IF EXISTS "Allow authenticated to update events" ON public.events;
DROP POLICY IF EXISTS "Allow authenticated to delete events" ON public.events;
CREATE POLICY "Allow authenticated to read events"   ON public.events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated to insert events" ON public.events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated to update events" ON public.events FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow authenticated to delete events" ON public.events FOR DELETE TO authenticated USING (true);

-- 4. tickets: allow any logged-in user full access
DROP POLICY IF EXISTS "Allow all authenticated to select tickets" ON public.tickets;
DROP POLICY IF EXISTS "Allow all authenticated to update tickets" ON public.tickets;
DROP POLICY IF EXISTS "Allow all authenticated to insert tickets" ON public.tickets;
CREATE POLICY "Allow all authenticated to select tickets" ON public.tickets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow all authenticated to update tickets" ON public.tickets FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow all authenticated to insert tickets" ON public.tickets FOR INSERT TO authenticated WITH CHECK (true);
