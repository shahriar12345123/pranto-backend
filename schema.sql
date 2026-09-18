-- ==============================================================================
-- GAZET E-COMMERCE DATABASE SCHEMA (SUPABASE POSTGRESQL)
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
    specifications JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read products" ON public.products
    FOR SELECT USING (true);

CREATE POLICY "Allow anon insert products for initial setup" ON public.products
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow anon update products" ON public.products
    FOR UPDATE USING (true);

CREATE POLICY "Allow anon delete products" ON public.products
    FOR DELETE USING (true);


-- ==============================================================================
-- 2. USER PROFILES TABLE
-- Stores user sign-up information, phone, role, avatar, and last login timestamp
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    email TEXT,
    phone TEXT,
    role TEXT DEFAULT 'customer',
    avatar_url TEXT,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Allow profile creation on signup" ON public.profiles
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public read of profiles for backend" ON public.profiles
    FOR ALL USING (true);


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

ALTER TABLE public.user_logins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own login logs" ON public.user_logins
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Allow inserting login logs" ON public.user_logins
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow reading login logs" ON public.user_logins
    FOR SELECT USING (true);


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

ALTER TABLE public.delivery_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own delivery locations" ON public.delivery_locations
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Allow backend access to delivery locations" ON public.delivery_locations
    FOR ALL USING (true);


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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(user_id, product_id)
);

ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own cart items" ON public.cart_items
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Allow backend access to cart items" ON public.cart_items
    FOR ALL USING (true);


-- ==============================================================================
-- 6. ORDERS TABLE
-- Master orders table storing customer info, delivery location, totals, and status
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.orders (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT,
    division TEXT NOT NULL,
    district TEXT NOT NULL,
    area TEXT,
    delivery_address TEXT NOT NULL,
    postal_code TEXT,
    order_notes TEXT,
    subtotal NUMERIC(10, 2) NOT NULL,
    delivery_charge NUMERIC(10, 2) NOT NULL DEFAULT 70,
    total_amount NUMERIC(10, 2) NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cod',
    payment_status TEXT NOT NULL DEFAULT 'pending',
    order_status TEXT NOT NULL DEFAULT 'pending',
    customer_data JSONB,
    items_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own orders" ON public.orders
    FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Anyone can insert orders" ON public.orders
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow backend full access to orders" ON public.orders
    FOR ALL USING (true);


-- ==============================================================================
-- 7. ORDER ITEMS TABLE
-- Stores individual line items for every placed order with exact purchased quantities
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view order items of their orders" ON public.order_items
    FOR SELECT USING (true);

CREATE POLICY "Allow inserting order items" ON public.order_items
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow backend access to order items" ON public.order_items
    FOR ALL USING (true);


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

ALTER TABLE public.user_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own activity timeline" ON public.user_activities
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Allow inserting user activities" ON public.user_activities
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow backend full access to user activities" ON public.user_activities
    FOR ALL USING (true);


-- ==============================================================================
-- 9. POSTGRESQL FUNCTION FOR ATOMIC EXACT STOCK DEDUCTION
-- Deducts exact quantity ordered from product stock and prevents negative stock
-- ==============================================================================
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
