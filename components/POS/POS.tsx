'use client'

import React, { useState, useEffect } from 'react';
import {
  Search, ShoppingCart, Trash2, AlertTriangle,
  CheckCircle, Package, Lock, Unlock, Tag,
  User as UserIcon, Calendar, Clock, DollarSign, RefreshCcw,
  History, Eye, X, ChevronRight, TrendingUp, LogOut, Award,
  MinusCircle, PlusCircle, CreditCard, Receipt, Percent,
  Wallet, Banknote, Smartphone, ShieldCheck
} from 'lucide-react';
import CustomSelect from '../UI/CustomSelect';
import { searchPOSProducts, processPOSSale, POSItem, getDefaultProducts } from '../../app/actions/sales';
import { getUserProfile } from '../../app/actions/auth';
import { getSalesHistory } from '../../app/actions/sales_history';
import {
  getActiveCashSession,
  openCashSession,
  getCashSessionSummary,
  closeCashSession,
  addExpense
} from '../../app/actions/cash_actions';
import './POS.css';

interface CartItem extends POSItem {
  product_name: string;
  variant_name: string;
  sku: string;
  price: number;
}

// SKELETON COMPONENTS
const SkeletonStatus = () => (
  <div className="status-item skeleton-effect">
    <div className="skeleton-box" style={{ width: '120px', height: '24px' }}></div>
  </div>
);

const SkeletonProductCard = () => (
  <div className="product-card skeleton-effect" style={{ pointerEvents: 'none' }}>
    <div className="card-top">
      <div className="skeleton-box" style={{ width: '60px', height: '14px' }}></div>
      <div className="skeleton-box" style={{ width: '50px', height: '14px' }}></div>
    </div>
    <div className="skeleton-box" style={{ width: '80%', height: '18px', margin: '8px 0' }}></div>
    <div className="skeleton-box" style={{ width: '50%', height: '14px' }}></div>
    <div className="card-footer" style={{ marginTop: '16px' }}>
      <div className="skeleton-box" style={{ width: '70px', height: '24px' }}></div>
      <div className="skeleton-box" style={{ width: '60px', height: '24px' }}></div>
    </div>
  </div>
);

export default function POS() {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeSession, setActiveSession] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);

  // Tabs state
  const [activeTab, setActiveTab] = useState<'cart' | 'expenses'>('cart');

  // History state
  const [showHistory, setShowHistory] = useState(false);
  const [salesHistory, setSalesHistory] = useState<any[]>([]);
  const [selectedSale, setSelectedSale] = useState<any>(null);

  // Close Session state
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [sessionSummary, setSessionSummary] = useState<any>(null);
  const [isClosing, setIsClosing] = useState(false);

  // Expense state
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseAmount, setExpenseAmount] = useState<string | number>('');
  const [isAddingExpense, setIsAddingExpense] = useState(false);
  const [showExpenseSuccess, setShowExpenseSuccess] = useState(false);

  // Discount Modal state
  const [showPercentModal, setShowPercentModal] = useState<string | null>(null); // item ID
  const [percentValue, setPercentValue] = useState<string>('');

  // Venta state
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'BANK_TRANSFER' | 'CREDIT'>('CASH');
  const [transferType, setTransferType] = useState<'NEQUI' | 'DAVIPLATA' | 'BANCOLOMBIA' | 'OTHER'>('NEQUI');
  const [customerId, setCustomerId] = useState('');
  const [totalDiscount, setTotalDiscount] = useState<string | number>(0);

  // Modal state
  const [showOpenSession, setShowOpenSession] = useState(false);
  const [initialFund, setInitialFund] = useState<string | number>('');
  const [successData, setSuccessData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const [currentTime, setCurrentTime] = useState(new Date());

  // Pagination for Default Products
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isShowingDefaults, setIsShowingDefaults] = useState(false);

  useEffect(() => {
    loadInitialData();
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadInitialData = async () => {
    setIsLoading(true);
    const [session, profile] = await Promise.all([
      getActiveCashSession(),
      getUserProfile()
    ]);
    setActiveSession(session);
    setUserProfile(profile);
    if (!session) setShowOpenSession(true);
    else setShowOpenSession(false);
    setIsLoading(false);
  };

  const loadHistory = async () => {
    setIsLoading(true);
    const res = await getSalesHistory();
    if (res.success) {
      setSalesHistory(res.data || []);
      setShowHistory(true);
    }
    setIsLoading(false);
  };

  // Simple in-memory cache for default products pages
  const defaultProductsCache = React.useRef<Record<number, { data: any[], count: number }>>({});

  const loadDefaultProducts = async (page: number, forceRefresh = false) => {
    // Return cached data instantly if available
    if (!forceRefresh && defaultProductsCache.current[page]) {
      const cached = defaultProductsCache.current[page];
      setSearchResults(cached.data);
      setTotalPages(Math.ceil(cached.count / 8) || 1);
      setIsShowingDefaults(true);
      return;
    }
    setIsSearching(true);
    const res = await getDefaultProducts(page, 8);
    defaultProductsCache.current[page] = res; // Save to cache
    setSearchResults(res.data);
    setTotalPages(Math.ceil(res.count / 8) || 1);
    setIsShowingDefaults(true);
    setIsSearching(false);
  };

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchTerm.length >= 2) {
        setIsSearching(true);
        setIsShowingDefaults(false);
        const results = await searchPOSProducts(searchTerm);
        setSearchResults(results);
        setIsSearching(false);
      } else {
        loadDefaultProducts(currentPage);
      }
    }, 500); // Increased debounce to 500ms
    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm, currentPage]);

  const addToCart = (product: any) => {
    setActiveTab('cart');
    setCart(prev => {
      const existing = prev.find(item => item.variant_id === product.variant_id);
      if (existing) {
        return prev.map(item =>
          item.variant_id === product.variant_id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, {
        variant_id: product.variant_id,
        product_name: product.product_name,
        variant_name: product.variant_name,
        sku: product.sku,
        price: product.price,
        quantity: 1,
        discount: 0,
        expected_updated_at: product.updated_at
      }];
    });
  };

  const updateItemDiscount = (id: string, discount: number) => {
    setCart(prev => prev.map(item => item.variant_id === id ? { ...item, discount } : item));
  };

  const applyPercentDiscount = () => {
    if (!showPercentModal) return;
    const item = cart.find(i => i.variant_id === showPercentModal);
    if (item) {
      const percent = parseFloat(percentValue) || 0;
      const discountAmount = Math.round((item.price * item.quantity) * (percent / 100));
      updateItemDiscount(showPercentModal, discountAmount);
    }
    setShowPercentModal(null);
    setPercentValue('');
  };

  const calculateSubtotal = () => cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const calculateItemDiscounts = () => cart.reduce((sum, item) => sum + Number(item.discount), 0);
  const calculateTotal = () => calculateSubtotal() - calculateItemDiscounts() - Number(totalDiscount);

  const handleOpenSession = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);
    const fundValue = initialFund === '' ? 0 : Number(String(initialFund).replace(/\D/g, ''));
    const res = await openCashSession(fundValue);
    if (res.success) {
      await loadInitialData();
      setShowOpenSession(false);
    } else {
      setError(res.error);
    }
    setIsLoading(false);
  };

  const handleRequestClose = async () => {
    if (!activeSession) return;
    setIsLoading(true);
    setError(null);
    const res = await getCashSessionSummary(activeSession.id);
    if (res.success) {
      setSessionSummary(res.summary);
      setShowCloseModal(true);
    } else {
      setError(res.error || "Error al obtener resumen");
    }
    setIsLoading(false);
  };

  const handleConfirmFinalClose = async () => {
    if (!activeSession || isClosing) return;
    setIsClosing(true);
    const res = await closeCashSession(activeSession.id);
    if (res.success) {
      setShowCloseModal(false);
      setActiveSession(null);
      setSessionSummary(null);
      setShowOpenSession(true);
    } else {
      setError(res.error || "Error al cerrar definitivamente");
    }
    setIsClosing(false);
  };

  const handleAddExpense = async () => {
    if (!expenseDesc || !expenseAmount || isAddingExpense) return;
    setIsAddingExpense(true);
    const numericAmount = Number(String(expenseAmount).replace(/\D/g, ''));
    const res = await addExpense(expenseDesc, numericAmount);
    if (res.success) {
      setExpenseDesc('');
      setExpenseAmount('');
      setShowExpenseSuccess(true);
      setTimeout(() => setShowExpenseSuccess(false), 3000);
    } else {
      setError("Error al registrar gasto: " + res.error);
    }
    setIsAddingExpense(false);
  };

  const handleCheckout = async () => {
    if (paymentMethod === 'CREDIT' && !customerId) {
      setError('El Cliente es obligatorio para ventas a CRÉDITO.');
      return;
    }

    setIsLoading(true);
    setError(null);

    const res = await processPOSSale(
      customerId || null,
      cart.filter(c => c.quantity > 0).map(({ variant_id, quantity, expected_updated_at, discount }) => ({ variant_id, quantity, expected_updated_at, discount })),
      paymentMethod,
      paymentMethod === 'BANK_TRANSFER' ? transferType : null,
      Number(totalDiscount)
    );

    if (res.success) {
      setSuccessData(res);
      setCart([]);
      setCustomerId('');
      setTotalDiscount(0);
      await loadInitialData(); // Refresh session data to update "totalSold"
    } else {
      setError(res.error || 'Error al procesar la venta');
    }
    setIsLoading(false);
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(item => item.variant_id !== id));
  };

  return (
    <div className="pos-container">
      {/* GLOBAL TOAST NOTIFICATION */}
      {showExpenseSuccess && (
        <>
          <div className="toast-overlay animate-fade-in" />
          <div className="global-toast animate-slide-in-right">
            <div className="toast-content">
              <CheckCircle size={24} className="text-white" />
              <div className="toast-text">
                <p className="toast-title">¡Gasto Registrado!</p>
                <p className="toast-sub">La información ha sido guardada.</p>
              </div>
            </div>
            <div className="toast-progress" />
          </div>
        </>
      )}

      {/* PERCENT DISCOUNT MODAL */}
      {showPercentModal && (
        <div className="modal-overlay dark-blur" onClick={() => setShowPercentModal(null)}>
          <div className="modal-percent animate-pop" onClick={e => e.stopPropagation()}>
            <div className="percent-header">
              <Percent size={24} />
              <h3>Aplicar Porcentaje</h3>
            </div>
            <div className="percent-body">
              <input
                type="number"
                placeholder="%"
                value={percentValue}
                onChange={e => setPercentValue(e.target.value)}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && applyPercentDiscount()}
              />
            </div>
            <div className="percent-footer">
              <button className="btn-cancel-sm" onClick={() => setShowPercentModal(null)}>Cerrar</button>
              <button className="btn-confirm-sm" onClick={applyPercentDiscount}>Aplicar</button>
            </div>
          </div>
        </div>
      )}

      {/* STATUS BAR */}
      <header className="pos-status-bar">
        {isLoading && !userProfile ? (
          <>
            <SkeletonStatus />
            <SkeletonStatus />
            <SkeletonStatus />
          </>
        ) : (
          <>
            <div className="status-item">
              {activeSession ? <Unlock size={16} className="text-success" /> : <Lock size={16} className="text-danger" />}
              <span>Caja: <strong>{activeSession ? 'ABIERTA' : 'CERRADA'}</strong></span>
            </div>
            <div className="status-item">
              <UserIcon size={16} />
              <span>Usuario: <strong>{userProfile?.full_name}</strong></span>
            </div>
            {activeSession && (
              <>
                <div className="status-item highlight">
                  <DollarSign size={16} />
                  <span>Fondo Base: <strong>${activeSession.initial_fund.toLocaleString()}</strong></span>
                </div>
                <div className="status-item highlight sales">
                  <TrendingUp size={16} />
                  <span>Vendido Hoy: <strong>${(activeSession.totalSold || 0).toLocaleString()}</strong></span>
                </div>
              </>
            )}
          </>
        )}
        <div className="status-actions">
          <button className="btn-history-trigger" onClick={loadHistory} disabled={isLoading}>
            <History size={16} /> Historial
          </button>
          {activeSession && (
            <button className="btn-close-session" onClick={handleRequestClose} disabled={isLoading}>
              <LogOut size={16} /> Cierre
            </button>
          )}
        </div>
      </header>

      <div className="pos-grid">
        <main className="pos-main">
          <div className="search-section">
            <div className="search-input-wrapper">
              <input
                type="text"
                placeholder="Escanea o busca productos..."
                className="search-input no-icon"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoFocus
                disabled={!activeSession || isLoading}
              />
            </div>
          </div>

          <div className="results-grid">
            {isSearching ? (
              <>
                <SkeletonProductCard />
                <SkeletonProductCard />
                <SkeletonProductCard />
                <SkeletonProductCard />
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
                  <div key={p.variant_id} className="product-card" onClick={() => addToCart(p)}>
                    <div className="card-top">
                      <span className="sku">{p.sku}</span>
                      <span className={`stock-badge ${p.stock <= 5 ? 'low' : ''}`}>Stock: {p.stock}</span>
                    </div>
                    <h3>{p.product_name}</h3>
                    <p className="variant">{p.variant_name}</p>
                    <div className="card-footer">
                      <span className="price">${p.price.toLocaleString()}</span>
                      <button className="btn-add-quick">Añadir</button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
          {isShowingDefaults && !isSearching && totalPages > 1 && (
            <div className="pagination-controls" style={{ display: 'flex', justifyContent: 'center', gap: '16px', padding: '16px', marginTop: 'auto' }}>
              <button 
                disabled={currentPage === 1} 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', background: currentPage === 1 ? '#f8fafc' : 'white', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
              >
                Anterior
              </button>
              <span style={{ display: 'flex', alignItems: 'center', fontSize: '0.9rem', color: '#64748b' }}>
                Página {currentPage} de {totalPages}
              </span>
              <button 
                disabled={currentPage === totalPages} 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', background: currentPage === totalPages ? '#f8fafc' : 'white', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}
              >
                Siguiente
              </button>
            </div>
          )}
        </main>

        <aside className="pos-sidebar">
          <div className="sidebar-tabs">
            <button
              className={`tab-btn ${activeTab === 'cart' ? 'active' : ''}`}
              onClick={() => setActiveTab('cart')}
            >
              <ShoppingCart size={18} /> Ventas
              {cart.length > 0 && <span className="tab-badge">{cart.length}</span>}
            </button>
            <button
              className={`tab-btn ${activeTab === 'expenses' ? 'active' : ''}`}
              onClick={() => setActiveTab('expenses')}
            >
              <MinusCircle size={18} /> Gastos
            </button>
          </div>

          {activeTab === 'cart' ? (
            <div className="cart-container animate-in">
              <div className="cart-list">
                {cart.map(item => (
                  <div key={item.variant_id} className="cart-item">
                    <div className="item-main">
                      <div className="item-desc">
                        <p className="name">{item.product_name}</p>
                        <p className="sub">{item.variant_name}</p>
                      </div>
                      <span className="item-price">${(item.price * item.quantity).toLocaleString()}</span>
                    </div>
                    <div className="item-actions">
                      <div className="qty-control">
                        <input
                          type="number"
                          value={item.quantity === 0 ? '' : item.quantity}
                          onFocus={() => {
                            setCart(prev => prev.map(i => i.variant_id === item.variant_id ? { ...i, quantity: 0 } : i));
                          }}
                          onBlur={() => {
                            if (!item.quantity) {
                              setCart(prev => prev.map(i => i.variant_id === item.variant_id ? { ...i, quantity: 1 } : i));
                            }
                          }}
                          onChange={(e) => {
                            const valStr = e.target.value;
                            const val = valStr === '' ? 0 : parseInt(valStr);
                            setCart(prev => prev.map(i => i.variant_id === item.variant_id ? { ...i, quantity: isNaN(val) ? 0 : val } : i));
                          }}
                        />
                      </div>
                      <div className="discount-area">
                        <button className="btn-percent-only" title="Aplicar Descuento %" onClick={() => setShowPercentModal(item.variant_id)}>
                          <Percent size={14} /> <span>Dto.</span>
                        </button>
                        {item.discount > 0 && (
                          <span className="discount-applied">-${item.discount.toLocaleString()}</span>
                        )}
                      </div>
                      <button className="btn-remove" onClick={() => removeFromCart(item.variant_id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
                {cart.length === 0 && (
                  <div className="empty-state">
                    <Receipt size={40} />
                    <p>El carrito está vacío</p>
                  </div>
                )}
              </div>

              <div className="cart-checkout-form">
                <CustomSelect
                  label="Método de Pago"
                  value={paymentMethod}
                  onChange={(val: any) => setPaymentMethod(val)}
                  options={[
                    { value: 'CASH', label: 'Efectivo', icon: <Banknote size={16} /> },
                    { value: 'CARD', label: 'Tarjeta', icon: <CreditCard size={16} /> },
                    { value: 'BANK_TRANSFER', label: 'Transferencia', icon: <RefreshCcw size={16} /> },
                    { value: 'CREDIT', label: 'Crédito', icon: <ShieldCheck size={16} /> }
                  ]}
                />

                {paymentMethod === 'BANK_TRANSFER' && (
                  <CustomSelect
                    label="Canal"
                    value={transferType}
                    onChange={(val: any) => setTransferType(val)}
                    options={[
                      { value: 'NEQUI', label: 'Nequi', icon: <Smartphone size={16} /> },
                      { value: 'DAVIPLATA', label: 'Daviplata', icon: <Smartphone size={16} /> },
                      { value: 'BANCOLOMBIA', label: 'Bancolombia', icon: <Wallet size={16} /> },
                      { value: 'OTHER', label: 'Otro', icon: <RefreshCcw size={16} /> }
                    ]}
                  />
                )}

                <div className="summary">
                  <div className="summary-row"><span>Subtotal</span><span>${calculateSubtotal().toLocaleString()}</span></div>
                  <div className="summary-row"><span>Dsctos. Item</span><span>-${calculateItemDiscounts().toLocaleString()}</span></div>
                  <div className="summary-row total"><span>Total a Pagar</span><span>${calculateTotal().toLocaleString()}</span></div>
                </div>

                {error && <div className="error-box"><AlertTriangle size={14} /> {error}</div>}

                <button className="btn-confirm" disabled={cart.length === 0 || isLoading || !activeSession} onClick={handleCheckout}>
                  {isLoading ? 'Procesando...' : 'CONFIRMAR VENTA'}
                </button>
              </div>
            </div>
          ) : (
            <div className="expenses-container animate-in">
              <div className="expense-form-header">
                <MinusCircle className="text-danger" size={24} />
                <h3>Registrar Gasto</h3>
                <p>Salida de dinero de la caja actual</p>
              </div>

              <div className="expense-form">
                <div className="form-group">
                  <label>Descripción</label>
                  <input
                    type="text"
                    placeholder="Ej: Pago de almuerzo, Transporte..."
                    value={expenseDesc}
                    onChange={(e) => setExpenseDesc(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Valor (COP)</label>
                  <div className="input-with-currency">
                    <span>$</span>
                    <input
                      type="text"
                      placeholder="0"
                      value={expenseAmount}
                      onChange={(e) => {
                        const rawValue = e.target.value.replace(/\D/g, '');
                        if (rawValue === '') {
                          setExpenseAmount('');
                        } else {
                          setExpenseAmount(parseInt(rawValue, 10).toLocaleString('es-CO'));
                        }
                      }}
                    />
                  </div>
                </div>

                <button
                  className="btn-save-expense"
                  disabled={!expenseDesc || !expenseAmount || isAddingExpense || !activeSession}
                  onClick={handleAddExpense}
                >
                  {isAddingExpense ? 'Guardando...' : 'GUARDAR GASTO'}
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* MODAL HISTORIAL */}
      {showHistory && (
        <div className="modal-overlay dark-blur">
          <div className="modal-history animate-slide-up">
            <div className="history-header">
              <div className="title-area">
                <History className="text-indigo" />
                <h2>Historial de Ventas</h2>
              </div>
              <button className="btn-close-circle" onClick={() => { setShowHistory(false); setSelectedSale(null); }}><X /></button>
            </div>

            <div className={`history-body ${selectedSale ? 'with-detail' : ''}`}>
              <div className="history-table-container">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Hora</th>
                      <th>Realizado por</th>
                      <th>Pago</th>
                      <th>Total</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesHistory.map(sale => (
                      <tr key={sale.id} className={selectedSale?.id === sale.id ? 'active-row' : ''}>
                        <td>{new Date(sale.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                        <td>{sale.profiles?.full_name || 'Sistema'}</td>
                        <td><span className={`method-badge ${sale.payment_method.toLowerCase()}`}>
                          {{
                            'CASH': 'Efectivo',
                            'CARD': 'Tarjeta',
                            'BANK_TRANSFER': 'Transferencia',
                            'CREDIT': 'Crédito'
                          }[sale.payment_method as string] || sale.payment_method}
                        </span></td>
                        <td className="font-bold">${sale.total_with_discount.toLocaleString()}</td>
                        <td>
                          <button className="btn-detail" onClick={() => setSelectedSale(sale)}>
                            <Eye size={16} /> Detalle
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selectedSale && (
                <div className="sale-detail-panel animate-in">
                  <div className="detail-header">
                    <h3>Venta #{selectedSale.id.slice(0, 8)}</h3>
                    <button className="btn-close-sm" onClick={() => setSelectedSale(null)}><X size={16} /></button>
                  </div>
                  <div className="detail-items">
                    {selectedSale.sale_items.map((item: any, i: number) => (
                      <div key={i} className="detail-item">
                        <div className="item-name">
                          <p>{item.products?.name || 'Producto'}</p>
                          <span>Cant: {item.quantity} x ${(item.unit_price).toLocaleString()}</span>
                        </div>
                        <div className="item-total">
                          ${(item.quantity * item.unit_price - (item.discount_amount || 0)).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="detail-footer">
                    <div className="footer-row"><span>Total:</span><span className="final-val">${selectedSale.total_with_discount.toLocaleString()}</span></div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL CERRAR CAJA (PREVIEW & CONFIRMATION) */}
      {showCloseModal && sessionSummary && (
        <div className="modal-overlay dark-blur">
          <div className="modal-summary animate-pop">
            <button className="btn-close-summary" onClick={() => setShowCloseModal(false)}><X size={20} /></button>
            <div className="summary-header">
              <AlertTriangle size={32} className="text-warning" />
              <h2>Confirmar Cierre</h2>
              <p>Revise los totales antes de finalizar</p>
            </div>

            <div className="summary-content">
              <div className="stat-card">
                <span className="label">Total Facturado</span>
                <span className="val">${sessionSummary.totalAmount.toLocaleString()}</span>
              </div>

              <div className="stat-row">
                <span>Efectivo en Ventas:</span>
                <span className="val-sm">${sessionSummary.cashSales.toLocaleString()}</span>
              </div>
              <div className="stat-row">
                <span>Otros Medios:</span>
                <span className="val-sm">${sessionSummary.otherSales.toLocaleString()}</span>
              </div>

              <div className="final-cash-box">
                <label>Efectivo Esperado en Caja</label>
                <h3>${(activeSession.initial_fund + sessionSummary.cashSales).toLocaleString()}</h3>
              </div>

              <div className={`commission-box ${sessionSummary.isCommissionEligible ? 'eligible' : ''}`}>
                <div className="comm-icon"><Award size={24} /></div>
                <div className="comm-info">
                  <span className="label">Comisión Estimada (1.2%)</span>
                  <span className="val">{sessionSummary.isCommissionEligible ? `$${sessionSummary.commissionEarned.toLocaleString()}` : '$0'}</span>
                </div>
                {!sessionSummary.isCommissionEligible && <p className="comm-hint">Meta mínima: $1.800.000</p>}
              </div>
            </div>

            <div className="modal-actions-horizontal">
              <button className="btn-cancel-close" onClick={() => setShowCloseModal(false)}>CANCELAR</button>
              <button className="btn-confirm-close-final" disabled={isClosing} onClick={handleConfirmFinalClose}>
                {isClosing ? 'CERRANDO...' : 'SÍ, CERRAR CAJA'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL APERTURA CAJA */}
      {showOpenSession && (
        <div className="modal-overlay dark-blur">
          <div className="modal-session animate-slide-up">
            <div className="session-header">
              <div className="icon-wrap"><Lock size={24} /></div>
              <h2>Apertura de Caja</h2>
              <p>Complete la información para habilitar las ventas</p>
            </div>

            <div className="session-body">
              <div className="info-grid">
                <div className="info-item">
                  <label><UserIcon size={14} /> Responsable</label>
                  <div className="val">{userProfile?.full_name || 'Cargando...'}</div>
                </div>
                <div className="info-item">
                  <label><Calendar size={14} /> Fecha</label>
                  <div className="val">{currentTime.toLocaleDateString()}</div>
                </div>
                <div className="info-item">
                  <label><Clock size={14} /> Hora</label>
                  <div className="val">{currentTime.toLocaleTimeString()}</div>
                </div>
              </div>

              <div className="fund-input-area">
                <label>Efectivo Inicial en Caja</label>
                <div className="fund-input-wrapper">
                  <span className="currency">$</span>
                  <input
                    type="text"
                    placeholder="0"
                    value={initialFund}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, '');
                      setInitialFund(raw ? parseInt(raw).toLocaleString('es-CO') : '');
                    }}
                    onFocus={() => {
                      // Seleccionar todo al hacer clic
                      const raw = String(initialFund).replace(/\D/g, '');
                      setInitialFund(raw === '0' ? '' : raw ? parseInt(raw).toLocaleString('es-CO') : '');
                    }}
                    autoFocus
                  />
                </div>
                <p className="help-text">Ingrese la base con la que inicia su turno</p>
              </div>

              {error && <div className="error-box-alt">{error}</div>}
            </div>

            <div className="session-footer">
              <button className="btn-session-confirm" disabled={isLoading} onClick={handleOpenSession}>
                {isLoading ? 'Abriendo...' : 'ACEPTAR Y COMENZAR'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUCCESS MODAL */}
      {successData && (
        <div className="modal-overlay dark-blur">
          <div className="modal-success animate-pop">
            <div className="success-icon"><CheckCircle size={60} /></div>
            <h2>¡Venta Exitosa!</h2>
            <p>Venta #{successData.saleId?.slice(0, 8) || 'Nueva'} ha sido registrada con éxito.</p>
            <div className="success-actions">
              <button className="btn-continue" onClick={() => setSuccessData(null)}>NUEVA VENTA</button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .pos-container { height: 100%; display: flex; flex-direction: column; background: #f1f5f9; overflow: hidden; position: relative; padding: 24px; gap: 20px; border-radius: 0; }
        
        /* GLOBAL TOAST */
        .toast-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.1); backdrop-filter: blur(1px); z-index: 2000; }
        .global-toast { position: fixed; top: 24px; right: 24px; background: #10b981; color: white; border-radius: 16px; padding: 16px 24px; z-index: 2001; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.2); overflow: hidden; }
        .toast-content { display: flex; align-items: center; gap: 16px; }
        .toast-title { font-weight: 800; font-size: 1rem; margin: 0; }
        .toast-sub { font-size: 0.85rem; opacity: 0.9; margin: 2px 0 0; }
        .toast-progress { position: absolute; bottom: 0; left: 0; height: 4px; background: rgba(255,255,255,0.3); width: 100%; animation: progress 3s linear forwards; }
        @keyframes progress { from { width: 100%; } to { width: 0%; } }

        /* PERCENT MODAL */
        .modal-percent { background: white; padding: 24px; border-radius: 20px; width: 300px; text-align: center; }
        .percent-header { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 20px; color: #6366f1; }
        .percent-header h3 { margin: 0; font-size: 1.1rem; }
        .percent-body input { width: 100%; padding: 12px; border: 2px solid #e2e8f0; border-radius: 12px; font-size: 1.5rem; text-align: center; font-weight: 700; outline: none; }
        .percent-body input:focus { border-color: #6366f1; }
        .percent-footer { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 20px; }
        .btn-cancel-sm { padding: 10px; background: #f1f5f9; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; }
        .btn-confirm-sm { padding: 10px; background: #6366f1; color: white; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; }

        .pos-status-bar { display: flex; gap: 24px; padding: 12px 24px; background: white; border-radius: 16px; border: 1px solid #e2e8f0; align-items: center; min-height: 57px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .status-item { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: #64748b; }
        .status-item.highlight { margin-left: auto; color: #6366f1; background: #f5f3ff; padding: 4px 12px; border-radius: 99px; }
        .status-item.highlight.sales { margin-left: 0; color: #10b981; background: #dcfce7; }
        .text-success { color: #10b981; }
        .text-danger { color: #ef4444; }

        .status-actions { display: flex; gap: 12px; margin-left: auto; }
        .btn-history-trigger, .btn-close-session { display: flex; align-items: center; gap: 8px; border: 1px solid #e2e8f0; padding: 6px 16px; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .btn-history-trigger { background: #f1f5f9; color: #475569; }
        .btn-history-trigger:hover { background: #e2e8f0; }
        .btn-close-session { background: #fff1f2; color: #ef4444; border-color: #fecaca; }
        .btn-close-session:hover:not(:disabled) { background: #ef4444; color: white; }
        .btn-close-session:disabled { opacity: 0.5; cursor: not-allowed; }

        .pos-grid { display: grid; grid-template-columns: 1fr 400px; flex: 1; overflow: hidden; gap: 20px; }
        
        .pos-main { padding: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 24px; }
        .search-input-wrapper { position: relative; width: 100%; }
        .search-input { width: 100%; padding: 16px 24px; border-radius: 16px; border: 1px solid #e2e8f0; font-size: 1.1rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
        .search-input.no-icon { padding-left: 24px; }
        .search-input:focus { border-color: #6366f1; outline: none; }

        .results-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; min-height: 200px; }
        .product-card { background: white; padding: 16px; border-radius: 16px; border: 1px solid #e2e8f0; cursor: pointer; transition: all 0.2s; }
        .product-card:hover { transform: translateY(-4px); border-color: #6366f1; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
        .card-top { display: flex; justify-content: space-between; margin-bottom: 12px; }
        .sku { font-size: 0.7rem; color: #94a3b8; font-family: monospace; }
        .stock-badge { font-size: 0.7rem; padding: 2px 8px; border-radius: 4px; background: #f1f5f9; font-weight: 600; }
        .stock-badge.low { background: #fee2e2; color: #ef4444; }
        .product-card h3 { font-size: 0.95rem; font-weight: 700; color: #1e293b; margin: 0 0 4px; }
        .variant { font-size: 0.8rem; color: #64748b; }
        .card-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; }
        .price { font-size: 1.15rem; font-weight: 800; color: #6366f1; }
        .btn-add-quick { font-size: 0.75rem; background: #f5f3ff; color: #6366f1; border: none; padding: 4px 10px; border-radius: 6px; font-weight: 600; }

        .pos-sidebar { background: white; border-radius: 20px; border: 1px solid #e2e8f0; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
        .sidebar-tabs { display: grid; grid-template-columns: 1fr 1fr; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
        .tab-btn { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 16px; border: none; background: none; font-size: 0.9rem; font-weight: 600; color: #64748b; cursor: pointer; transition: all 0.2s; position: relative; }
        .tab-btn.active { color: #6366f1; background: white; }
        .tab-btn.active::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: #6366f1; }
        .tab-badge { font-size: 0.7rem; background: #6366f1; color: white; padding: 2px 6px; border-radius: 10px; }

        .cart-container, .expenses-container { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .animate-in { animation: fadeIn 0.3s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

        .cart-list { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
        .cart-item { background: #f8fafc; border-radius: 12px; padding: 12px; border: 1px solid #f1f5f9; }
        .item-main { display: flex; justify-content: space-between; margin-bottom: 8px; }
        .name { font-size: 0.9rem; font-weight: 600; color: #1e293b; margin: 0; }
        .sub { font-size: 0.75rem; color: #64748b; margin: 0; }
        .item-price { font-weight: 700; color: #1e293b; font-size: 0.9rem; }
        .item-actions { display: flex; align-items: center; gap: 8px; }
        .qty-control input { width: 45px; padding: 4px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.8rem; text-align: center; }
        
        .discount-area { display: flex; align-items: center; gap: 8px; flex: 1; }
        .btn-percent-only { background: #f5f3ff; color: #6366f1; border: 1px solid #e0e7ff; padding: 6px 12px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 4px; font-weight: 600; font-size: 0.75rem; transition: all 0.2s; }
        .btn-percent-only:hover { background: #6366f1; color: white; border-color: #6366f1; }
        .discount-applied { font-size: 0.75rem; color: #ef4444; font-weight: 700; background: #fee2e2; padding: 2px 6px; border-radius: 4px; }

        .btn-remove { padding: 6px; color: #94a3b8; background: none; border: none; cursor: pointer; }
        .btn-remove:hover { color: #ef4444; }

        .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #94a3b8; gap: 12px; }

        .cart-checkout-form { padding: 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; flex-direction: column; gap: 16px; }
        .form-group { display: flex; flex-direction: column; gap: 6px; }
        .form-group label { font-size: 0.75rem; font-weight: 700; color: #64748b; text-transform: uppercase; }
        .form-group select, .form-group input { padding: 10px; border-radius: 10px; border: 1px solid #e2e8f0; outline: none; background: white; font-size: 0.95rem; }
        .form-group input:focus { border-color: #6366f1; }

        .summary { margin-top: 8px; padding-top: 16px; border-top: 1px dashed #cbd5e1; }
        .summary-row { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.9rem; color: #64748b; }
        .summary-row.total { margin-top: 12px; color: #1e293b; font-weight: 800; font-size: 1.25rem; }

        .btn-confirm { background: #6366f1; color: white; border: none; padding: 16px; border-radius: 12px; font-weight: 700; font-size: 1rem; cursor: pointer; transition: all 0.2s; }
        .btn-confirm:hover { background: #4f46e5; transform: translateY(-2px); box-shadow: 0 10px 15px -3px rgba(99, 102, 241, 0.3); }
        .btn-confirm:disabled { background: #cbd5e1; cursor: not-allowed; transform: none; }

        /* EXPENSES STYLES */
        .expenses-container { padding: 24px; }
        .expense-form-header { text-align: center; margin-bottom: 24px; }
        .expense-form-header h3 { margin: 12px 0 4px; font-size: 1.1rem; color: #1e293b; }
        .expense-form-header p { font-size: 0.85rem; color: #64748b; }
        .expense-form { display: flex; flex-direction: column; gap: 20px; position: relative; }
        .input-with-currency { position: relative; display: flex; align-items: center; }
        .input-with-currency span { position: absolute; left: 12px; color: #94a3b8; font-weight: 700; }
        .input-with-currency input { width: 100%; padding-left: 28px !important; }
        .btn-save-expense { background: #ef4444; color: white; border: none; padding: 16px; border-radius: 12px; font-weight: 700; cursor: pointer; transition: all 0.2s; margin-top: 8px; }
        .btn-save-expense:hover:not(:disabled) { background: #dc2626; transform: translateY(-2px); box-shadow: 0 10px 15px -3px rgba(239, 68, 68, 0.3); }
        .btn-save-expense:disabled { opacity: 0.5; cursor: not-allowed; }

        /* SKELETON STYLES */
        .skeleton-box { background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; border-radius: 6px; }
        @keyframes skeleton-loading { from { background-position: 200% 0; } to { background-position: -200% 0; } }
        .skeleton-effect { opacity: 0.7; }

        /* ANIMATIONS */
        .animate-slide-in-right { animation: slideInRight 0.5s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .animate-fade-in { animation: fadeIn 0.3s ease; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .animate-pop { animation: pop 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes pop { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }

        /* OTHER MODALS (HISTORY, CLOSE, OPEN, SUCCESS) */
        .modal-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.4); display: flex; justify-content: center; align-items: center; z-index: 1000; }
        .dark-blur { backdrop-filter: blur(8px); background: rgba(0,0,0,0.6); }
        .modal-history { background: white; width: 95%; max-width: 1100px; height: 85vh; border-radius: 24px; display: grid; grid-template-rows: auto 1fr; overflow: hidden; }
        .history-header { padding: 24px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
        .title-area { display: flex; align-items: center; gap: 12px; }
        .history-body { display: grid; grid-template-columns: 1fr; overflow: hidden; transition: all 0.3s ease; }
        .history-body.with-detail { grid-template-columns: 1fr 380px; }
        .history-table-container { overflow-y: auto; padding: 24px; }
        .history-table { width: 100%; border-collapse: collapse; }
        .history-table th { text-align: center; padding: 12px; font-size: 0.75rem; color: #64748b; text-transform: uppercase; border-bottom: 2px solid #f1f5f9; }
        .history-table td { text-align: center; vertical-align: middle; padding: 12px; border-bottom: 1px solid #f1f5f9; font-size: 0.9rem; }
        .active-row { background: #f5f3ff; }
        .method-badge { font-size: 0.7rem; padding: 2px 8px; border-radius: 4px; font-weight: 600; text-transform: uppercase; }
        .method-badge.cash { background: #dcfce7; color: #10b981; }
        .method-badge.card { background: #e0e7ff; color: #4f46e5; }
        .btn-detail { display: inline-flex; align-items: center; justify-content: center; gap: 4px; background: #6366f1; color: white; border: none; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; margin: 0 auto; }
        .sale-detail-panel { background: #f8fafc; border-left: 1px solid #e2e8f0; display: flex; flex-direction: column; overflow: hidden; }
        .detail-header { padding: 20px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
        .detail-items { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
        .detail-item { display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
        .item-name p { font-size: 0.85rem; font-weight: 600; margin: 0; }
        .item-name span { font-size: 0.75rem; color: #64748b; }
        .item-total { font-weight: 700; font-size: 0.9rem; }
        .detail-footer { padding: 20px; background: white; border-top: 1px solid #e2e8f0; }
        .final-val { font-size: 1.2rem; font-weight: 800; color: #6366f1; }

        .modal-summary { background: white; padding: 40px; border-radius: 32px; max-width: 480px; width: 100%; text-align: center; position: relative; }
        .btn-close-summary { position: absolute; top: 20px; right: 20px; background: #f1f5f9; border: none; border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #64748b; }
        .btn-close-summary:hover { background: #fee2e2; color: #ef4444; }
        .summary-header h2 { margin: 16px 0 8px; font-size: 1.5rem; }
        .summary-content { margin: 24px 0; display: flex; flex-direction: column; gap: 12px; }
        .stat-card { background: #f8fafc; padding: 16px; border-radius: 16px; display: flex; flex-direction: column; border: 1px solid #e2e8f0; }
        .stat-card .label { font-size: 0.75rem; color: #64748b; font-weight: 600; text-transform: uppercase; }
        .stat-card .val { font-size: 1.5rem; font-weight: 800; color: #1e293b; }
        .stat-row { display: flex; justify-content: space-between; padding: 0 8px; color: #64748b; font-size: 0.9rem; }
        .final-cash-box { margin-top: 12px; padding: 16px; background: #f8fafc; border-radius: 16px; border: 1px solid #e2e8f0; }
        .final-cash-box label { font-size: 0.8rem; font-weight: 700; color: #64748b; }
        .final-cash-box h3 { font-size: 2rem; color: #1e293b; margin: 4px 0 0; }
        .commission-box { margin-top: 16px; display: flex; align-items: center; gap: 16px; padding: 16px; background: #f8fafc; border-radius: 16px; border: 1px solid #e2e8f0; text-align: left; }
        .commission-box.eligible { background: #f0fdf4; border-color: #bbf7d0; }
        .comm-icon { width: 48px; height: 48px; background: white; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: #94a3b8; }
        .eligible .comm-icon { color: #10b981; }
        .comm-info { display: flex; flex-direction: column; }
        .comm-info .label { font-size: 0.7rem; color: #64748b; font-weight: 700; text-transform: uppercase; }
        .comm-info .val { font-size: 1.25rem; font-weight: 800; color: #1e293b; }
        .eligible .comm-info .val { color: #10b981; }
        .comm-hint { font-size: 0.65rem; color: #94a3b8; margin-top: 4px; font-weight: 600; }
        .modal-actions-horizontal { display: flex; gap: 12px; margin-top: 24px; }
        .btn-cancel-close { flex: 1; padding: 16px; background: #f1f5f9; color: #475569; border: none; border-radius: 16px; font-weight: 700; cursor: pointer; }
        .btn-confirm-close-final { flex: 2; padding: 16px; background: #6366f1; color: white; border: none; border-radius: 16px; font-weight: 700; cursor: pointer; }
        .btn-confirm-close-final:disabled { opacity: 0.5; cursor: not-allowed; }

        .modal-session { background: white; width: 100%; max-width: 480px; border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
        .session-header { padding: 32px 32px 20px; text-align: center; }
        .icon-wrap { width: 60px; height: 60px; background: #f5f3ff; color: #6366f1; border-radius: 20px; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; }
        .session-header h2 { margin: 0; font-size: 1.5rem; color: #1e293b; }
        .session-header p { color: #64748b; margin: 8px 0 0; }
        .session-body { padding: 0 32px 32px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; background: #f8fafc; padding: 16px; border-radius: 16px; margin-bottom: 24px; }
        .info-item label { font-size: 0.65rem; color: #94a3b8; font-weight: 700; text-transform: uppercase; display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
        .info-item .val { font-size: 0.9rem; font-weight: 600; color: #1e293b; }
        .fund-input-area { text-align: center; }
        .fund-input-area label { display: block; font-size: 0.85rem; font-weight: 700; color: #475569; margin-bottom: 12px; }
        .fund-input-wrapper { position: relative; width: fit-content; margin: 0 auto; }
        .currency { position: absolute; left: 0; top: 50%; transform: translateY(-50%); font-size: 2rem; font-weight: 800; color: #cbd5e1; }
        .fund-input-wrapper input { border: none; border-bottom: 2px solid #e2e8f0; font-size: 1.8rem; width: 240px; text-align: center; padding: 0 30px; font-weight: 800; color: #1e293b; outline: none; transition: border-color 0.2s; }
        .fund-input-wrapper input:focus { border-color: #6366f1; }
        .help-text { font-size: 0.75rem; color: #94a3b8; margin-top: 12px; }
        .session-footer { padding: 0 32px 32px; }
        .btn-session-confirm { width: 100%; padding: 16px; border-radius: 16px; border: none; background: #6366f1; color: white; font-weight: 700; font-size: 1rem; cursor: pointer; transition: all 0.2s; }
        .btn-session-confirm:hover { background: #4f46e5; transform: scale(1.02); }
        .error-box-alt { margin-top: 16px; background: #fef2f2; color: #ef4444; padding: 12px; border-radius: 12px; font-size: 0.85rem; text-align: center; font-weight: 600; border: 1px solid #fee2e2; }

        .modal-success { background: white; padding: 48px; border-radius: 32px; text-align: center; max-width: 400px; width: 100%; }
        .success-icon { color: #10b981; margin-bottom: 24px; }
        .modal-success h2 { font-size: 1.75rem; margin-bottom: 12px; }
        .modal-success p { color: #64748b; margin-bottom: 32px; }
        .success-actions { display: flex; flex-direction: column; gap: 12px; }
        .btn-continue { background: #6366f1; color: white; border: none; padding: 16px; border-radius: 16px; font-weight: 700; cursor: pointer; }

        .btn-close-circle { background: #f1f5f9; border: none; border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #64748b; }
        .btn-close-circle:hover { background: #ef4444; color: white; }
      `}</style>
    </div>
  );
}
