-- ==============================================================================
-- Migration: Add transaction_id & Manual Payment Support to public.orders
-- Run this script in the Supabase SQL Editor
-- ==============================================================================

-- 1. Add missing columns safely if they do not exist
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS transaction_id TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS subtotal NUMERIC(10, 2);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_charge NUMERIC(10, 2) DEFAULT 70;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS total_amount NUMERIC(10, 2);

-- 2. Drop existing restrictive check constraints if present
DO $$
BEGIN
    ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
    ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
    ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_order_status_check;
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

-- 3. Add updated check constraints
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_method_check 
    CHECK (payment_method IN ('cod', 'bkash', 'nagad', 'rocket'));

ALTER TABLE public.orders ADD CONSTRAINT orders_payment_status_check 
    CHECK (payment_status IN ('unpaid', 'pending_verification', 'paid', 'rejected', 'pending'));

ALTER TABLE public.orders ADD CONSTRAINT orders_order_status_check 
    CHECK (order_status IN ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled'));

-- 4. Create performance indexes for search and future Admin Panel queries
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON public.orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_payment_method ON public.orders (payment_method);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders (payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_transaction_id ON public.orders (transaction_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders (created_at DESC);
