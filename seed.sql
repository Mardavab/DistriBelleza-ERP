-- ==========================================
-- SEED DATA FINAL CORREGIDO - GLOW COSMETICS
-- ==========================================

-- 1. LIMPIEZA PREVIA (Opcional, para evitar duplicados en pruebas)
-- TRUNCATE categories, products, product_variants, customers, expenses CASCADE;

-- 2. CATEGORÍAS
INSERT INTO categories (id, name, description) VALUES
(gen_random_uuid(), 'Capilar', 'Shampoo, tratamientos y cuidado del cabello'),
(gen_random_uuid(), 'Facial', 'Productos para el cuidado facial'),
(gen_random_uuid(), 'Corporal', 'Cuidado corporal y exfoliantes'),
(gen_random_uuid(), 'Barbería', 'Productos para hombre y barbería'),
(gen_random_uuid(), 'Manicure y Uñas', 'Esmaltes y cuidado de uñas'),
(gen_random_uuid(), 'Tintes y Coloración', 'Tintes y oxidantes')
ON CONFLICT (name) DO NOTHING;

-- 3. PRODUCTOS Y VARIANTES
DO $$
DECLARE
    cat_capilar UUID;
    cat_facial UUID;
    cat_corporal UUID;
    cat_barberia UUID;
    cat_unas UUID;
    cat_color UUID;
    v_prod_id UUID;
BEGIN
    -- Obtener IDs de categorías
    SELECT id INTO cat_capilar FROM categories WHERE name = 'Capilar';
    SELECT id INTO cat_facial FROM categories WHERE name = 'Facial';
    SELECT id INTO cat_corporal FROM categories WHERE name = 'Corporal';
    SELECT id INTO cat_barberia FROM categories WHERE name = 'Barbería';
    SELECT id INTO cat_unas FROM categories WHERE name = 'Manicure y Uñas';
    SELECT id INTO cat_color FROM categories WHERE name = 'Tintes y Coloración';

    -- ==========================================
    -- CAPILAR
    -- ==========================================
    INSERT INTO products (name, brand, category_id, price_base) VALUES ('Shampoo Argán 400ML', 'Maxy', cat_capilar, 17215) RETURNING id INTO v_prod_id;
    INSERT INTO product_variants (product_id, name, sku, stock) VALUES (v_prod_id, 'Original 400ml', '08035240', 25);

    INSERT INTO products (name, brand, category_id, price_base) VALUES ('Tratamiento Argán 400ML', 'Maxy', cat_capilar, 24305) RETURNING id INTO v_prod_id;
    INSERT INTO product_variants (product_id, name, sku, stock) VALUES (v_prod_id, 'Original 400ml', '08036016', 15);

    INSERT INTO products (name, brand, category_id, price_base) VALUES ('Shampoo Keratina 400ML', 'Maxy', cat_capilar, 11514) RETURNING id INTO v_prod_id;
    INSERT INTO product_variants (product_id, name, sku, stock) VALUES (v_prod_id, 'Original 400ml', '08035245', 30);

    INSERT INTO products (name, brand, category_id, price_base) VALUES ('Crema Peinar Rizos 400ML', 'Maxy', cat_capilar, 16579) RETURNING id INTO v_prod_id;
    INSERT INTO product_variants (product_id, name, sku, stock) VALUES (v_prod_id, 'Original 400ml', '08030650', 20);

    -- ==========================================
    -- FACIAL
    -- ==========================================
    INSERT INTO products (name, brand, category_id, price_base) VALUES ('Sérum Vitamina C Glow', 'GlowBeauty', cat_facial, 85000) RETURNING id INTO v_prod_id;
    INSERT INTO product_variants (product_id, name, sku, stock) VALUES (v_prod_id, 'Frasco 30ml', 'FAC-001', 12);

    INSERT INTO products (name, brand, category_id, price_base) VALUES ('Crema Facial Hidratante', 'GlowBeauty', cat_facial, 45000) RETURNING id INTO v_prod_id;
    INSERT INTO product_variants (product_id, name, sku, stock) VALUES (v_prod_id, 'Pote 50gr', 'FAC-002', 18);

    -- ==========================================
    -- CORPORAL
    -- ==========================================
    INSERT INTO products (name, brand, category_id, price_base) VALUES ('Crema Exfoliante Coco 360ML', 'Maxy', cat_corporal, 13041) RETURNING id INTO v_prod_id;
    INSERT INTO product_variants (product_id, name, sku, stock) VALUES (v_prod_id, 'Tarro 360ml', '08030515', 22);

    INSERT INTO products (name, brand, category_id, price_base) VALUES ('Foot Scrub 200ML', 'Maxy', cat_corporal, 10398) RETURNING id INTO v_prod_id;
    INSERT INTO product_variants (product_id, name, sku, stock) VALUES (v_prod_id, 'Tubo 200ml', '08032502', 14);

    -- ==========================================
    -- BARBERÍA
    -- ==========================================
    INSERT INTO products (name, brand, category_id, price_base) VALUES ('Shampoo 3 en 1 For Men', 'MaxyMen', cat_barberia, 14029) RETURNING id INTO v_prod_id;
    INSERT INTO product_variants (product_id, name, sku, stock) VALUES (v_prod_id, 'Frasco 400ml', '08035281', 10);

    INSERT INTO products (name, brand, category_id, price_base) VALUES ('Cera en Pasta Mate 100G', 'MaxyMen', cat_barberia, 15161) RETURNING id INTO v_prod_id;
    INSERT INTO product_variants (product_id, name, sku, stock) VALUES (v_prod_id, 'Lata 100g', '08030543', 25);

    -- ==========================================
    -- MANICURE Y UÑAS
    -- ==========================================
    INSERT INTO products (name, brand, category_id, price_base) VALUES ('Esmalte MXGel Colors', 'Maxy', cat_unas, 6734) RETURNING id INTO v_prod_id;
    INSERT INTO product_variants (product_id, name, sku, stock) VALUES (v_prod_id, 'Frasco 13ml', '08031728', 100);

    INSERT INTO products (name, brand, category_id, price_base) VALUES ('Base Triple 5 13ML', 'Maxy', cat_unas, 7947) RETURNING id INTO v_prod_id;
    INSERT INTO product_variants (product_id, name, sku, stock) VALUES (v_prod_id, 'Frasco 13ml', '08031365', 40);

    -- ==========================================
    -- TINTES Y COLORACIÓN
    -- ==========================================
    INSERT INTO products (name, brand, category_id, price_base) VALUES ('Tinte con Amoniaco 60GR', 'ColorPro', cat_color, 10699) RETURNING id INTO v_prod_id;
    INSERT INTO product_variants (product_id, name, sku, stock) VALUES (v_prod_id, 'Tubo 60gr', 'TINTE-60', 60);

    INSERT INTO products (name, brand, category_id, price_base) VALUES ('Tinte Sin Amoniaco 60GR', 'ColorPro', cat_color, 14225) RETURNING id INTO v_prod_id;
    INSERT INTO product_variants (product_id, name, sku, stock) VALUES (v_prod_id, 'Tubo 60gr', 'TINTE-SIN-60', 35);

END $$;

-- 4. CLIENTES DE PRUEBA
INSERT INTO customers (name, email, phone, balance) VALUES
('Marlon Abella', 'marlon@example.com', '3001234567', 0),
('Cliente Crédito', 'credito@example.com', '3109876543', 150000)
ON CONFLICT (email) DO NOTHING;

-- 5. GASTO DE PRUEBA
INSERT INTO expenses (description, amount, method)
VALUES ('Compra de bolsas de regalo', 15000, 'CASH');

-- 6. NOTA FINAL
-- El stock se ha inicializado con valores aleatorios para pruebas de inventario bajo.