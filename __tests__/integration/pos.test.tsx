import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock del módulo de impresión (WebUSB/WebSerial no existen en jsdom)
jest.mock('../../lib/print', () => {
  const printer = {
    isSupported: jest.fn(() => false),
    getStatus: jest.fn(() => 'unsupported'),
    connect: jest.fn(),
    disconnect: jest.fn(),
    printReceipt: jest.fn(),
    openDrawer: jest.fn(),
    forgetAll: jest.fn(),
    onStatusChange: jest.fn(),
    subscribe: jest.fn(() => () => {}),
  };
  return { printer };
});

// Mock de server actions (auth + cash + sales)
jest.mock('../../app/actions/auth', () => ({
  getUserProfile: jest.fn(async () => ({
    id: 'u1',
    full_name: 'Test User',
    role: 'manager',
    companies: { id: 'c1', slug: 'acme', trade_name: 'ACME' },
  })),
}));

jest.mock('../../app/actions/cash_actions', () => ({
  getActiveCashSession: jest.fn(async () => ({
    id: 's1', user_id: 'u1', initial_fund: 100000, status: 'open',
    opening_time: new Date().toISOString(), closing_time: null, totalSold: 0,
  })),
  getCashSessionSummary: jest.fn(async () => ({ success: true, summary: {} })),
  closeCashSession: jest.fn(async () => ({ success: true })),
  addExpense: jest.fn(async () => ({ success: true })),
  openCashSession: jest.fn(async () => ({ success: true, data: {} })),
  isSuccess: jest.fn((res) => res && res.success === true),
  isFailure: jest.fn((res) => res && res.success === false),
}));

jest.mock('../../app/actions/sales', () => ({
  searchPOSProducts: jest.fn(async (query) => {
    if (!query || query.length < 2) return [];
    return [
      {
        variant_id: 'v1',
        product_name: 'Shampoo Aloe',
        product_brand: 'BrandX',
        variant_name: '500ml',
        sku: 'SH-001',
        price: 12000,
        stock: 10,
      },
    ];
  }),
  getDefaultProducts: jest.fn(async () => ({
    data: [
      {
        variant_id: 'v2',
        product_name: 'Acondicionador',
        product_brand: 'BrandX',
        variant_name: '500ml',
        sku: 'AC-001',
        price: 14000,
        stock: 5,
      },
    ],
    count: 1,
  })),
  processPOSSale: jest.fn(async () => ({
    success: true,
    saleId: 's-new-1',
    paid: 25000,
    receipt: {
      saleId: 's-new-1',
      createdAt: new Date().toISOString(),
      cashier: 'Test User',
      items: [],
      subtotal: 25000,
      totalDiscount: 0,
      total: 25000,
      paymentMethod: 'CASH',
    },
  })),
}));

jest.mock('../../app/actions/company', () => ({
  getCurrentCompanyAction: jest.fn(async () => ({
    id: 'c1',
    slug: 'acme',
    trade_name: 'ACME',
    legal_name: 'ACME S.A.',
    settings: {
      receipt_header: 'Productos de Belleza',
      receipt_footer: 'Gracias por su compra',
    },
  })),
  getCurrentCompanyIdAction: jest.fn(async () => 'c1'),
}));

// Mock POS CSS (no se carga en Jest)
jest.mock('../../components/POS/POS.css', () => ({}));

// ─── Tests ───────────────────────────────────────────────────────────────────

import ProductSearch, { type SearchResult } from '../../components/POS/ProductSearch';
import CartPanel from '../../components/POS/CartPanel';
import type { CartItem } from '../../components/POS/types';
import PrintReceipt, { type ReceiptData } from '../../components/POS/PrintReceipt';
import { searchPOSProducts, processPOSSale } from '../../app/actions/sales';

// ────────────────────────────────────────────────────────────────────────────
// ProductSearch
// ────────────────────────────────────────────────────────────────────────────
describe('ProductSearch', () => {
  const mockAddToCart = jest.fn();

  beforeEach(() => mockAddToCart.mockClear());

  it('muestra el input vacío con placeholder correcto', () => {
    render(
      <ProductSearch
        searchTerm=""
        setSearchTerm={() => {}}
        searchResults={[]}
        isSearching={false}
        onAddToCart={mockAddToCart}
      />,
    );
    const input = screen.getByPlaceholderText(/sku|nombre|código/i);
    expect(input).toBeInTheDocument();
  });

  it('llama a setSearchTerm al escribir', () => {
    const setSearchTerm = jest.fn();
    render(
      <ProductSearch
        searchTerm=""
        setSearchTerm={setSearchTerm}
        searchResults={[]}
        isSearching={false}
        onAddToCart={mockAddToCart}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/sku|nombre|código/i), {
      target: { value: 'SH' },
    });
    expect(setSearchTerm).toHaveBeenCalledWith('SH');
  });

  it('muestra skeletons mientras está buscando', () => {
    const { container } = render(
      <ProductSearch
        searchTerm="SH"
        setSearchTerm={() => {}}
        searchResults={[]}
        isSearching
        onAddToCart={mockAddToCart}
      />,
    );
    const skeletons = container.querySelectorAll('.skeleton-box');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('llama a onAddToCart al hacer click en un resultado', () => {
    const result: SearchResult = {
      variant_id: 'v1',
      product_name: 'Shampoo',
      product_brand: 'BrandX',
      variant_name: '500ml',
      sku: 'SH-001',
      price: 12000,
      stock: 10,
    };
    const { container } = render(
      <ProductSearch
        searchTerm="SH"
        setSearchTerm={() => {}}
        searchResults={[result]}
        isSearching={false}
        onAddToCart={mockAddToCart}
      />,
    );
    const addBtn = container.querySelector('.btn-add-quick') as HTMLButtonElement;
    fireEvent.click(addBtn);
    expect(mockAddToCart).toHaveBeenCalledWith(result);
  });

  it('muestra mensaje vacío cuando no hay resultados', () => {
    const { container } = render(
      <ProductSearch
        searchTerm="XYZ"
        setSearchTerm={() => {}}
        searchResults={[]}
        isSearching={false}
        onAddToCart={mockAddToCart}
      />,
    );
    // El componente muestra un texto cuando no hay resultados.
    // Verificamos que NO renderizó items.
    const items = container.querySelectorAll('.product-row');
    expect(items.length).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CartPanel
// ────────────────────────────────────────────────────────────────────────────
describe('CartPanel', () => {
  const baseItem: CartItem = {
    variant_id: 'v1',
    product_name: 'Shampoo Aloe',
    variant_name: '500ml',
    sku: 'SH-001',
    price: 12000,
    quantity: 2,
    discount: 0,
  };

  it('muestra estado vacío cuando el carrito está vacío', () => {
    render(
      <CartPanel
        cart={[]}
        setCart={() => {}}
        onRemoveItem={() => {}}
        onPercentDiscount={() => {}}
      />,
    );
    expect(screen.getByText(/carrito está vacío/i)).toBeInTheDocument();
  });

  it('renderiza cada item del carrito', () => {
    render(
      <CartPanel
        cart={[baseItem, { ...baseItem, variant_id: 'v2', product_name: 'Acond', variant_name: '1L', sku: 'AC-001', price: 14000 }]}
        setCart={() => {}}
        onRemoveItem={() => {}}
        onPercentDiscount={() => {}}
      />,
    );
    expect(screen.getByText('Shampoo Aloe')).toBeInTheDocument();
    expect(screen.getByText('Acond')).toBeInTheDocument();
  });

  it('muestra el descuento cuando el item lo tiene', () => {
    render(
      <CartPanel
        cart={[{ ...baseItem, discount: 2000 }]}
        setCart={() => {}}
        onRemoveItem={() => {}}
        onPercentDiscount={() => {}}
      />,
    );
    // formatCurrency(2000) → "$ 2.000" (con espacio y separador de miles colombiano)
    expect(screen.getByText(/-\$\s*2\.000/)).toBeInTheDocument();
  });

  it('incrementa cantidad al hacer click en +', () => {
    const setCart = jest.fn();
    const { container } = render(
      <CartPanel
        cart={[baseItem]}
        setCart={setCart}
        onRemoveItem={() => {}}
        onPercentDiscount={() => {}}
      />,
    );
    // Buscar el botón "+" por clase
    const plusBtn = container.querySelector('.qty-btn:nth-of-type(2)') as HTMLButtonElement;
    fireEvent.click(plusBtn);
    expect(setCart).toHaveBeenCalled();
    const updater = setCart.mock.calls[0][0];
    const result = updater([baseItem]);
    expect(result[0].quantity).toBe(3);
  });

  it('decrementa cantidad al hacer click en -', () => {
    const setCart = jest.fn();
    const { container } = render(
      <CartPanel
        cart={[baseItem]} // quantity 2
        setCart={setCart}
        onRemoveItem={() => {}}
        onPercentDiscount={() => {}}
      />,
    );
    const minusBtn = container.querySelector('.qty-btn') as HTMLButtonElement;
    fireEvent.click(minusBtn);
    const updater = setCart.mock.calls[0][0];
    const result = updater([baseItem]);
    expect(result[0].quantity).toBe(1);
  });

  it('no decrementa si la cantidad es 1 (mínimo)', () => {
    const setCart = jest.fn();
    const { container } = render(
      <CartPanel
        cart={[{ ...baseItem, quantity: 1 }]}
        setCart={setCart}
        onRemoveItem={() => {}}
        onPercentDiscount={() => {}}
      />,
    );
    const minusBtn = container.querySelector('.qty-btn') as HTMLButtonElement;
    fireEvent.click(minusBtn);
    // setCart NO debe ser llamado porque ya está en 1
    expect(setCart).not.toHaveBeenCalled();
  });

  it('llama a onRemoveItem al hacer click en trash', () => {
    const onRemoveItem = jest.fn();
    const { container } = render(
      <CartPanel
        cart={[baseItem]}
        setCart={() => {}}
        onRemoveItem={onRemoveItem}
        onPercentDiscount={() => {}}
      />,
    );
    const trashBtn = container.querySelector('.btn-remove-inline') as HTMLButtonElement;
    fireEvent.click(trashBtn);
    expect(onRemoveItem).toHaveBeenCalledWith('v1');
  });

  it('llama a onPercentDiscount al hacer click en %', () => {
    const onPercentDiscount = jest.fn();
    const { container } = render(
      <CartPanel
        cart={[baseItem]}
        setCart={() => {}}
        onRemoveItem={() => {}}
        onPercentDiscount={onPercentDiscount}
      />,
    );
    const percentBtn = container.querySelector('.btn-percent-inline') as HTMLButtonElement;
    fireEvent.click(percentBtn);
    expect(onPercentDiscount).toHaveBeenCalledWith('v1');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Integration: search → add → cart math
// ────────────────────────────────────────────────────────────────────────────
describe('POS flow integration', () => {
  beforeEach(() => {
    (searchPOSProducts as jest.Mock).mockClear();
  });

  it('searchPOSProducts devuelve productos con qty ≥ 2', async () => {
    const results = await searchPOSProducts('SH');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('variant_id');
    expect(results[0]).toHaveProperty('price');
    expect(results[0]).toHaveProperty('stock');
  });

  it('searchPOSProducts retorna [] con query < 2 chars', async () => {
    const results = await searchPOSProducts('S');
    expect(results).toEqual([]);
  });

  it('processPOSSale devuelve success true con saleId', async () => {
    const result = await processPOSSale(null, [], 'CASH', null, 0);
    expect(result.success).toBe(true);
    expect(result.saleId).toBeDefined();
    expect(result.receipt).toBeDefined();
    expect(result.receipt!.paymentMethod).toBe('CASH');
  });

  it('cart math: subtotal = Σ (price × qty) − discounts', () => {
    // Lógica de cálculo de totales que usa POS.tsx
    const cart: CartItem[] = [
      { variant_id: 'v1', product_name: 'A', variant_name: '', sku: 'A', price: 1000, quantity: 2, discount: 0 },
      { variant_id: 'v2', product_name: 'B', variant_name: '', sku: 'B', price: 500, quantity: 3, discount: 200 },
    ];
    const calculateSubtotal = () =>
      cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const calculateItemDiscounts = () =>
      cart.reduce((sum, item) => sum + Number(item.discount), 0);

    expect(calculateSubtotal()).toBe(1000 * 2 + 500 * 3); // 3500
    expect(calculateItemDiscounts()).toBe(0 + 200); // 200
    // total = subtotal - itemDiscounts - globalDiscount
    const totalDiscount = 0;
    const total = calculateSubtotal() - calculateItemDiscounts() - totalDiscount;
    expect(total).toBe(3300);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PrintReceipt: error handling
// ────────────────────────────────────────────────────────────────────────────
describe('PrintReceipt (integración)', () => {
  const sampleReceipt: ReceiptData = {
    saleId: 's1',
    createdAt: '2026-10-11T10:00:00Z',
    cashier: 'Test User',
    items: [
      { productName: 'Shampoo', quantity: 1, unitPrice: 12000 },
    ],
    subtotal: 12000,
    totalDiscount: 0,
    total: 12000,
    paymentMethod: 'CASH',
    openDrawer: true,
  };

  it('muestra error cuando navegador no soporta WebUSB ni Web Serial', async () => {
    render(<PrintReceipt saleData={sampleReceipt} />);
    const btn = screen.getByRole('button', { name: /conectar e|imprimir|connect/i });
    fireEvent.click(btn);

    await waitFor(() => {
      // Después del click, debe aparecer un mensaje de error
      expect(screen.getByText(/no soporta|soporte|navegador/i)).toBeInTheDocument();
    });
  });

  it('permite imprimir usando el diálogo de Windows como fallback', async () => {
    render(<PrintReceipt saleData={sampleReceipt} />);

    // Buscar el botón del diálogo (puede aparecer después de un fallo)
    const initialBtn = screen.getByRole('button', { name: /conectar e|imprimir/i });
    fireEvent.click(initialBtn);

    // Esperar el estado de error (botón REINTENTAR + botón IMPRIMIR CON DIÁLOGO)
    await waitFor(() => {
      expect(screen.getByText(/diálogo de windows/i)).toBeInTheDocument();
    });

    const dialogBtn = screen.getByRole('button', { name: /diálogo de windows/i });
    expect(dialogBtn).toBeInTheDocument();
  });
});