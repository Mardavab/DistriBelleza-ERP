'use client';

import React, { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatCurrency } from '../../lib/format';

export interface SearchResult {
    variant_id: string;
    product_name: string;
    product_brand: string;
    variant_name: string;
    sku: string;
    /** Código de barras físico del producto (opcional, puede ser null). */
    barcode?: string | null;
    price: number;
    stock: number;
}

export interface ProductSearchProps {
    searchTerm: string;
    setSearchTerm: (v: string) => void;
    searchResults: SearchResult[];
    isSearching: boolean;
    disabled?: boolean;
    inputRef?: React.RefObject<HTMLInputElement>;
    onAddToCart: (product: SearchResult) => void;
}

function SkeletonRow() {
    return (
        <div className="product-row skeleton">
            <div className="skeleton-box" style={{ width: '80px', height: '14px', borderRadius: '4px' }} />
            <div className="product-info">
                <div className="skeleton-box" style={{ width: '160px', height: '14px', borderRadius: '4px', marginBottom: '6px' }} />
                <div className="skeleton-box" style={{ width: '120px', height: '12px', borderRadius: '4px' }} />
            </div>
        </div>
    );
}

/**
 * Encuentra el candidato ideal para auto-add dado el searchTerm.
 *
 * Reglas:
 * 1. Si hay EXACTAMENTE UN resultado cuyo SKU o barcode coincide exacto
 *    con el searchTerm, ese es el candidato (auto-add).
 * 2. Si hay VARIOS resultados con match exacto (raro, no debería pasar
 *    por las constraints UNIQUE), no auto-add para evitar ambigüedad.
 * 3. Si NO hay match exacto, devuelve null (mostrar lista al usuario).
 *
 * Esto arregla el caso donde el scanner lee 7703819017780 pero el search
 * fuzzy devuelve además 7703819017773 — elegimos el exacto, no el primero.
 */
function findExactMatch(results: SearchResult[], term: string): SearchResult | null {
    const exact = results.filter(
        (r) => r.sku === term || r.barcode === term,
    );
    if (exact.length === 1) return exact[0];
    return null;
}

/**
 * Panel de búsqueda de productos del POS.
 *
 * Comportamiento esperado para escaneo de códigos:
 * - El usuario escanea un código o lo tipea.
 * - Si hay exactamente un resultado con SKU o barcode EXACTO al searchTerm,
 *   se agrega automáticamente al carrito y se limpia el input.
 * - Si hay varios, se muestra la lista y el usuario elige.
 * - Enter agrega el primer resultado y limpia.
 */
export default function ProductSearch({
    searchTerm, setSearchTerm,
    searchResults, isSearching,
    disabled, inputRef, onAddToCart,
}: ProductSearchProps) {
    // Ref para evitar auto-add duplicado en el mismo término.
    const lastAutoAddedRef = useRef<string>('');

    useEffect(() => {
        if (isSearching || searchTerm.length < 2) {
            lastAutoAddedRef.current = '';
            return;
        }

        // Limpieza defensiva: el escáner suele inyectar Enter como caracter.
        const normalized = searchTerm.replace(/[\r\n]+/g, '').trim();
        if (!normalized) return;

        // Buscar match EXACTO (sku o barcode) entre los resultados.
        const exact = findExactMatch(searchResults, normalized);
        if (!exact) return;

        // No re-agregar el mismo variant dos veces con el mismo término.
        if (lastAutoAddedRef.current === exact.variant_id) return;

        lastAutoAddedRef.current = exact.variant_id;
        onAddToCart(exact);
        setSearchTerm('');
        // Re-focus para que el siguiente escaneo se registre directo.
        inputRef?.current?.focus();
    }, [searchResults, searchTerm, isSearching, onAddToCart, setSearchTerm, inputRef]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && searchResults.length > 0 && !isSearching) {
            e.preventDefault();
            const normalized = searchTerm.replace(/[\r\n]+/g, '').trim();
            // Solo agregar si hay match EXACTO. Sin match exacto no hacemos
            // fallback al primer resultado (puede ser de una búsqueda anterior
            // y agregar el producto equivocado). Dejamos que el useEffect
            // decida cuando llegue la nueva búsqueda.
            const exact = findExactMatch(searchResults, normalized);
            if (!exact) return;

            // Evita doble-add si el useEffect ya agregó este mismo variant.
            if (lastAutoAddedRef.current === exact.variant_id) return;

            lastAutoAddedRef.current = exact.variant_id;
            onAddToCart(exact);
            setSearchTerm('');
            inputRef?.current?.focus();
        }
    };

    return (
        <>
            <div className="search-section">
                <div className="search-input-wrapper">
                    <input
                        ref={inputRef}
                        type="text"
                        placeholder="Escanea código de barras o busca por nombre..."
                        className="search-input no-icon"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyDown={handleKeyDown}
                        autoFocus
                        autoComplete="off"
                        spellCheck={false}
                    />
                </div>
            </div>

            <div className="results-list">
                {isSearching ? (
                    <>
                        <SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow />
                    </>
                ) : (
                    <>
                        {searchResults.length === 0 && searchTerm.length >= 2 && (
                            <div className="no-results">
                                <AlertTriangle size={32} />
                                <p>No se encontraron productos.</p>
                            </div>
                        )}
                        {searchResults.map(p => (
                            <div
                                key={p.variant_id}
                                className="product-row"
                                onClick={() => onAddToCart(p)}
                            >
                                <span className="sku">{p.sku}</span>
                                <div className="product-info">
                                    <span className="product-name">{p.product_name}</span>
                                    <span className="variant-name">{p.variant_name}</span>
                                </div>
                                <span className="brand-tag">{p.product_brand}</span>
                                <span className={`stock-badge ${p.stock <= 5 ? 'low' : ''}`}>Stock: {p.stock}</span>
                                <span className="price">{formatCurrency(p.price)}</span>
                                <button className="btn-add-quick">Añadir</button>
                            </div>
                        ))}
                    </>
                )}
            </div>
        </>
    );
}