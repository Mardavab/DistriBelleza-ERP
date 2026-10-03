'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ShoppingCart, Eye, ChevronRight, ChevronLeft, Building2,
  MinusCircle, Receipt, Percent, History, X, Trash2,
} from 'lucide-react';
import { searchPOSProducts, processPOSSale, POSItem, getDefaultProducts } from '../../app/actions/sales';
import { getUserProfile } from '../../app/actions/auth';
import { getSalesHistory } from '../../app/actions/sales_history';
import { getCommissionGoalFormatted } from '../../app/actions/reports';
import { getCurrentCompanyIdAction, getCurrentCompanyAction } from '../../app/actions/company';
import {
  getActiveCashSession,
  getCashSessionSummary,
  closeCashSession,
} from '../../app/actions/cash_actions';
import { ReceiptData } from './PrintReceipt';
import { PRINT_SERVICE_URL } from '../../lib/constants';
import {
  CartItem,
  POSMode,
  PaymentMethod,
  TransferType,
  loadPosSession,
  savePosSession,
  clearPosSession,
} from './types';
import CartPanel from './CartPanel';
import CheckoutForm from './CheckoutForm';
import ProductSearch, { SearchResult } from './ProductSearch';
import PosStatusBar from './PosStatusBar';
import PosSidebarTabs from './PosSidebarTabs';
import PosToasts from './PosToasts';
import OpenSessionModal from './OpenSessionModal';
import CloseSessionModal from './CloseSessionModal';
import PercentDiscountModal from './PercentDiscountModal';
import DeleteConfirmModal from './DeleteConfirmModal';
import SuccessModal from './SuccessModal';
import ExpenseForm from './ExpenseForm';
import ExpenseSuccessModal from './ExpenseSuccessModal';
import './POS.css';

// SKELETON COMPONENTS
function SkeletonProductRow() {
  return (
    <div className="product-row skeleton-effect" style={{ pointerEvents: 'none' }}>
      <div className="skeleton-box" style={{ width: '80px', height: '14px' }}></div>
      <div className="product-info" style={{ flex: 1 }}>
        <div className="skeleton-box" style={{ width: '60%', height: '14px', marginBottom: '4px' }}></div>
        <div className="skeleton-box" style={{ width: '40%', height: '12px' }}></div>
      </div>
      <div className="skeleton-box" style={{ width: '60px', height: '14px' }}></div>
      <div className="skeleton-box" style={{ width: '50px', height: '14px' }}></div>
      <div className="skeleton-box" style={{ width: '70px', height: '14px' }}></div>
      <div className="skeleton-box" style={{ width: '50px', height: '24px' }}></div>
    </div>
  );
}

export default function POS() {
  const router = useRouter();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  // P1.1: Hidratar cart desde localStorage en el primer render (lazy initializer)
  // Esto elimina race conditions con useEffect que sobreescribían el cart.
  const [cart, setCart] = useState<CartItem[]>(() => {
    const saved = loadPosSession();
    return saved?.cart ?? [];
  });
  const [activeSession, setActiveSession] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);

  // Barcode & feedback states
  const [showProductAdded, setShowProductAdded] = useState(false);
  const [addedProductName, setAddedProductName] = useState('');
  const barcodeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Tabs state
  const [activeTab, setActiveTab] = useState<'cart' | 'expenses' | 'major'>('cart');

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
  const [lastExpense, setLastExpense] = useState<{ description: string; amount: number } | null>(null);

  // Discount Modal state
  const [showPercentModal, setShowPercentModal] = useState<string | null>(null); // item ID
  const [percentValue, setPercentValue] = useState<string>('');

  // Venta state
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'BANK_TRANSFER' | 'CREDIT'>(() => {
    const saved = loadPosSession();
    return saved?.paymentMethod ?? 'CASH';
  });
  const [transferType, setTransferType] = useState<'NEQUI' | 'DAVIPLATA' | 'BANCOLOMBIA' | 'OTHER' | 'QR'>(() => {
    const saved = loadPosSession();
    return saved?.transferType ?? 'NEQUI';
  });
  const [customerId, setCustomerId] = useState<string>(() => {
    const saved = loadPosSession();
    return saved?.customerId ?? '';
  });
  const [totalDiscount, setTotalDiscount] = useState<string | number>(() => {
    const saved = loadPosSession();
    return saved?.totalDiscount ?? 0;
  });

  // Modal state
  const [showOpenSession, setShowOpenSession] = useState(false);
  const [initialFund, setInitialFund] = useState<string | number>('');
  const [successData, setSuccessData] = useState<any>(null);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saleToDelete, setSaleToDelete] = useState<string | null>(null);
  const [cashReceived, setCashReceived] = useState<string | number>(() => {
    const saved = loadPosSession();
    return saved?.cashReceived ?? '';
  });

  const [currentTime, setCurrentTime] = useState(new Date());

  // Pagination for Default Products
  const [isShowingDefaults, setIsShowingDefaults] = useState(false);
  const [commissionGoalFormatted, setCommissionGoalFormatted] = useState('$1.800.000');
  const [showRestoredToast, setShowRestoredToast] = useState(false);

  const loadInitialData = async () => {
    setIsLoading(true);
    const [session, profile, goalFormatted] = await Promise.all([
      getActiveCashSession(),
      getUserProfile(),
      getCommissionGoalFormatted()
    ]);
    setActiveSession(session);
    setUserProfile(profile);
    setCommissionGoalFormatted(goalFormatted);
    if (!session) setShowOpenSession(true);
    else setShowOpenSession(false);
    setIsLoading(false);
  };

  useEffect(() => {
    loadInitialData();
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // P1.1: Mostrar toast de "Carrito restaurado" si había sesión guardada.
  // Los estados ya están hidratados vía lazy initializer en useState,
  // así que este effect SOLO dispara el toast.
  useEffect(() => {
    if (cart.length > 0) {
      setShowRestoredToast(true);
      const timer = setTimeout(() => setShowRestoredToast(false), 3500);
      return () => clearTimeout(timer);
    }
  }, []);

  // P1.1: Persistir sesión POS cada vez que cambian los datos relevantes
  useEffect(() => {
    savePosSession({
      cart,
      cashReceived,
      customerId,
      totalDiscount,
      paymentMethod,
      transferType,
    });
  }, [cart, cashReceived, customerId, totalDiscount, paymentMethod, transferType]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showOpenSession || showHistory || showCloseModal || showPercentModal || successData) return;

      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'F4') {
        e.preventDefault();
        if (cart.length > 0 && activeSession && !isLoading) {
          handleCheckout();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, activeSession, isLoading, showOpenSession, showHistory, showCloseModal, showPercentModal, successData]);

  // Auto-focus on search input when session becomes available
  useEffect(() => {
    if (activeSession && !isLoading) {
      const timer = setTimeout(() => searchInputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [activeSession, isLoading]);

  const loadHistory = async () => {
    setIsLoading(true);
    const res = await getSalesHistory();
    if (res.success) {
      setSalesHistory(res.data || []);
      setShowHistory(true);
    }
    setIsLoading(false);
  };

  const handleDeleteSale = async (saleId: string) => {
    setSaleToDelete(saleId);
  };


  // Simple in-memory cache for default products pages
  const defaultProductsCache = React.useRef<Record<number, { data: any[], count: number }>>({});

  const loadDefaultProducts = async (forceRefresh = false) => {
    if (!forceRefresh && defaultProductsCache.current[1]) {
      const cached = defaultProductsCache.current[1];
      setSearchResults(cached.data);
      setIsShowingDefaults(true);
      return;
    }
    setIsSearching(true);
    const res = await getDefaultProducts(1, 200);
    defaultProductsCache.current[1] = res;
    setSearchResults(res.data);
    setIsShowingDefaults(true);
    setIsSearching(false);
  };

  const refreshSearchResults = useCallback(async () => {
    if (searchTerm.length >= 2) {
      setIsSearching(true);
      const results = await searchPOSProducts(searchTerm);
      setSearchResults(results);
      setIsSearching(false);
    } else if (isShowingDefaults) {
      loadDefaultProducts(true);
    }
  }, [searchTerm, isShowingDefaults]);

  const isBarcode = (value: string): boolean => /^\d{13}$/.test(value);

  const addToCart = useCallback((product: any) => {
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
    setAddedProductName(product.product_name);
    setShowProductAdded(true);
    setTimeout(() => setShowProductAdded(false), 2000);
    searchInputRef.current?.focus();
  }, []);

  const handleBarcodeScan = useCallback(async (code: string) => {
    const results = await searchPOSProducts(code);
    if (results.length === 1) {
      addToCart(results[0]);
      setAddedProductName(results[0].product_name);
      setShowProductAdded(true);
      setTimeout(() => setShowProductAdded(false), 2000);
      setSearchTerm('');
    } else if (results.length > 1) {
      setSearchResults(results);
      setIsShowingDefaults(false);
    }
  }, [addToCart]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchTerm.length >= 2) {
        if (isBarcode(searchTerm)) {
          handleBarcodeScan(searchTerm);
          return;
        }
        setIsSearching(true);
        setIsShowingDefaults(false);
        const results = await searchPOSProducts(searchTerm);
        setSearchResults(results);
        setIsSearching(false);
      } else {
        loadDefaultProducts();
      }
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm]);

  const updateItemDiscount = (id: string, discount: number) => {
    setCart(prev => prev.map(item => item.variant_id === id ? { ...item, discount } : item));
  };


  const calculateSubtotal = () => cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const calculateItemDiscounts = () => cart.reduce((sum, item) => sum + Number(item.discount), 0);
  const calculateTotal = () => calculateSubtotal() - calculateItemDiscounts() - Number(totalDiscount);


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
      if (res.receipt) {
        // companyId + branding se inyectan en runtime para el print service
        const currentCompanyId = await getCurrentCompanyIdAction();
        const currentCompany = await getCurrentCompanyAction();
        setReceiptData({
          ...res.receipt,
          openDrawer: paymentMethod === 'CASH',
          companyId: currentCompanyId,
          branding: {
            header: currentCompany?.settings.receipt_header,
            footer: currentCompany?.settings.receipt_footer,
          },
        });
      }
      setCart([]);
      setCustomerId('');
      setTotalDiscount(0);
      setCashReceived('');
      clearPosSession(); // P1.1: limpiar localStorage al completar venta
      await loadInitialData();
      await refreshSearchResults();
      router.refresh();

      // Auto-open cash drawer for CASH payments
      if (paymentMethod === 'CASH') {
        fetch(`${PRINT_SERVICE_URL}/open-drawer`, { method: 'POST' }).catch(() => {});
      }
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
      <PosToasts
        showProductAdded={showProductAdded}
        showRestoredToast={showRestoredToast}
        addedProductName={addedProductName}
      />

      <PercentDiscountModal
        itemId={showPercentModal}
        cart={cart}
        onApply={(id, amount) => {
          updateItemDiscount(id, amount);
          setShowPercentModal(null);
        }}
        onClose={() => setShowPercentModal(null)}
      />

      {/* STATUS BAR */}
      <PosStatusBar
        isLoading={isLoading}
        userProfile={userProfile}
        activeSession={activeSession}
        onLoadHistory={loadHistory}
        onRequestClose={handleRequestClose}
      />

      <div className="pos-grid">
        <main className="pos-main">
          <ProductSearch
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            searchResults={searchResults as SearchResult[]}
            isSearching={isSearching}
            disabled={!activeSession || isLoading}
            inputRef={searchInputRef}
            onAddToCart={addToCart}
          />
        </main>

        <aside className="pos-sidebar">
          <PosSidebarTabs
            activeTab={activeTab}
            cartCount={cart.length}
            onTabChange={setActiveTab}
            tabs={[
              { id: 'cart', label: 'Ventas', icon: <ShoppingCart size={18} /> },
              { id: 'expenses', label: 'Gastos', icon: <MinusCircle size={18} /> },
            ]}
          />

          {activeTab === 'cart' ? (
            <div className="cart-container animate-in">
              <CartPanel
                cart={cart}
                setCart={setCart}
                onRemoveItem={removeFromCart}
                onPercentDiscount={(variantId) => setShowPercentModal(variantId)}
              />
              <CheckoutForm
                paymentMethod={paymentMethod}
                setPaymentMethod={setPaymentMethod}
                transferType={transferType}
                setTransferType={setTransferType}
                cashReceived={cashReceived}
                setCashReceived={setCashReceived}
                calculateSubtotal={calculateSubtotal}
                calculateItemDiscounts={calculateItemDiscounts}
                calculateTotal={calculateTotal}
                cartIsEmpty={cart.length === 0}
                isLoading={isLoading}
                hasActiveSession={!!activeSession}
                error={error}
                onConfirm={handleCheckout}
              />
            </div>
          ) : activeTab === 'expenses' ? (
            <ExpenseForm
              hasActiveSession={!!activeSession}
              onAdded={(data) => {
                setLastExpense(data);
                router.refresh();
              }}
              onError={(msg) => setError(msg)}
            />
          ) : null}
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
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                            <button className="btn-detail" onClick={() => setSelectedSale(sale)}>
                              <Eye size={16} /> Detalle
                            </button>
                            <button className="btn-delete-history" onClick={() => handleDeleteSale(sale.id)} title="Eliminar Venta">
                              <Trash2 size={16} />
                            </button>
                          </div>
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
      {showCloseModal && sessionSummary && activeSession && (
        <CloseSessionModal
          sessionId={activeSession.id}
          sessionSummary={sessionSummary}
          initialFund={activeSession.initial_fund}
          commissionGoalFormatted={commissionGoalFormatted}
          onClose={() => setShowCloseModal(false)}
          onSuccess={() => {
            setShowCloseModal(false);
            setActiveSession(null);
            setSessionSummary(null);
            setShowOpenSession(true);
            loadInitialData();
          }}
        />
      )}

      {/* MODAL APERTURA CAJA */}
      {showOpenSession && (
        <OpenSessionModal
          userProfile={userProfile}
          onOpened={async () => {
            setShowOpenSession(false);
            await loadInitialData();
          }}
          onClose={() => setShowOpenSession(false)}
        />
      )}

      {/* DELETE CONFIRMATION MODAL */}
      <DeleteConfirmModal
        saleId={saleToDelete}
        onClose={() => setSaleToDelete(null)}
        onDeleted={async () => {
          setSaleToDelete(null);
          if (selectedSale?.id === saleToDelete) setSelectedSale(null);
          const historyRes = await getSalesHistory();
          if (historyRes.success) setSalesHistory(historyRes.data || []);
          router.refresh();
        }}
        onError={(msg) => setError(msg)}
      />

      {/* SUCCESS MODAL */}
      {successData && (
        <SuccessModal
          successData={successData}
          receiptData={receiptData}
          onPrintDone={() => setReceiptData(null)}
          onNewSale={() => { setSuccessData(null); setReceiptData(null); }}
        />
      )}

      {/* EXPENSE SUCCESS MODAL */}
      <ExpenseSuccessModal
        expense={lastExpense}
        onClose={() => setLastExpense(null)}
        onNewExpense={() => {
          setLastExpense(null);
          setExpenseDesc('');
          setExpenseAmount('');
        }}
      />


    </div>
  );
}
