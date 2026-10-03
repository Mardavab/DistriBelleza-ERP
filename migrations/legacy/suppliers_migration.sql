-- ==========================================
-- MÓDULO DE PROVEEDORES - DistriBelleza
-- Ejecutar en Supabase SQL Editor
-- ==========================================

-- 1. Tabla de Proveedores
CREATE TABLE IF NOT EXISTS suppliers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(200) NOT NULL,
    phone       TEXT,
    email       TEXT,
    address     TEXT,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Tabla de Facturas de Proveedores
CREATE TYPE IF NOT EXISTS invoice_status AS ENUM ('pending', 'paid', 'overdue', 'cancelled');

CREATE TABLE IF NOT EXISTS supplier_invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id     UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    invoice_number  VARCHAR(100),                      -- N° de factura (opcional)
    issue_date      DATE NOT NULL,                     -- Fecha de expedición
    due_date        DATE NOT NULL,                     -- Fecha de vencimiento
    amount          DECIMAL(14,2) NOT NULL CHECK (amount > 0),
    paid_amount     DECIMAL(14,2) NOT NULL DEFAULT 0,  -- Total abonado
    status          invoice_status NOT NULL DEFAULT 'pending',
    description     TEXT,                              -- Descripción opcional
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Si ya creaste la tabla sin paid_amount, ejecuta esto:
-- ALTER TABLE supplier_invoices ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(14,2) NOT NULL DEFAULT 0;

-- 3. Triggers de updated_at
CREATE TRIGGER tr_suppliers_updated_at
    BEFORE UPDATE ON suppliers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER tr_supplier_invoices_updated_at
    BEFORE UPDATE ON supplier_invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4. Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers (name);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_supplier ON supplier_invoices (supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_due ON supplier_invoices (due_date);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_status ON supplier_invoices (status);

-- 5. Row Level Security (RLS) — ajustar según tu política de Supabase
ALTER TABLE suppliers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoices  ENABLE ROW LEVEL SECURITY;

-- Política: usuarios autenticados pueden leer y escribir
CREATE POLICY "authenticated_full_access_suppliers"
    ON suppliers FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "authenticated_full_access_invoices"
    ON supplier_invoices FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
