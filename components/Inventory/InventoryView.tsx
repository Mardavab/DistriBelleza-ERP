'use client'

import React, { useEffect, useState } from 'react';
import { 
  AlertCircle, Plus, X, Package, Trash2, Edit3, 
  Filter, Check, ChevronLeft, ChevronRight, 
  RefreshCcw, AlertTriangle, Layers 
} from 'lucide-react';
import { 
  getInventory, 
  createProductWithVariants, 
  updateProductWithVariants, 
  deleteProduct, 
  getCategories,
  createCategory
} from '../../app/actions/inventory_actions';
import CustomSelect from '../UI/CustomSelect';

// SKELETON COMPONENT
const SkeletonRow = () => (
  <tr className="skeleton-row">
    <td><div className="skeleton-box w-full h-12"></div></td>
    <td><div className="skeleton-box w-24 h-8"></div></td>
    <td><div className="skeleton-box w-20 h-6"></div></td>
    <td><div className="skeleton-box w-12 h-6"></div></td>
    <td><div className="skeleton-box w-24 h-8"></div></td>
    <td style={{ textAlign: 'right' }}><div className="skeleton-box w-20 h-10 ml-auto"></div></td>
  </tr>
);

export default function InventoryView() {
  const [items, setItems] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  
  // Error handling
  const [formError, setFormError] = useState<string | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // New Category State
  const [showCatInput, setShowCatInput] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  // Form State - Stock and Price start as empty strings to use placeholders
  const [productForm, setProductForm] = useState({ name: '', brand: '', category_id: '', price_base: '' });
  const [variants, setVariants] = useState<any[]>([{ name: '', sku: '', barcode: '', stock: '', price: '' }]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    
    const [inv, cats] = await Promise.all([getInventory(), getCategories()]);
    setItems(inv);
    setCategories(cats);
    
    setLoading(false);
    setRefreshing(false);
  }

  const openCreateModal = () => {
    setIsEditing(false);
    setEditingProductId(null);
    setProductForm({ name: '', brand: '', category_id: '', price_base: '' });
    setVariants([{ name: '', sku: '', barcode: '', stock: '', price: '' }]);
    setFormError(null);
    setShowModal(true);
  };

  const openEditModal = (variant: any) => {
    const product = variant.products;
    if (!product) return;

    setIsEditing(true);
    setEditingProductId(product.id);
    setProductForm({
      name: product.name,
      brand: product.brand,
      category_id: product.category_id || '',
      price_base: product.price_base?.toString() || ''
    });

    const productVariants = items
      .filter(item => item.product_id === product.id)
      .map(v => ({
        id: v.id,
        name: v.name,
        sku: v.sku,
        barcode: v.barcode || '',
        stock: v.stock?.toString() || '',
        price: v.price?.toString() || ''
      }));
    
    setVariants(productVariants);
    setFormError(null);
    setShowModal(true);
  };

  const addVariantField = () => {
    setVariants([...variants, { name: '', sku: '', barcode: '', stock: '', price: '' }]);
  };

  const removeVariantField = (index: number) => {
    if (variants.length <= 1) return;
    setVariants(variants.filter((_, i) => i !== index));
  };

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    const res = await createCategory(newCatName);
    if (res.success) {
      const cats = await getCategories();
      setCategories(cats);
      setProductForm({ ...productForm, category_id: res.data.id });
      setNewCatName('');
      setShowCatInput(false);
    } else {
      setFormError("Error al crear categoría: " + res.error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const productData = { 
      ...productForm, 
      price_base: productForm.price_base ? parseInt(String(productForm.price_base).replace(/\D/g, '')) : null 
    };
    const variantsData = variants.map(v => ({ 
      ...v, 
      stock: v.stock === '' ? 0 : parseInt(String(v.stock)),
      price: v.price === '' ? null : parseInt(String(v.price).replace(/\D/g, '')) 
    }));

    let res;
    if (isEditing && editingProductId) {
      res = await updateProductWithVariants(editingProductId, productData, variantsData);
    } else {
      res = await createProductWithVariants(productData, variantsData);
    }

    if (res.success) {
      setShowModal(false);
      loadData(true);
    } else {
      if (res.error?.includes('unique constraint "product_variants_sku_key"')) {
        setFormError("Ya existe un producto con uno de los SKUs ingresados. Por favor usa un código único.");
      } else {
        setFormError("Ocurrió un error: " + res.error);
      }
    }
  };

  const handleDelete = async (productId: string) => {
    if (confirm("¿Estás seguro de eliminar este producto y todas sus variantes?")) {
      const res = await deleteProduct(productId);
      if (res.success) {
        loadData(true);
      } else {
        alert("Error al eliminar: " + res.error);
      }
    }
  };

  const filteredItems = items.filter(item => {
    const matchesSearch = item.products?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.products?.brand.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.sku.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = categoryFilter === 'all' || item.products?.category_id === categoryFilter;
    
    return matchesSearch && matchesCategory;
  });

  const totalPages = Math.ceil(filteredItems.length / itemsPerPage);
  const paginatedItems = filteredItems.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  return (
    <div className="inventory-container">
      {/* HEADER & FILTERS */}
      <div className="inventory-header">
        <div className="header-left">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h2>Gestión de Inventario</h2>
            {(loading || refreshing) && <RefreshCcw size={16} className="spin-icon text-indigo" />}
          </div>
          <p>Control total de productos y variantes</p>
        </div>
        <button className="btn-add-product" onClick={openCreateModal} disabled={loading}>
          <Plus size={20} /> Nuevo Producto
        </button>
      </div>

      <div className="inventory-controls">
        <div className={`search-bar ${loading ? 'skeleton-effect' : ''}`}>
          <input 
            type="text" 
            disabled={loading}
            placeholder={loading ? "Cargando..." : "Buscar por producto, marca o SKU..."}
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
          />
        </div>
        
        <div className={`filter-select ${loading ? 'skeleton-effect' : ''}`}>
          <Filter size={16} />
          <select 
            disabled={loading}
            value={categoryFilter} 
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="all">Todas las categorías</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {/* TABLE */}
      <div className="table-card shadow-premium">
        <table className="inventory-table">
          <thead>
            <tr>
              <th>Producto y Variante</th>
              <th>SKU / Código</th>
              <th>Categoría</th>
              <th>Stock</th>
              <th>Precio Venta</th>
              <th style={{ textAlign: 'right' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : paginatedItems.length > 0 ? (
              paginatedItems.map(item => (
                <tr key={item.id} className="row-hover">
                  <td>
                    <div className="item-info">
                      <div className="product-name">{item.products?.name}</div>
                      <div className="variant-label">
                          <span className="brand-tag">{item.products?.brand}</span>
                          <span className="separator">•</span>
                          <span className="variant-name">{item.name}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="sku-container">
                      <span className="sku-badge">{item.sku}</span>
                      {item.barcode && <span className="barcode-text">{item.barcode}</span>}
                    </div>
                  </td>
                  <td>
                    <span className="category-tag">
                      {categories.find(c => c.id === item.products?.category_id)?.name || 'General'}
                    </span>
                  </td>
                  <td>
                    <div className={`stock-status ${item.stock <= 5 ? 'critical' : ''}`}>
                      <span className="stock-count">{item.stock}</span>
                      {item.stock <= 5 && <AlertCircle size={14} className="warning-icon" />}
                    </div>
                  </td>
                  <td>
                    <div className="price-display">
                      <span className="main-price">
                        ${(item.price || item.products?.price_base || 0).toLocaleString()}
                      </span>
                      {!item.price && <span className="inherited-badge">Heredado</span>}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="action-buttons">
                      <button className="btn-icon edit" title="Editar" onClick={() => openEditModal(item)}>
                        <Edit3 size={18} />
                      </button>
                      <button className="btn-icon delete" title="Eliminar" onClick={() => handleDelete(item.product_id)}>
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '60px', color: '#64748b' }}>
                  No se encontraron productos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        
        {/* PAGINATION */}
        {!loading && totalPages > 1 && (
          <div className="pagination-bar">
            <span className="page-info">
              Página <b>{currentPage}</b> de <b>{totalPages}</b> ({filteredItems.length} resultados)
            </span>
            <div className="pagination-buttons">
              <button className="btn-page" disabled={currentPage === 1} onClick={() => handlePageChange(currentPage - 1)}>
                <ChevronLeft size={18} />
              </button>
              <button className="btn-page" disabled={currentPage === totalPages} onClick={() => handlePageChange(currentPage + 1)}>
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* MODAL */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-window animate-in shadow-xl">
            <div className="modal-header">
              <div className="header-title">
                <Package className="text-indigo" />
                <h3>{isEditing ? 'Editar Producto' : 'Nuevo Producto'}</h3>
              </div>
              <button className="btn-close" onClick={() => setShowModal(false)}><X /></button>
            </div>

            <form onSubmit={handleSubmit} className="modal-body">
              {formError && (
                <div className="error-banner">
                  <AlertTriangle size={18} />
                  <span>{formError}</span>
                </div>
              )}

              <section className="form-section">
                <div className="section-title">Datos Básicos</div>
                <div className="form-grid">
                  <div className="field">
                    <label>Nombre</label>
                    <input type="text" required value={productForm.name} onChange={e => setProductForm({...productForm, name: e.target.value})} placeholder="Ej: Shampoo" />
                  </div>
                  <div className="field">
                    <label>Marca</label>
                    <input type="text" required value={productForm.brand} onChange={e => setProductForm({...productForm, brand: e.target.value})} placeholder="Ej: Glow" />
                  </div>
                  <div className="field">
                    <div className="flex-between">
                      <label>Categoría</label>
                      <button type="button" className="btn-text-action" onClick={() => setShowCatInput(!showCatInput)}>{showCatInput ? 'Cancelar' : '+ Nueva'}</button>
                    </div>
                    {showCatInput ? (
                      <div className="quick-cat-input">
                        <input type="text" autoFocus placeholder="Nombre..." value={newCatName} onChange={e => setNewCatName(e.target.value)} />
                        <button type="button" className="btn-cat-save" onClick={handleAddCategory}><Check size={16} /></button>
                      </div>
                    ) : (
                      <CustomSelect
                        value={productForm.category_id}
                        onChange={(val) => setProductForm({...productForm, category_id: val})}
                        options={categories.map(c => ({ value: c.id, label: c.name, icon: <Layers size={16} /> }))}
                        placeholder="Seleccionar..."
                      />
                    )}
                  </div>
                  <div className="field">
                    <label>Precio Base</label>
                    <div className="input-with-symbol">
                      <span className="symbol">$</span>
                      <input type="text" className="input-with-padding" value={productForm.price_base} onChange={e => {
                        const raw = e.target.value.replace(/\D/g, '');
                        setProductForm({...productForm, price_base: raw ? parseInt(raw).toLocaleString('es-CO') : ''});
                      }} placeholder="0" />
                    </div>
                  </div>
                </div>
              </section>

              <section className="form-section">
                <div className="section-header">
                  <div className="section-title">Variantes</div>
                  <button type="button" className="btn-outline-sm" onClick={addVariantField}><Plus size={14} /> Añadir</button>
                </div>
                
                <div className="variants-grid-header">
                  <span>Nombre</span>
                  <span>SKU</span>
                  <span>Stock</span>
                  <span>Precio Propio</span>
                  <span></span>
                </div>
                
                <div className="variants-scroll-area">
                  {variants.map((v, i) => (
                    <div key={i} className="variant-form-row">
                      <input type="text" placeholder="Ej: Rojo / 50ml" value={v.name} onChange={e => {
                        const nv = [...variants]; nv[i].name = e.target.value; setVariants(nv);
                      }} required />
                      <input type="text" placeholder="SKU-001" value={v.sku} onChange={e => {
                        const nv = [...variants]; nv[i].sku = e.target.value; setVariants(nv);
                      }} required />
                      <input type="number" placeholder="0" value={v.stock} onChange={e => {
                        const nv = [...variants]; nv[i].stock = e.target.value; setVariants(nv);
                      }} />
                      <div className="input-with-symbol small">
                        <span className="symbol">$</span>
                        <input type="text" className="input-with-padding" placeholder="Heredar" value={v.price} onChange={e => {
                          const raw = e.target.value.replace(/\D/g, '');
                          const nv = [...variants]; nv[i].price = raw ? parseInt(raw).toLocaleString('es-CO') : ''; setVariants(nv);
                        }} />
                      </div>
                      <button type="button" className="btn-delete-row" disabled={variants.length === 1} onClick={() => removeVariantField(i)}><Trash2 size={16} /></button>
                    </div>
                  ))}
                </div>
              </section>

              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">{isEditing ? 'Guardar Cambios' : 'Registrar Producto'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx>{`
        .inventory-container { padding: 24px; width: 100%; }
        .inventory-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
        .header-left h2 { font-size: 1.75rem; color: #1e293b; font-weight: 700; margin: 0; }
        .header-left p { color: #64748b; margin: 4px 0 0; }
        .text-indigo { color: #6366f1; }
        .spin-icon { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        .inventory-controls { display: flex; gap: 16px; margin-bottom: 24px; }
        .search-bar, .filter-select { display: flex; align-items: center; background: white; padding: 0 16px; border-radius: 12px; border: 1px solid #e2e8f0; height: 48px; }
        .search-bar { flex: 1; gap: 12px; }
        .search-bar input { border: none; padding: 0; flex: 1; outline: none; background: transparent; height: 100%; font-size: 0.95rem; }
        .filter-select select { border: none; padding: 0; outline: none; background: transparent; color: #1e293b; font-weight: 500; height: 100%; cursor: pointer; }

        .table-card { background: white; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; }
        .shadow-premium { box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05); }
        .inventory-table { width: 100%; border-collapse: collapse; }
        .inventory-table th { background: #f8fafc; padding: 16px; text-align: left; font-size: 0.75rem; font-weight: 600; color: #64748b; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; }
        .inventory-table td { padding: 16px; border-bottom: 1px solid #f1f5f9; }
        .row-hover:hover { background: #f8fafc; }

        .product-name { font-weight: 600; color: #0f172a; font-size: 1rem; }
        .variant-label { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; margin-top: 4px; }
        .brand-tag { color: #6366f1; font-weight: 700; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.02em; }
        .separator { color: #cbd5e1; }
        .variant-name { color: #64748b; font-weight: 500; }
        .category-tag { background: #eff6ff; color: #3b82f6; padding: 4px 10px; border-radius: 99px; font-size: 0.7rem; font-weight: 600; }
        .stock-status { font-weight: 600; }
        .stock-status.critical { color: #ef4444; }
        .main-price { font-weight: 700; }
        .inherited-badge { font-size: 0.65rem; color: #94a3b8; font-style: italic; }

        .action-buttons { display: flex; justify-content: flex-end; gap: 8px; }
        .btn-icon { padding: 8px; border-radius: 8px; border: 1px solid #e2e8f0; background: white; cursor: pointer; color: #64748b; transition: all 0.2s; }
        .btn-icon:hover { color: #6366f1; border-color: #6366f1; }

        .pagination-bar { padding: 12px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
        .pagination-buttons { display: flex; gap: 8px; }
        .btn-page { padding: 6px; border-radius: 8px; border: 1px solid #e2e8f0; background: white; cursor: pointer; opacity: ${loading ? '0.5' : '1'}; }

        /* SKELETON STYLES */
        .skeleton-box { background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; border-radius: 6px; }
        @keyframes skeleton-loading { from { background-position: 200% 0; } to { background-position: -200% 0; } }
        .w-full { width: 100%; }
        .w-24 { width: 96px; }
        .w-20 { width: 80px; }
        .w-12 { width: 48px; }
        .h-12 { height: 48px; }
        .h-10 { height: 40px; }
        .h-8 { height: 32px; }
        .h-6 { height: 24px; }
        .ml-auto { margin-left: auto; }
        .skeleton-effect { border-color: #f1f5f9 !important; background: #f8fafc !important; }

        /* MODAL STYLES */
        .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.4); backdrop-filter: blur(8px); display: flex; justify-content: center; align-items: center; z-index: 1000; }
        .modal-window { background: white; width: 100%; max-width: 900px; max-height: 90vh; border-radius: 24px; overflow: hidden; display: flex; flex-direction: column; }
        .modal-header { padding: 24px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
        .header-title { display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 1.1rem; }
        .modal-body { padding: 24px; overflow-y: auto; overflow-x: hidden; flex: 1; }
        .form-section { margin-bottom: 32px; width: 100%; }
        .section-title { font-size: 0.8rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px; margin-bottom: 16px; display: block; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .field { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
        .field label { font-size: 0.85rem; font-weight: 600; color: #475569; }
        .field input, .field select { padding: 12px; border: 1px solid #e2e8f0; border-radius: 12px; outline: none; font-size: 0.95rem; width: 100%; box-sizing: border-box; }
        .field input:focus { border-color: #6366f1; }
        .input-with-symbol { position: relative; display: flex; align-items: center; width: 100%; }
        .symbol { position: absolute; left: 14px; color: #cbd5e1; font-weight: 600; }
        .input-with-padding { padding-left: 32px !important; }
        
        .variants-scroll-area { width: 100%; overflow-x: auto; padding-bottom: 8px; }
        .variants-grid-header { display: grid; grid-template-columns: minmax(150px, 2fr) minmax(100px, 1.5fr) 80px 120px 40px; gap: 12px; padding: 12px; background: #f8fafc; border-radius: 10px; font-size: 0.7rem; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 12px; min-width: 600px; }
        .variant-form-row { display: grid; grid-template-columns: minmax(150px, 2fr) minmax(100px, 1.5fr) 80px 120px 40px; gap: 12px; margin-bottom: 12px; align-items: center; min-width: 600px; }
        .variant-form-row input { padding: 10px; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 0.9rem; width: 100%; min-width: 0; }
        .modal-actions { padding: 24px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
        .btn-add-product { background: #6366f1; color: white; border: none; padding: 12px 24px; border-radius: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.2s; box-shadow: 0 4px 6px -1px rgba(99, 102, 241, 0.2); }
        .btn-add-product:hover:not(:disabled) { background: #4f46e5; transform: translateY(-1px); box-shadow: 0 10px 15px -3px rgba(99, 102, 241, 0.3); }
        .btn-primary { background: #0f172a; color: white; border: none; padding: 12px 24px; border-radius: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.2s; }
        .btn-primary:hover { background: #334155; transform: translateY(-1px); }
        .btn-cancel { background: #fff1f2; border: 1px solid #fecaca; padding: 12px 24px; color: #e11d48; font-weight: 600; cursor: pointer; border-radius: 12px; transition: all 0.2s; }
        .btn-cancel:hover { background: #ffe4e6; color: #be123c; border-color: #fda4af; transform: translateY(-1px); }
        .error-banner { background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 12px; border-radius: 12px; margin-bottom: 24px; display: flex; align-items: center; gap: 10px; font-size: 0.9rem; }
        .flex-between { display: flex; justify-content: space-between; align-items: center; }
        .btn-text-action { background: none; border: none; color: #6366f1; font-weight: 600; font-size: 0.75rem; cursor: pointer; }
        .quick-cat-input { display: flex; gap: 8px; }
        .btn-cat-save { background: #6366f1; color: white; border: none; border-radius: 8px; padding: 0 10px; cursor: pointer; }

        @media (max-width: 768px) {
          .form-grid { grid-template-columns: 1fr; }
          .variant-form-row { grid-template-columns: 1fr; border: 1px solid #eee; padding: 12px; border-radius: 12px; }
          .variants-grid-header { display: none; }
        }
      `}</style>
    </div>
  );
}
