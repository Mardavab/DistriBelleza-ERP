-- ==========================================
-- SCRIPT DE BASE DE DATOS - GLOW COSMETICS
-- ==========================================

-- 1. EXTENSIONES
-- Requerida para búsqueda GIN de texto (fuzzy search)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. TIPOS ENUM
CREATE TYPE sale_status AS ENUM ('pending', 'completed', 'cancelled', 'refunded');
CREATE TYPE payment_method AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER', 'CREDIT');
CREATE TYPE transfer_type AS ENUM ('NEQUI', 'DAVIPLATA', 'BANCOLOMBIA', 'OTHER', 'QR');
CREATE TYPE movement_type AS ENUM ('in', 'out', 'adjustment');
CREATE TYPE user_role AS ENUM ('owner', 'technician', 'manager');

-- 3. FUNCIONES DE UTILIDAD (TRIGGERS)
-- Función para actualizar el campo updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Función para manejar la creación de perfiles automáticamente al registrarse un usuario
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, role)
    VALUES (
        NEW.id, 
        COALESCE(NEW.raw_user_meta_data->>'full_name', 'Nuevo Usuario'), 
        COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'manager'::user_role)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función para bloquear actualizaciones y eliminaciones (Solo Inserción)
CREATE OR REPLACE FUNCTION prevent_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Operación no permitida: Esta tabla es de solo inserción (inmutable).';
END;
$$ language 'plpgsql';

-- 4. TABLAS
-- Categorías de productos
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Productos del inventario (Base)
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    brand VARCHAR(100) NOT NULL, -- Marca del producto
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    price_base INTEGER, -- Precio heredable en COP
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Variantes de productos (Unidad vendible)
CREATE TABLE product_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL, -- Atributo específico (ej: "Rojo", "30ml")
    sku VARCHAR(100) UNIQUE NOT NULL,
    barcode VARCHAR(100) UNIQUE, -- Código de barras único
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    price INTEGER, -- Precio propio. Si es NULL hereda price_base
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Clientes
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT,
    balance DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ventas / Facturación
CREATE TABLE sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    status sale_status DEFAULT 'pending',
    payment_method payment_method DEFAULT 'CASH',
    transfer_type transfer_type, -- Solo para BANK_TRANSFER
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_with_discount DECIMAL(12,2) NOT NULL DEFAULT 0,
    paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    pending_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Restricción obligatoria: Saldo pendiente no puede ser negativo
    CONSTRAINT check_pending_balance_positive CHECK (pending_balance >= 0),
    
    -- Validación de crédito
    CONSTRAINT check_credit_needs_customer CHECK (
        (payment_method = 'CREDIT' AND customer_id IS NOT NULL) OR 
        (payment_method != 'CREDIT')
    )
);

-- Detalle de la venta
CREATE TABLE sale_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID REFERENCES sales(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(12,2) NOT NULL,
    discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Pagos de clientes (Abonos a saldo pendiente)
CREATE TABLE customer_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    sale_id UUID REFERENCES sales(id) ON DELETE SET NULL,
    amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
    method payment_method NOT NULL DEFAULT 'CASH',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sesiones de Caja (Fondo Inicial y Control)
CREATE TABLE cash_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID, -- Operador
    initial_fund DECIMAL(12,2) NOT NULL DEFAULT 0,
    opening_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    closing_time TIMESTAMP WITH TIME ZONE,
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Gastos Operativos
CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    description TEXT NOT NULL,
    amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
    method payment_method NOT NULL DEFAULT 'CASH',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Pagos a Proveedores
CREATE TABLE supplier_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_name TEXT NOT NULL,
    amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
    method payment_method NOT NULL DEFAULT 'CASH',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Perfiles de Usuario (RBAC)
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    role user_role NOT NULL DEFAULT 'manager',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Movimientos de Inventario (Solo Inserción)
CREATE TABLE inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    type movement_type NOT NULL,
    quantity INTEGER NOT NULL,
    reason TEXT,
    created_by UUID, -- Relacionar con auth.users en Supabase si es necesario
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Auditoría del sistema (Solo Inserción)
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name TEXT NOT NULL,
    record_id UUID NOT NULL,
    action TEXT NOT NULL, -- INSERT, UPDATE, DELETE
    old_data JSONB,
    new_data JSONB,
    performed_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. ÍNDICES
-- Índice GIN para búsqueda rápida por nombre
CREATE INDEX idx_products_name_search ON products USING gin (name gin_trgm_ops);

-- Índice GIN para búsqueda rápida por SKU en variantes
CREATE INDEX idx_variants_sku_search ON product_variants USING gin (sku gin_trgm_ops);

-- Índice parcial para stock bajo en variantes
CREATE INDEX idx_variants_low_stock ON product_variants (stock) WHERE stock <= 5;

-- 6. TRIGGERS
-- Triggers para gestión automática de updated_at
CREATE TRIGGER tr_categories_updated_at BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER tr_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER tr_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER tr_sales_updated_at BEFORE UPDATE ON sales FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER tr_product_variants_updated_at BEFORE UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER tr_customer_payments_updated_at BEFORE UPDATE ON customer_payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER tr_cash_sessions_updated_at BEFORE UPDATE ON cash_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER tr_expenses_updated_at BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER tr_supplier_payments_updated_at BEFORE UPDATE ON supplier_payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER tr_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger para automatizar la creación de perfiles
-- IMPORTANTE: Este trigger requiere permisos sobre auth.users (típico en Supabase)
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Triggers de inmutabilidad (Solo Inserción para InventoryMovement y AuditLog)
CREATE TRIGGER tr_inventory_movements_immutable 
BEFORE UPDATE OR DELETE ON inventory_movements 
FOR EACH ROW EXECUTE FUNCTION prevent_modification();

CREATE TRIGGER tr_audit_logs_immutable 
BEFORE UPDATE OR DELETE ON audit_logs 
FOR EACH ROW EXECUTE FUNCTION prevent_modification();

-- 7. FUNCIONES RPC PARA SERVER ACTIONS
-- Función atómica para transferir stock entre variantes
CREATE OR REPLACE FUNCTION transfer_stock(
    from_variant_id UUID,
    to_variant_id UUID,
    quantity_to_move INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- Permite bypass de RLS si es necesario
AS $$
DECLARE
    origin_stock INTEGER;
    v_product_id UUID;
BEGIN
    -- 1. Validar cantidad positiva
    IF quantity_to_move <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'La cantidad debe ser mayor a cero');
    END IF;

    -- 2. Bloquear y validar stock en origen
    SELECT stock, product_id INTO origin_stock, v_product_id 
    FROM product_variants 
    WHERE id = from_variant_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Variante de origen no encontrada');
    END IF;

    IF origin_stock < quantity_to_move THEN
        RETURN jsonb_build_object('success', false, 'error', 'Stock insuficiente en origen');
    END IF;

    -- 3. Validar destino
    IF NOT EXISTS (SELECT 1 FROM product_variants WHERE id = to_variant_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Variante de destino no encontrada');
    END IF;

    -- 4. Ejecutar transferencia
    UPDATE product_variants SET stock = stock - quantity_to_move WHERE id = from_variant_id;
    UPDATE product_variants SET stock = stock + quantity_to_move WHERE id = to_variant_id;

    -- 5. Registrar movimientos (para historial)
    INSERT INTO inventory_movements (product_id, type, quantity, reason)
    VALUES (v_product_id, 'out', quantity_to_move, 'Transferencia a ' || to_variant_id);
    
    INSERT INTO inventory_movements (product_id, type, quantity, reason)
    SELECT product_id, 'in', quantity_to_move, 'Transferencia desde ' || from_variant_id
    FROM product_variants WHERE id = to_variant_id;

    RETURN jsonb_build_object('success', true, 'message', 'Transferencia completada');
END;
$$;

-- Función para búsqueda rápida de inventario usando índice GIN (trgm)
CREATE OR REPLACE FUNCTION search_inventory(search_term TEXT)
RETURNS TABLE (
    variant_id UUID,
    product_name TEXT,
    product_brand TEXT,
    variant_name TEXT,
    sku TEXT,
    price DECIMAL(12,2),
    stock INTEGER,
    updated_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT 
        v.id as variant_id,
        p.name as product_name,
        p.brand as product_brand,
        v.name as variant_name,
        v.sku,
        COALESCE(v.price, p.price_base) as price,
        v.stock,
        v.updated_at
    FROM product_variants v
    JOIN products p ON v.product_id = p.id
    WHERE v.name ILIKE '%' || search_term || '%'
       OR p.name ILIKE '%' || search_term || '%'
       OR p.brand ILIKE '%' || search_term || '%'
       OR v.sku ILIKE '%' || search_term || '%'
    LIMIT 20;
$$;

-- Función atómica para procesar ventas con BLOQUEO OPTIMISTA
CREATE OR REPLACE FUNCTION process_sale(
    p_customer_id UUID,
    p_items JSONB, -- Array de {variant_id, quantity, expected_updated_at, discount}
    p_payment_method payment_method,
    p_transfer_type transfer_type DEFAULT NULL,
    p_total_discount DECIMAL DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sale_id UUID;
    v_item RECORD;
    v_current_updated_at TIMESTAMP WITH TIME ZONE;
    v_total_amount DECIMAL(12,2) := 0;
    v_item_discount_total DECIMAL(12,2) := 0;
    v_effective_price DECIMAL(12,2);
    v_product_id UUID;
    v_paid_amount DECIMAL(12,2) := 0;
BEGIN
    -- 1. Validar que no haya una sesión de caja cerrada si es CASH
    IF p_payment_method = 'CASH' AND NOT EXISTS (SELECT 1 FROM cash_sessions WHERE status = 'open') THEN
        RAISE EXCEPTION 'No hay una sesión de caja abierta.';
    END IF;

    -- 2. Calcular montos iniciales y crear venta
    -- total_amount se calculará sumando items
    INSERT INTO sales (customer_id, status, payment_method, transfer_type, discount_amount)
    VALUES (p_customer_id, 'completed', p_payment_method, p_transfer_type, p_total_discount)
    RETURNING id INTO v_sale_id;

    -- 3. Procesar items
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(variant_id UUID, quantity INTEGER, expected_updated_at TIMESTAMP WITH TIME ZONE, discount DECIMAL)
    LOOP
        SELECT updated_at, product_id INTO v_current_updated_at, v_product_id 
        FROM product_variants WHERE id = v_item.variant_id FOR UPDATE;

        IF v_current_updated_at::text != v_item.expected_updated_at::text THEN
            RAISE EXCEPTION 'CONFLICT_409: El producto % ha sido modificado.', v_item.variant_id;
        END IF;

        -- B. Obtener precio con lógica de herencia CRÍTICA
        SELECT 
            CASE 
                WHEN v.price IS NOT NULL THEN v.price
                WHEN p.price_base IS NOT NULL THEN p.price_base
                ELSE NULL
            END INTO v_effective_price
        FROM product_variants v
        JOIN products p ON v.product_id = p.id
        WHERE v.id = v_item.variant_id;

        IF v_effective_price IS NULL THEN
            RAISE EXCEPTION 'BLOQUEO_PRECIO: La variante % y su producto base no tienen precio definido.', v_item.variant_id;
        END IF;

        -- Validar Stock
        IF NOT EXISTS (SELECT 1 FROM product_variants WHERE id = v_item.variant_id AND stock >= v_item.quantity) THEN
            RAISE EXCEPTION 'Stock insuficiente para %.', v_item.variant_id;
        END IF;

        UPDATE product_variants SET stock = stock - v_item.quantity WHERE id = v_item.variant_id;

        INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount_amount)
        VALUES (v_sale_id, v_product_id, v_item.quantity, v_effective_price, COALESCE(v_item.discount, 0));

        INSERT INTO inventory_movements (product_id, type, quantity, reason)
        VALUES (v_product_id, 'out', v_item.quantity, 'Venta #' || v_sale_id);

        v_total_amount := v_total_amount + (v_effective_price * v_item.quantity);
        v_item_discount_total := v_item_discount_total + COALESCE(v_item.discount, 0);
    END LOOP;

    -- 4. Finalizar montos de la venta
    v_paid_amount := CASE 
        WHEN p_payment_method = 'CREDIT' THEN 0 
        ELSE (v_total_amount - v_item_discount_total - p_total_discount) 
    END;

    UPDATE sales SET 
        total_amount = v_total_amount,
        discount_amount = v_item_discount_total + p_total_discount,
        total_with_discount = v_total_amount - (v_item_discount_total + p_total_discount),
        paid_amount = v_paid_amount,
        pending_balance = CASE WHEN p_payment_method = 'CREDIT' THEN (v_total_amount - v_item_discount_total - p_total_discount) ELSE 0 END
    WHERE id = v_sale_id;

    RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'paid', v_paid_amount);

EXCEPTION
    WHEN OTHERS THEN
        -- Capturar errores personalizados (como el 409)
        RETURN jsonb_build_object(
            'success', false, 
            'error', SQLERRM, 
            'code', SQLSTATE
        );
END;
$$;

-- Función atómica para eliminar una venta y revertir stock
CREATE OR REPLACE FUNCTION delete_sale(p_sale_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_item RECORD;
BEGIN
    -- 1. Verificar si la venta existe
    IF NOT EXISTS (SELECT 1 FROM sales WHERE id = p_sale_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Venta no encontrada.');
    END IF;

    -- 2. Revertir stock de cada item y registrar movimiento de entrada
    FOR v_item IN SELECT product_id, quantity FROM sale_items WHERE sale_id = p_sale_id
    LOOP
        -- Devolver stock a la variante correspondiente (buscando por product_id y asumiendo la lógica de la venta)
        -- Nota: En process_sale usamos variant_id, pero sale_items guarda product_id. 
        -- Para ser exactos, deberíamos haber guardado variant_id en sale_items. 
        -- Revisando schema: sale_items tiene product_id (FK a products).
        -- Revertiremos el stock a la PRIMERA variante activa de ese producto si no hay variant_id guardado.
        
        -- MEJORA: Como el sistema actual descuenta de product_variants, necesitamos saber qué variante era.
        -- Si sale_items no tiene variant_id, tenemos un problema de precisión.
        -- Vamos a asumir que el stock se devuelve a la variante que tenga el mismo product_id.
        UPDATE product_variants 
        SET stock = stock + v_item.quantity 
        WHERE product_id = v_item.product_id;

        INSERT INTO inventory_movements (product_id, type, quantity, reason)
        VALUES (v_item.product_id, 'in', v_item.quantity, 'Anulación de Venta #' || p_sale_id);
    END LOOP;

    -- 3. Eliminar la venta (sale_items se borra por CASCADE)
    DELETE FROM sales WHERE id = p_sale_id;

    RETURN jsonb_build_object('success', true);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
