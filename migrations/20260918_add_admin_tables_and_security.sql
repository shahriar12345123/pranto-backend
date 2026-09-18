-- ==============================================================================
-- Migration: Add Admin Tables, Audit Logs, Store Settings & Stock Restoration
-- Execute in Supabase SQL Editor
-- ==============================================================================

-- 1. Ensure UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Store Settings Table
CREATE TABLE IF NOT EXISTS public.store_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'store_settings' AND policyname = 'Anyone can view store settings') THEN
        CREATE POLICY "Anyone can view store settings" ON public.store_settings FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'store_settings' AND policyname = 'Allow backend full access to store settings') THEN
        CREATE POLICY "Allow backend full access to store settings" ON public.store_settings FOR ALL USING (true);
    END IF;
END $$;

INSERT INTO public.store_settings (key, value, description)
VALUES 
    ('delivery', '{"insideDhaka": 70, "outsideDhaka": 130}'::jsonb, 'Standard delivery charges in BDT across Bangladesh'),
    ('payment_accounts', '{"bkash": "01700-000000", "nagad": "01700-000000", "rocket": "01700-000000-0"}'::jsonb, 'Personal payment account numbers for manual payments'),
    ('inventory', '{"lowStockThreshold": 5}'::jsonb, 'Threshold below which a product is flagged as low stock')
ON CONFLICT (key) DO NOTHING;

-- 3. Admin Audit Logs Table
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    admin_email TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    description TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_id ON public.admin_audit_logs (admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action ON public.admin_audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON public.admin_audit_logs (created_at DESC);

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'admin_audit_logs' AND policyname = 'Admins can view audit logs') THEN
        CREATE POLICY "Admins can view audit logs" ON public.admin_audit_logs 
            FOR SELECT USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'admin_audit_logs' AND policyname = 'Allow backend full access to audit logs') THEN
        CREATE POLICY "Allow backend full access to audit logs" ON public.admin_audit_logs FOR ALL USING (true);
    END IF;
END $$;

-- 4. Atomic Stock Restoration Function
CREATE OR REPLACE FUNCTION public.restore_product_stock(
    p_product_id TEXT,
    p_quantity INTEGER
)
RETURNS TABLE (
    product_id TEXT,
    previous_stock INTEGER,
    new_stock INTEGER,
    success BOOLEAN,
    message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_stock INTEGER;
BEGIN
    SELECT stock INTO v_current_stock
    FROM public.products
    WHERE id = p_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT p_product_id, 0, 0, false, 'Product not found'::TEXT;
        RETURN;
    END IF;

    UPDATE public.products
    SET stock = v_current_stock + p_quantity,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_product_id;

    RETURN QUERY SELECT p_product_id, v_current_stock, v_current_stock + p_quantity, true, 'Stock restored successfully'::TEXT;
END;
$$;
