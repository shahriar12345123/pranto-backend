-- ==============================================================================
-- GAZET E-COMMERCE COMPLETE DATABASE SCHEMA (SUPABASE POSTGRESQL)
-- Includes: Products, Profiles, User Logins, Delivery Locations, Cart Items,
--           Orders (COD + bKash/Nagad/Rocket Manual Payments), Order Items,
--           User Activities Timeline, Atomic Stock Deduction & RLS Policies.
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- 1. PRODUCTS TABLE
-- Stores catalog products, stock levels, pricing, Cloudflare R2 images, colors, and specs
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    sku TEXT UNIQUE,
    category TEXT NOT NULL DEFAULT 'wireless-earbuds',
    brand TEXT NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    compare_price NUMERIC(10, 2),
    discount INTEGER DEFAULT 0,
    rating NUMERIC(3, 1) DEFAULT 0,
    review_count INTEGER DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    featured BOOLEAN DEFAULT false,
    best_selling BOOLEAN DEFAULT false,
    short_description TEXT,
    description TEXT,
    images JSONB DEFAULT '[]'::jsonb,
    colors JSONB DEFAULT '[]'::jsonb,
    specifications JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS colors JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'products' AND policyname = 'Anyone can read products') THEN
        CREATE POLICY "Anyone can read products" ON public.products FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'products' AND policyname = 'Allow anon insert products for initial setup') THEN
        CREATE POLICY "Allow anon insert products for initial setup" ON public.products FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'products' AND policyname = 'Allow anon update products') THEN
        CREATE POLICY "Allow anon update products" ON public.products FOR UPDATE USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'products' AND policyname = 'Allow anon delete products') THEN
        CREATE POLICY "Allow anon delete products" ON public.products FOR DELETE USING (true);
    END IF;
END $$;


-- ==============================================================================
-- 2. USER PROFILES TABLE
-- Stores user sign-up information, phone, role, full address, avatar, and last login timestamp
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    email TEXT,
    phone TEXT,
    role TEXT DEFAULT 'customer',
    avatar_url TEXT,
    full_address TEXT,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_address TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'customer';

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can view their own profile') THEN
        CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can update their own profile') THEN
        CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Allow profile creation on signup') THEN
        CREATE POLICY "Allow profile creation on signup" ON public.profiles FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Allow public read of profiles for backend') THEN
        CREATE POLICY "Allow public read of profiles for backend" ON public.profiles FOR ALL USING (true);
    END IF;
END $$;


-- ==============================================================================
-- 3. USER LOGINS (AUTH LOGS) TABLE
-- Records every login timestamp, IP address, user agent, and authentication method
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.user_logins (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    login_timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    ip_address TEXT,
    user_agent TEXT,
    auth_provider TEXT DEFAULT 'email'
);

CREATE INDEX IF NOT EXISTS idx_user_logins_user_id ON public.user_logins (user_id);
CREATE INDEX IF NOT EXISTS idx_user_logins_login_timestamp ON public.user_logins (login_timestamp DESC);

ALTER TABLE public.user_logins ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_logins' AND policyname = 'Users can view their own login logs') THEN
        CREATE POLICY "Users can view their own login logs" ON public.user_logins FOR SELECT USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_logins' AND policyname = 'Allow inserting login logs') THEN
        CREATE POLICY "Allow inserting login logs" ON public.user_logins FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_logins' AND policyname = 'Allow reading login logs') THEN
        CREATE POLICY "Allow reading login logs" ON public.user_logins FOR SELECT USING (true);
    END IF;
END $$;


-- ==============================================================================
-- 4. DELIVERY LOCATIONS (SAVED ADDRESSES) TABLE
-- Stores customer shipping addresses, districts, areas, and default flags
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.delivery_locations (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    division TEXT NOT NULL,
    district TEXT NOT NULL,
    area TEXT,
    address TEXT NOT NULL,
    postal_code TEXT,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_delivery_locations_user_id ON public.delivery_locations (user_id);

ALTER TABLE public.delivery_locations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'delivery_locations' AND policyname = 'Users can manage their own delivery locations') THEN
        CREATE POLICY "Users can manage their own delivery locations" ON public.delivery_locations FOR ALL USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'delivery_locations' AND policyname = 'Allow backend access to delivery locations') THEN
        CREATE POLICY "Allow backend access to delivery locations" ON public.delivery_locations FOR ALL USING (true);
    END IF;
END $$;


-- ==============================================================================
-- 5. CART ITEMS TABLE
-- Stores items added to users' carts in real-time
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.cart_items (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    product_data JSONB NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    selected_color TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_cart_items_user_id ON public.cart_items (user_id);

ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cart_items' AND policyname = 'Users can manage their own cart items') THEN
        CREATE POLICY "Users can manage their own cart items" ON public.cart_items FOR ALL USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cart_items' AND policyname = 'Allow backend access to cart items') THEN
        CREATE POLICY "Allow backend access to cart items" ON public.cart_items FOR ALL USING (true);
    END IF;
END $$;


-- ==============================================================================
-- 6. ORDERS TABLE
-- Master orders table storing customer info, delivery location, totals, 
-- payment methods (COD, bKash, Nagad, Rocket), Transaction IDs, and payment status
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.orders (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT,
    division TEXT NOT NULL DEFAULT 'Dhaka',
    district TEXT NOT NULL,
    area TEXT,
    delivery_address TEXT NOT NULL,
    postal_code TEXT,
    order_notes TEXT,
    subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0,
    delivery_charge NUMERIC(10, 2) NOT NULL DEFAULT 70,
    total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'cod',
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    transaction_id TEXT,
    sender_number TEXT,
    delivery_payment_service TEXT,
    order_status TEXT NOT NULL DEFAULT 'pending',
    customer_data JSONB,
    items_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Ensure all columns exist even if table was created in an earlier migration
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS transaction_id TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS sender_number TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS subtotal NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_charge NUMERIC(10, 2) DEFAULT 70;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS total_amount NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_data JSONB;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS items_data JSONB;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_payment_service TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS division TEXT DEFAULT 'Dhaka';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS area TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS postal_code TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_notes TEXT;

-- Safely update check constraints
DO $$ BEGIN
    ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
    ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
    ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_order_status_check;
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.orders ADD CONSTRAINT orders_payment_method_check 
    CHECK (payment_method IN ('cod', 'bkash', 'nagad', 'rocket'));

ALTER TABLE public.orders ADD CONSTRAINT orders_payment_status_check 
    CHECK (payment_status IN ('unpaid', 'pending_verification', 'paid', 'rejected', 'pending'));

ALTER TABLE public.orders ADD CONSTRAINT orders_order_status_check 
    CHECK (order_status IN ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled'));

-- Performance indexes for queries and future Admin Panel lookups
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON public.orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON public.orders (customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_payment_method ON public.orders (payment_method);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders (payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_transaction_id ON public.orders (transaction_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders (created_at DESC);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'orders' AND policyname = 'Users can view their own orders') THEN
        CREATE POLICY "Users can view their own orders" ON public.orders FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'orders' AND policyname = 'Anyone can insert orders') THEN
        CREATE POLICY "Anyone can insert orders" ON public.orders FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'orders' AND policyname = 'Allow backend full access to orders') THEN
        CREATE POLICY "Allow backend full access to orders" ON public.orders FOR ALL USING (true);
    END IF;
END $$;


-- ==============================================================================
-- 7. ORDER ITEMS TABLE
-- Stores individual line items for every placed order with exact purchased quantities & selected color
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    product_name TEXT NOT NULL,
    product_sku TEXT,
    product_image TEXT,
    unit_price NUMERIC(10, 2) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    subtotal NUMERIC(10, 2) NOT NULL,
    selected_color TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS selected_color TEXT;

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON public.order_items (product_id);

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'order_items' AND policyname = 'Users can view order items of their orders') THEN
        CREATE POLICY "Users can view order items of their orders" ON public.order_items FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'order_items' AND policyname = 'Allow inserting order items') THEN
        CREATE POLICY "Allow inserting order items" ON public.order_items FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'order_items' AND policyname = 'Allow backend access to order items') THEN
        CREATE POLICY "Allow backend access to order items" ON public.order_items FOR ALL USING (true);
    END IF;
END $$;


-- ==============================================================================
-- 8. USER ACTIVITIES TABLE
-- Comprehensive timeline audit log for all user actions (signups, logins, cart, orders)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.user_activities (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id TEXT,
    activity_type TEXT NOT NULL,
    description TEXT,
    ip_address TEXT,
    user_agent TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_user_activities_user_id ON public.user_activities (user_id);
CREATE INDEX IF NOT EXISTS idx_user_activities_created_at ON public.user_activities (created_at DESC);

ALTER TABLE public.user_activities ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_activities' AND policyname = 'Users can view their own activity timeline') THEN
        CREATE POLICY "Users can view their own activity timeline" ON public.user_activities FOR SELECT USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_activities' AND policyname = 'Allow inserting user activities') THEN
        CREATE POLICY "Allow inserting user activities" ON public.user_activities FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_activities' AND policyname = 'Allow backend full access to user activities') THEN
        CREATE POLICY "Allow backend full access to user activities" ON public.user_activities FOR ALL USING (true);
    END IF;
END $$;


-- ==============================================================================
-- 9. POSTGRESQL FUNCTIONS FOR ATOMIC EXACT STOCK DEDUCTION & RESTORATION
-- ==============================================================================

-- 9a. Atomic Stock Deduction Function
CREATE OR REPLACE FUNCTION public.deduct_product_stock(
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

    IF v_current_stock < p_quantity THEN
        RETURN QUERY SELECT p_product_id, v_current_stock, v_current_stock, false, 'Insufficient stock'::TEXT;
        RETURN;
    END IF;

    UPDATE public.products
    SET stock = v_current_stock - p_quantity,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_product_id;

    RETURN QUERY SELECT p_product_id, v_current_stock, v_current_stock - p_quantity, true, 'Stock deducted successfully'::TEXT;
END;
$$;

-- 9b. Atomic Stock Restoration Function (for order cancellation)
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


-- ==============================================================================
-- 10. ADMIN AUDIT LOGS TABLE
-- Records every privileged administrative operation for accountability and tracking
-- ==============================================================================
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


-- ==============================================================================
-- 11. STORE SETTINGS TABLE
-- Central configuration table for dynamic delivery charges, payment accounts, etc.
-- Allows controlling store settings directly from the Admin Panel
-- ==============================================================================
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

-- Seed default store settings if not exist
INSERT INTO public.store_settings (key, value, description)
VALUES 
    ('delivery', '{"insideDhaka": 70, "outsideDhaka": 130}'::jsonb, 'Standard delivery charges in BDT across Bangladesh'),
    ('payment_accounts', '{"bkash": "01611521209", "nagad": "01342250023", "rocket": "016115212098"}'::jsonb, 'Personal payment account numbers for manual payments'),
    ('inventory', '{"lowStockThreshold": 5}'::jsonb, 'Threshold below which a product is flagged as low stock'),
    ('contact', '{"phone": "01611521209", "email": "friendsshop470@gmail.com", "address": "Postal Code : 2240 Bhaluka, Mymensingh", "facebook": "https://www.facebook.com/friendsgazetteshop"}'::jsonb, 'Official store contact details')
ON CONFLICT (key) DO NOTHING;
