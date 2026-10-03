'use client'

import React, { RefObject } from 'react';
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

/**
 * Panel de búsqueda de productos del POS.
 *
 * Subcomponente del POS. Encargado de:
 * - Input de búsqueda (también para escanear código de barras)
 * - Lista de resultados
 * - Click en resultado agrega al carrito
 *
 * Props: searchTerm/setSearchTerm, searchResults, isSearching,
 * onAddToCart, ref del input (para focus).
 */
interface ProductSearchProps {
    searchTerm: string;
    setSearchTerm: (v: string) => void;
    searchResults: SearchResult[];
    isSearching: boolean;
    disabled?: boolean;
    inputRef?: RefObject<HTMLInputElement>;
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

export default function ProductSearch({
    searchTerm, setSearchTerm,
    searchResults, isSearching,
    disabled, inputRef, onAddToCart,
}: ProductSearchProps) {
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
                        autoFocus
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
                            <div key={p.variant_id} className="product-row" onClick={() => onAddToCart(p)}>
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