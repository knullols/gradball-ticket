-- ==========================================
-- NOCTURNE TICKETING APP - DATABASE SCHEMA
-- ==========================================

-- 1. Create the user_roles table for Role-Based Access Control
CREATE TABLE public.user_roles (
    email TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('admin', 'staff'))
);

-- 2. Create the events table
--    - Only one event should have is_active = TRUE at a time
--    - The admin sets this before the night starts
CREATE TABLE public.events (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    is_active  BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create the tickets table to store all generated serials
--    - serialNumber: unique ticket ID (e.g. NC-260609-0001)
--    - label:        the vertical side label on the ticket
--    - mainLabel:    the large center label on the ticket
--    - qrLabel:      small label shown above the QR code
--    - qrValue:      the raw string encoded in the QR code (usually = serialNumber)
--    - status:       'Pending' → 'Scanned' once a valid scan happens
--    - event_id:     links the ticket to a specific event
--    - scanned_at:   timestamp of when the ticket was scanned
CREATE TABLE public.tickets (
    "serialNumber" TEXT PRIMARY KEY,
    label          TEXT,
    "mainLabel"    TEXT,
    "qrLabel"      TEXT,
    "qrValue"      TEXT,
    status         TEXT DEFAULT 'Pending',
    event_id       UUID REFERENCES public.events(id),
    scanned_at     TIMESTAMPTZ
);

-- ==========================================
-- SECURITY POLICIES (Required if using anon key)
-- ==========================================

-- Enable Row Level Security
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

-- Allow ANY logged-in user to manage events
CREATE POLICY "Allow authenticated to read events"  ON public.events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated to insert events" ON public.events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated to update events" ON public.events FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow authenticated to delete events" ON public.events FOR DELETE TO authenticated USING (true);

-- Allow ANY logged-in user to read and update tickets (needed for scanners)
CREATE POLICY "Allow all authenticated to select tickets" ON public.tickets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow all authenticated to update tickets" ON public.tickets FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow all authenticated to insert tickets" ON public.tickets FOR INSERT TO authenticated WITH CHECK (true);

-- Allow users to read the user_roles table to determine their permissions
CREATE POLICY "Allow authenticated to read roles" ON public.user_roles FOR SELECT TO authenticated USING (true);
