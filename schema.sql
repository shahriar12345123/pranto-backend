-- ==============================================================================
-- GAZET E-COMMERCE COMPLETE DATABASE SCHEMA (SUPABASE POSTGRESQL)
-- Includes: Products, Profiles, User Logins, Delivery Locations, Cart Items,
--           Orders (COD + bKash/Nagad/Rocket Manual Payments), Order Items,
--           Admin Audit Logs, Store Settings, Triggers & RLS Policies.
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- 1. PRODUCTS TABLE
-- Stores catalog products, stock levels, pricing, Cloudflare R2 images, and specs
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
-- Stores user sign-up information, phone, role, full address, and login history
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
    user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_logins_user_id ON public.user_logins (user_id);
CREATE INDEX IF NOT EXISTS idx_user_logins_login_timestamp ON public.user_logins (login_timestamp DESC);

ALTER TABLE public.user_logins ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_logins' AND policyname = 'Users can view their own login history') THEN
        CREATE POLICY "Users can view their own login history" ON public.user_logins FOR SELECT USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_logins' AND policyname = 'Allow insertion of login logs') THEN
        CREATE POLICY "Allow insertion of login logs" ON public.user_logins FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_logins' AND policyname = 'Allow backend full access to logins') THEN
        CREATE POLICY "Allow backend full access to logins" ON public.user_logins FOR ALL USING (true);
    END IF;
END $$;


-- ==============================================================================
-- 4. DELIVERY LOCATIONS TABLE
-- Saved shipping addresses for registered customers
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.delivery_locations (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    label TEXT DEFAULT 'Home',
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    district TEXT,
    division TEXT,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_delivery_locations_user_id ON public.delivery_locations (user_id);

ALTER TABLE public.delivery_locations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'delivery_locations' AND policyname = 'Users manage their saved locations') THEN
        CREATE POLICY "Users manage their saved locations" ON public.delivery_locations FOR ALL USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'delivery_locations' AND policyname = 'Allow backend full access to locations') THEN
        CREATE POLICY "Allow backend full access to locations" ON public.delivery_locations FOR ALL USING (true);
    END IF;
END $$;


-- ==============================================================================
-- 5. CART ITEMS TABLE
-- Stores guest and logged-in user shopping cart states
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.cart_items (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id TEXT,
    product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    selected_color TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_cart_items_user_id ON public.cart_items (user_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_session_id ON public.cart_items (session_id);

ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cart_items' AND policyname = 'Users manage their cart items') THEN
        CREATE POLICY "Users manage their cart items" ON public.cart_items FOR ALL USING (auth.uid() = user_id OR session_id IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cart_items' AND policyname = 'Allow backend full access to cart_items') THEN
        CREATE POLICY "Allow backend full access to cart_items" ON public.cart_items FOR ALL USING (true);
    END IF;
END $$;


-- ==============================================================================
-- 6. ORDERS TABLE
-- Stores customer checkout orders across all 64 districts in Bangladesh
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.orders (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT,
    delivery_address TEXT NOT NULL,
    district TEXT NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cod', 'bkash', 'nagad', 'rocket')),
    payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'pending_verification', 'paid', 'rejected')),
    order_status TEXT NOT NULL DEFAULT 'pending' CHECK (order_status IN ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled')),
    transaction_id TEXT,
    sender_number TEXT,
    delivery_payment_service TEXT,
    subtotal NUMERIC(10, 2) NOT NULL,
    delivery_fee NUMERIC(10, 2) NOT NULL,
    total_amount NUMERIC(10, 2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON public.orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON public.orders (customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_order_status ON public.orders (order_status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders (payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders (created_at DESC);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'orders' AND policyname = 'Users can view their own orders') THEN
        CREATE POLICY "Users can view their own orders" ON public.orders FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'orders' AND policyname = 'Anyone can create an order') THEN
        CREATE POLICY "Anyone can create an order" ON public.orders FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'orders' AND policyname = 'Allow backend full access to orders') THEN
        CREATE POLICY "Allow backend full access to orders" ON public.orders FOR ALL USING (true);
    END IF;
END $$;


-- ==============================================================================
-- 7. ORDER ITEMS TABLE
-- Line items included inside each customer order
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES public.products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    product_image TEXT,
    unit_price NUMERIC(10, 2) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    subtotal NUMERIC(10, 2) NOT NULL,
    selected_color TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON public.order_items (product_id);

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'order_items' AND policyname = 'Users can view order items for their orders') THEN
        CREATE POLICY "Users can view order items for their orders" ON public.order_items FOR SELECT USING (
            EXISTS (SELECT 1 FROM public.orders WHERE public.orders.id = public.order_items.order_id AND (public.orders.user_id = auth.uid() OR public.orders.user_id IS NULL))
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'order_items' AND policyname = 'Anyone can create order items') THEN
        CREATE POLICY "Anyone can create order items" ON public.order_items FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'order_items' AND policyname = 'Allow backend full access to order_items') THEN
        CREATE POLICY "Allow backend full access to order_items" ON public.order_items FOR ALL USING (true);
    END IF;
END $$;


-- ==============================================================================
-- 8. ADMIN AUDIT LOGS TABLE
-- Records privileged administrative actions
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

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'admin_audit_logs' AND policyname = 'Allow backend full access to audit logs') THEN
        CREATE POLICY "Allow backend full access to audit logs" ON public.admin_audit_logs FOR ALL USING (true);
    END IF;
END $$;


-- ==============================================================================
-- 9. STORE SETTINGS TABLE
-- Central configuration for delivery charges and payment gateway accounts
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

INSERT INTO public.store_settings (key, value, description)
VALUES 
    ('delivery', '{"insideDhaka": 70, "outsideDhaka": 130}'::jsonb, 'Standard delivery charges in BDT across Bangladesh'),
    ('payment_accounts', '{"bkash": "01611521209", "nagad": "01342250023", "rocket": "016115212098"}'::jsonb, 'Personal payment account numbers'),
    ('inventory', '{"lowStockThreshold": 5}'::jsonb, 'Threshold for low stock warnings')
ON CONFLICT (key) DO NOTHING;
