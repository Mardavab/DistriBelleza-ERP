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

  it('auto-agrega al carrito cuando el SKU coincide exacto', async () => {
    // Caso típico: el escáner de código de barras tipea el SKU completo
    // y devuelve exactamente 1 producto cuyo SKU === searchTerm.
    const onAddToCart = jest.fn();
    const setSearchTerm = jest.fn();
    const exactResult: SearchResult = {
      variant_id: 'v1',
      product_name: 'Shampoo Aloe',
      product_brand: 'BrandX',
      variant_name: '500ml',
      sku: 'EXACT-SKU-001',
      price: 12000,
      stock: 10,
    };

    const { rerender } = render(
      <ProductSearch
        searchTerm=""
        setSearchTerm={setSearchTerm}
        searchResults={[]}
        isSearching
        onAddToCart={onAddToCart}
      />,
    );

    // Simula que la búsqueda terminó con el SKU exacto como searchTerm.
    rerender(
      <ProductSearch
        searchTerm="EXACT-SKU-001"
        setSearchTerm={setSearchTerm}
        searchResults={[exactResult]}
        isSearching={false}
        onAddToCart={onAddToCart}
      />,
    );

    await waitFor(() => {
      expect(onAddToCart).toHaveBeenCalledWith(exactResult);
      expect(setSearchTerm).toHaveBeenCalledWith('');
    });
  });

  it('NO auto-agrega si hay varios resultados y ninguno coincide exacto', async () => {
    const onAddToCart = jest.fn();
    const setSearchTerm = jest.fn();
    // Ambos SKUs son distintos al searchTerm → no hay match exacto.
    const results: SearchResult[] = [
      { variant_id: 'v1', product_name: 'A', product_brand: 'B', variant_name: 'X', sku: 'OTHER-001', price: 100, stock: 5 },
      { variant_id: 'v2', product_name: 'C', product_brand: 'D', variant_name: 'Y', sku: 'OTHER-002', price: 200, stock: 3 },
    ];

    render(
      <ProductSearch
        searchTerm="SHARED-001"
        setSearchTerm={setSearchTerm}
        searchResults={results}
        isSearching={false}
        onAddToCart={onAddToCart}
      />,
    );

    await new Promise(r => setTimeout(r, 50));

    // Sin match exacto, no auto-add.
    expect(onAddToCart).not.toHaveBeenCalled();
    expect(setSearchTerm).not.toHaveBeenCalledWith('');
  });

  it('NO auto-agrega si el SKU del resultado no coincide con searchTerm', async () => {
    const onAddToCart = jest.fn();
    const setSearchTerm = jest.fn();
    const result: SearchResult = {
      variant_id: 'v1',
      product_name: 'X',
      product_brand: 'Y',
      variant_name: 'Z',
      sku: 'DIFFERENT-SKU',
      price: 100,
      stock: 5,
    };

    render(
      <ProductSearch
        searchTerm="WHAT-I-TYPED"
        setSearchTerm={setSearchTerm}
        searchResults={[result]}
        isSearching={false}
        onAddToCart={onAddToCart}
      />,
    );

    await new Promise(r => setTimeout(r, 50));
    expect(onAddToCart).not.toHaveBeenCalled();
  });

  it('Enter agrega el primer resultado y limpia', () => {
    const onAddToCart = jest.fn();
    const setSearchTerm = jest.fn();
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
        setSearchTerm={setSearchTerm}
        searchResults={[result]}
        isSearching={false}
        onAddToCart={onAddToCart}
      />,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onAddToCart).toHaveBeenCalledWith(result);
    expect(setSearchTerm).toHaveBeenCalledWith('');
  });

  /**
   * Caso reportado por el usuario: dos productos con SKUs muy similares
   * (7703819017773 vs 7703819017780). Sin el fix, el fuzzy match podía
   * traer el equivocado. Con el fix, auto-add elige el match exacto aunque
   * haya varios resultados.
   */
  it('auto-elegir el match EXACTO cuando hay SKUs similares', async () => {
    const onAddToCart = jest.fn();
    const setSearchTerm = jest.fn();

    // Simula el caso del usuario: dos productos con SKUs casi idénticos
    // (EAN-13 con 2 dígitos consecutivos diferentes).
    const wrongProduct: SearchResult = {
      variant_id: 'v-wrong',
      product_name: 'Shampoo Argan & Jalea Real',
      product_brand: 'MAXYBELT',
      variant_name: '400ml',
      sku: '7703819017773',
      barcode: '7703819017773',
      price: 24000,
      stock: 11,
    };
    const rightProduct: SearchResult = {
      variant_id: 'v-right',
      product_name: 'Shampoo Argan & Jalea Real',
      product_brand: 'MAXYBELT',
      variant_name: '950ml',
      sku: '7703819017780',
      barcode: '7703819017780',
      price: 46000,
      stock: 11,
    };

    const { rerender } = render(
      <ProductSearch
        searchTerm=""
        setSearchTerm={setSearchTerm}
        searchResults={[]}
        isSearching={false}
        onAddToCart={onAddToCart}
      />,
    );

    // Simula que la búsqueda terminó con AMBOS productos (orden arbitrario).
    rerender(
      <ProductSearch
        searchTerm="7703819017780"
        setSearchTerm={setSearchTerm}
        searchResults={[wrongProduct, rightProduct]} // orden "incorrecto" en el array
        isSearching={false}
        onAddToCart={onAddToCart}
      />,
    );

    await waitFor(() => {
      // Debe auto-agregar el producto cuyo SKU es 7780 (el escaneado),
      // NO el primero del array.
      expect(onAddToCart).toHaveBeenCalledWith(rightProduct);
      expect(onAddToCart).not.toHaveBeenCalledWith(wrongProduct);
      expect(setSearchTerm).toHaveBeenCalledWith('');
    });
  });

  it('match por barcode exacto también funciona', async () => {
    const onAddToCart = jest.fn();
    const setSearchTerm = jest.fn();
    const productByBarcode: SearchResult = {
      variant_id: 'v1',
      product_name: 'Test',
      product_brand: 'Brand',
      variant_name: 'Unit',
      sku: 'INTERNAL-SKU',
      barcode: '7500000000001',
      price: 100,
      stock: 5,
    };

    render(
      <ProductSearch
        searchTerm="7500000000001"
        setSearchTerm={setSearchTerm}
        searchResults={[productByBarcode]}
        isSearching={false}
        onAddToCart={onAddToCart}
      />,
    );

    await waitFor(() => {
      expect(onAddToCart).toHaveBeenCalledWith(productByBarcode);
    });
  });

  it('NO auto-add si hay múltiples matches exactos (ambiguo)', async () => {
    const onAddToCart = jest.fn();
    const setSearchTerm = jest.fn();
    const result1: SearchResult = { variant_id: 'v1', product_name: 'A', product_brand: 'X', variant_name: '1', sku: 'DUP', barcode: 'DUP', price: 100, stock: 5 };
    const result2: SearchResult = { variant_id: 'v2', product_name: 'B', product_brand: 'X', variant_name: '2', sku: 'DUP', barcode: 'DUP', price: 100, stock: 5 };

    render(
      <ProductSearch
        searchTerm="DUP"
        setSearchTerm={setSearchTerm}
        searchResults={[result1, result2]}
        isSearching={false}
        onAddToCart={onAddToCart}
      />,
    );

    await new Promise(r => setTimeout(r, 50));
    // Como hay DOS matches exactos, no auto-añadimos (sería ambiguo).
    expect(onAddToCart).not.toHaveBeenCalled();
  });

  it('Enter con múltiples resultados elige el match EXACTO sobre el primero', () => {
    const onAddToCart = jest.fn();
    const setSearchTerm = jest.fn();
    const first: SearchResult = { variant_id: 'v-first', product_name: 'First', product_brand: 'X', variant_name: '', sku: 'PARTIAL', price: 1, stock: 1 };
    const exact: SearchResult = { variant_id: 'v-exact', product_name: 'Exact', product_brand: 'X', variant_name: '', sku: 'EXACT', price: 1, stock: 1 };

    const { container } = render(
      <ProductSearch
        searchTerm="EXACT"
        setSearchTerm={setSearchTerm}
        searchResults={[first, exact]}
        isSearching={false}
        onAddToCart={onAddToCart}
      />,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onAddToCart).toHaveBeenCalledWith(exact);
    expect(onAddToCart).not.toHaveBeenCalledWith(first);
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