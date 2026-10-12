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
 * Panel de búsqueda de productos del POS.
 *
 * Comportamiento esperado para escaneo de códigos:
 * - El usuario escanea un código o lo tipea.
 * - Si la búsqueda devuelve exactamente 1 resultado cuyo SKU coincide
 *   con el término buscado, se agrega automáticamente al carrito y se
 *   limpia el input (listo para el siguiente escaneo).
 * - Si hay varios resultados, se muestra la lista y el usuario elige.
 * - Enter también agrega el primer resultado y limpia.
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
        if (searchResults.length !== 1) return;
        // Limpieza defensiva: el escáner suele inyectar Enter como caracter.
        const normalized = searchTerm.replace(/[\r\n]+/g, '').trim();
        if (!normalized) return;

        const candidate = searchResults[0];
        const skuMatch = candidate.sku === normalized;
        // Permitimos también match por barcode si existe en el future.
        // Por ahora solo SKU exacto para evitar falsos positivos al tipear.
        if (!skuMatch) return;

        // No re-agregar el mismo término múltiples veces.
        if (lastAutoAddedRef.current === candidate.variant_id) return;

        lastAutoAddedRef.current = candidate.variant_id;
        onAddToCart(candidate);
        setSearchTerm('');
        // Re-focus para que el siguiente escaneo se registre directo.
        inputRef?.current?.focus();
    }, [searchResults, searchTerm, isSearching, onAddToCart, setSearchTerm, inputRef]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && searchResults.length > 0 && !isSearching) {
            // Enter agrega el primer resultado y limpia.
            e.preventDefault();
            onAddToCart(searchResults[0]);
            setSearchTerm('');
            lastAutoAddedRef.current = searchResults[0].variant_id;
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