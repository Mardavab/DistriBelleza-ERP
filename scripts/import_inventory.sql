DO $$
DECLARE
    v_category_id UUID;
    v_product_id UUID;
BEGIN
    -- 1. Asegurar categoría
    INSERT INTO categories (name) 
    VALUES ('Manicure y Uñas') 
    ON CONFLICT (name) DO NOTHING;
    
    SELECT id INTO v_category_id FROM categories WHERE name = 'Manicure y Uñas';

    -- 2. Asegurar Producto Base
    INSERT INTO products (name, brand, category_id, price_base, active)
    VALUES ('Esmalte Gel', 'Maxybelt', v_category_id, 9000, true)
    ON CONFLICT DO NOTHING; 

    SELECT id INTO v_product_id FROM products WHERE name = 'Esmalte Gel' AND brand = 'Maxybelt';

    -- 3. Insertar Variantes (84 registros procesados del CSV) con Barcode NULL
    INSERT INTO product_variants (product_id, name, sku, barcode, stock, price, active)
    VALUES 
    (v_product_id, 'Arriesgada', 'LAB-MAC-R01', NULL, 2, NULL, true),
    (v_product_id, 'Amor', 'LAB-MAC-N02', NULL, 1, NULL, true),
    (v_product_id, 'Abigail', 'LAB-MAC-C03', NULL, 5, NULL, true),
    (v_product_id, 'Colorido', 'SER-TO-30', NULL, 5, NULL, true),
    (v_product_id, 'Agua', 'SER-TO-60', NULL, 3, NULL, true),
    (v_product_id, 'Azul', 'BAS-NYX-B01', NULL, 4, NULL, true),
    (v_product_id, 'Acuario', 'BAS-NYX-C05', NULL, 4, NULL, true),
    (v_product_id, 'Analítica', 'SHA-LOR-400', NULL, 2, NULL, true),
    (v_product_id, 'Aceituna', 'PAL-UD-N12', NULL, 3, NULL, true),
    (v_product_id, 'Amar real', 'SKU-EG-AMAR', NULL, 3, NULL, true),
    (v_product_id, 'Azucena', 'SKU-EG-AZUC', NULL, 3, NULL, true),
    (v_product_id, 'Amable', 'SKU-EG-AMAB', NULL, 3, NULL, true),
    (v_product_id, 'Bendicion', 'SKU-EG-BEND', NULL, 6, NULL, true),
    (v_product_id, 'Bella', 'SKU-EG-BELLA', NULL, 2, NULL, true),
    (v_product_id, 'Cerezo', 'SKU-EG-CERE', NULL, 4, NULL, true),
    (v_product_id, 'Creativa', 'SKU-EG-CREA', NULL, 2, NULL, true),
    (v_product_id, 'Canela', 'SKU-EG-CANE', NULL, 3, NULL, true),
    (v_product_id, 'Camel', 'SKU-EG-CAMEL', NULL, 2, NULL, true),
    (v_product_id, 'Corazón', 'SKU-EG-CORA', NULL, 2, NULL, true),
    (v_product_id, 'Ceremonia', 'SKU-EG-CERE2', NULL, 2, NULL, true),
    (v_product_id, 'Cielo', 'SKU-EG-CIELO', NULL, 3, NULL, true),
    (v_product_id, 'Coraje', 'SKU-EG-CORA2', NULL, 5, NULL, true),
    (v_product_id, 'Celestial', 'SKU-EG-CELE', NULL, 2, NULL, true),
    (v_product_id, 'Bomba sexy', 'SKU-EG-BOMBA', NULL, 2, NULL, true),
    (v_product_id, 'Brilli brilli', 'SKU-EG-BRILLI', NULL, 3, NULL, true),
    (v_product_id, 'Bella lluvia', 'SKU-EG-BELLALLU', NULL, 2, NULL, true),
    (v_product_id, 'Brillante', 'SKU-EG-BRILL', NULL, 3, NULL, true),
    (v_product_id, 'Boreal', 'SKU-EG-BOREAL', NULL, 3, NULL, true),
    (v_product_id, 'Carmesí', 'SKU-EG-CARM', NULL, 2, NULL, true),
    (v_product_id, 'Calmenta', 'SKU-EG-CALM', NULL, 2, NULL, true),
    (v_product_id, 'Duquesa', 'SKU-EG-DUQU', NULL, 3, NULL, true),
    (v_product_id, 'Doncella', 'SKU-EG-DONC', NULL, 5, NULL, true),
    (v_product_id, 'Dama', 'SKU-EG-DAMA', NULL, 1, NULL, true),
    (v_product_id, 'Fabulosa', 'SKU-EG-FABU', NULL, 2, NULL, true),
    (v_product_id, 'Dragón', 'SKU-EG-DRAG', NULL, 1, NULL, true),
    (v_product_id, 'Experta', 'SKU-EG-EXPE', NULL, 2, NULL, true),
    (v_product_id, 'Fuerza', 'SKU-EG-FUER', NULL, 2, NULL, true),
    (v_product_id, 'Famosa', 'SKU-EG-FAMO', NULL, 2, NULL, true),
    (v_product_id, 'Fénix', 'SKU-EG-FENIX', NULL, 5, NULL, true),
    (v_product_id, 'Flor', 'SKU-EG-FLOR', NULL, 5, NULL, true),
    (v_product_id, 'Flor de loto', 'SKU-EG-FLORLOTO', NULL, 3, NULL, true),
    (v_product_id, 'Ola', 'SKU-EG-OLA', NULL, 3, NULL, true),
    (v_product_id, 'Oro', 'SKU-EG-ORO', NULL, 3, NULL, true),
    (v_product_id, 'Pacífica', 'SKU-EG-PACI', NULL, 3, NULL, true),
    (v_product_id, 'Orquídea', 'SKU-EG-ORQU', NULL, 2, NULL, true),
    (v_product_id, 'Lolita', 'SKU-EG-LOLI', NULL, 2, NULL, true),
    (v_product_id, 'Lujosa', 'SKU-EG-LUJO', NULL, 3, NULL, true),
    (v_product_id, 'Luz', 'SKU-EG-LUZ', NULL, 3, NULL, true),
    (v_product_id, 'Lluvia', 'SKU-EG-LLUV', NULL, 1, NULL, true),
    (v_product_id, 'Luminosa', 'SKU-EG-LUMI', NULL, 7, NULL, true),
    (v_product_id, 'Mística', 'SKU-EG-MIST', NULL, 3, NULL, true),
    (v_product_id, 'Misterio', 'SKU-EG-MIST2', NULL, 5, NULL, true),
    (v_product_id, 'Majestuosa', 'SKU-EG-MAJE', NULL, 4, NULL, true),
    (v_product_id, 'Marrón', 'SKU-EG-MARR', NULL, 4, NULL, true),
    (v_product_id, 'Magnífica', 'SKU-EG-MAGN', NULL, 2, NULL, true),
    (v_product_id, 'Melocotón', 'SKU-EG-MELO', NULL, 4, NULL, true),
    (v_product_id, 'Koko', 'SKU-EG-KOKO', NULL, 3, NULL, true),
    (v_product_id, 'Justa', 'SKU-EG-JUST', NULL, 2, NULL, true),
    (v_product_id, 'Grandeza', 'SKU-EG-GRAN', NULL, 2, NULL, true),
    (v_product_id, 'Gretel', 'SKU-EG-GRET', NULL, 2, NULL, true),
    (v_product_id, 'Genuino', 'SKU-EG-GENU', NULL, 2, NULL, true),
    (v_product_id, 'Fe', 'SKU-EG-FE', NULL, 1, NULL, true),
    (v_product_id, 'Fresquita', 'SKU-EG-FRES', NULL, 2, NULL, true),
    (v_product_id, 'Paz', 'SKU-EG-PAZ', NULL, 2, NULL, true),
    (v_product_id, 'Púrpura', 'SKU-EG-PURP', NULL, 1, NULL, true),
    (v_product_id, 'Pureza', 'SKU-EG-PURE', NULL, 2, NULL, true),
    (v_product_id, 'Profunda', 'SKU-EG-PROF', NULL, 3, NULL, true),
    (v_product_id, 'Plata', 'SKU-EG-PLAT', NULL, 2, NULL, true),
    (v_product_id, 'Sensata', 'SKU-EG-SENS', NULL, 1, NULL, true),
    (v_product_id, 'Rescata', 'SKU-EG-RESC', NULL, 1, NULL, true),
    (v_product_id, 'Salvaje', 'SKU-EG-SALV', NULL, 2, NULL, true),
    (v_product_id, 'Rayo de luz', 'SKU-EG-RAYO', NULL, 3, NULL, true),
    (v_product_id, 'Sally', 'SKU-EG-SALLY', NULL, 3, NULL, true),
    (v_product_id, 'Saliendo', 'SKU-EG-SALI', NULL, 1, NULL, true),
    (v_product_id, 'Sencilla', 'SKU-EG-SENCI', NULL, 3, NULL, true),
    (v_product_id, 'Sensitiva', 'SKU-EG-SENSI2', NULL, 2, NULL, true),
    (v_product_id, 'Sociable', 'SKU-EG-SOCI', NULL, 2, NULL, true),
    (v_product_id, 'Tormenta', 'SKU-EG-TORM', NULL, 3, NULL, true),
    (v_product_id, 'Torbelino', 'SKU-EG-TORB', NULL, 3, NULL, true),
    (v_product_id, 'Valiente', 'SKU-EG-VALI', NULL, 3, NULL, true),
    (v_product_id, 'Valiosa', 'SKU-EG-VALI2', NULL, 1, NULL, true),
    (v_product_id, 'Vistuosa', 'SKU-EG-VIST', NULL, 2, NULL, true),
    (v_product_id, 'Sellant mágic', 'SKU-EG-SELL', NULL, 2, NULL, true),
    (v_product_id, 'Brillo S', 'SKU-EG-BRILLOS', NULL, 19, NULL, true)
    ON CONFLICT (sku) DO UPDATE SET 
        stock = EXCLUDED.stock,
        name = EXCLUDED.name,
        barcode = NULL;

    RAISE NOTICE 'Inventario importado con éxito (Códigos de barras omitidos).';
END $$;
