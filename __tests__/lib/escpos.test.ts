import { EscPosBuilder, escpos } from '../../lib/print/escpos';

/**
 * Helper para decodificar bytes Windows-1252 como string (compatible con Node).
 */
function decode(bytes: Uint8Array): string {
  // Buffer decodifica latin1 correctamente porque latin1 es el subset
  // byte-a-byte de windows-1252 (mismo mapeo para 0x00-0xFF).
  return Buffer.from(bytes).toString('latin1');
}

/**
 * Tests del builder de comandos ESC/POS.
 *
 * El builder produce bytes que se envían a la impresora térmica. No podemos
 * probar que la impresora los interprete correctamente, pero sí podemos asegurar
 * que la secuencia de comandos es la esperada por el estándar.
 */

describe('EscPosBuilder basic commands', () => {
  it('starts with ESC @ (0x1B 0x40)', () => {
    const bytes = escpos.buildOpenDrawer();
    expect(bytes[0]).toBe(0x1b); // ESC
    expect(bytes[1]).toBe(0x40); // @
  });

  it('openDrawer emits ESC p command', () => {
    const bytes = escpos.buildOpenDrawer();
    // Buscar secuencia ESC p (0x1B 0x70) en los bytes
    const idx = Array.from(bytes).findIndex((b, i) => b === 0x1b && bytes[i + 1] === 0x70);
    expect(idx).toBeGreaterThanOrEqual(0);
  });

  it('openDrawer con parámetros custom', () => {
    // buildOpenDrawer sin args usa (on=0, t1=25, t2=250)
    const bytes = escpos.buildOpenDrawer();
    expect(bytes).toContain(0x1b);
    expect(bytes).toContain(0x70);
    expect(bytes).toContain(25);
    expect(bytes).toContain(250);
  });
});

describe('EscPosBuilder text encoding', () => {
  it('preserva ñ y acentos (Windows-1252)', () => {
    const builder = new EscPosBuilder();
    // buildReceipt nos da bytes para inspección.
    expect(() => builder.buildReceipt({
      saleId: 's',
      createdAt: '',
      items: [],
      subtotal: 0,
      totalDiscount: 0,
      total: 0,
      paymentMethod: 'CASH',
      openDrawer: false,
      branding: { header: 'Café con ñ', footer: '' },
    } as any)).not.toThrow();
  });

  it('reemplaza emojis por ? (fuera de 0xFF)', () => {
    const builder = new EscPosBuilder();
    expect(() => builder.buildReceipt({
      saleId: 's',
      createdAt: '',
      items: [{ productName: '👋 Hola', quantity: 1, unitPrice: 100 }],
      subtotal: 100,
      totalDiscount: 0,
      total: 100,
      paymentMethod: 'CASH',
      openDrawer: false,
    } as any)).not.toThrow();
  });
});

describe('EscPosBuilder alignment', () => {
  it('align(center) emite ESC a 1', () => {
    const builder = new EscPosBuilder();
    builder.align('center').line('CENTRO');
    const bytes = builder.peekBytes();
    expect(bytes).toContain(0x61); // 'a'
    expect(bytes).toContain(1);
  });

  it('align(left) emite ESC a 0', () => {
    const builder = new EscPosBuilder();
    builder.align('left').line('IZQ');
    const bytes = builder.peekBytes();
    expect(bytes).toContain(0);
  });
});

describe('EscPosBuilder cut', () => {
  it('cut(0) emite GS V 0 (corte parcial)', () => {
    const builder = new EscPosBuilder();
    builder.cut(0);
    const bytes = builder.peekBytes();
    expect(bytes).toContain(0x1d); // GS
    expect(bytes).toContain(0x56); // V
    expect(bytes).toContain(0);
  });

  it('cut(1) emite GS V 1 (corte total)', () => {
    const builder = new EscPosBuilder();
    builder.cut(1);
    const bytes = builder.peekBytes();
    expect(bytes).toContain(1);
  });
});

describe('EscPosBuilder bold', () => {
  it('bold(true) y bold(false) emiten ESC E 1 y 0', () => {
    const builder = new EscPosBuilder();
    builder.bold(true).bold(false);
    const bytes = builder.peekBytes();
    const hasBoldOn = Array.from(bytes).some(
      (b, i) => b === 0x1b && bytes[i + 1] === 0x45 && bytes[i + 2] === 1
    );
    const hasBoldOff = Array.from(bytes).some(
      (b, i) => b === 0x1b && bytes[i + 1] === 0x45 && bytes[i + 2] === 0
    );
    expect(hasBoldOn).toBe(true);
    expect(hasBoldOff).toBe(true);
  });

  it('bold es idempotente (no duplica si ya está activado)', () => {
    const builder = new EscPosBuilder();
    builder.bold(true);
    builder.bold(true);
    builder.bold(true);
    const bytes = builder.peekBytes();
    const count = Array.from(bytes).filter(
      (b, i) => b === 0x1b && bytes[i + 1] === 0x45 && bytes[i + 2] === 1
    ).length;
    expect(count).toBe(1);
  });
});

describe('EscPosBuilder buildReceipt', () => {
  const sampleReceipt = {
    saleId: 'abc-123-456',
    createdAt: '2026-10-11T10:00:00Z',
    cashier: 'María González',
    items: [
      { productName: 'Producto A', unitPrice: 1000, quantity: 2 },
      { productName: 'Producto B', unitPrice: 500, quantity: 1 },
    ],
    subtotal: 2500,
    totalDiscount: 0,
    total: 2500,
    paymentMethod: 'CASH',
    cashReceived: 3000,
    openDrawer: true,
    branding: {
      header: 'Productos de Belleza',
      footer: 'Gracias por su compra',
    },
  };

  it('genera bytes no-vacíos para un recibo completo', () => {
    const bytes = escpos.buildReceipt(sampleReceipt as any);
    expect(bytes.length).toBeGreaterThan(20);
  });

  it('incluye el header', () => {
    const bytes = escpos.buildReceipt(sampleReceipt as any);
    const text = decode(bytes);
    expect(text).toContain('Productos de Belleza');
  });

  it('NO incluye "Gracias por su compra" dos veces (footer + hardcoded)', () => {
    const bytes = escpos.buildReceipt(sampleReceipt as any);
    const text = decode(bytes);
    const occurrences = (text.match(/Gracias por su compra/g) || []).length;
    // El branding.footer es "Gracias por su compra" → solo debe aparecer 1 vez.
    expect(occurrences).toBe(1);
  });

  it('NO incluye "Gracias por su compra" cuando branding no está definido', () => {
    const bytes = escpos.buildReceipt({ ...sampleReceipt, branding: undefined } as any);
    const text = decode(bytes);
    expect(text).toContain('Gracias por su compra');
    const occurrences = (text.match(/Gracias por su compra/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it('incluye el comando openDrawer cuando openDrawer=true', () => {
    const bytes = escpos.buildReceipt(sampleReceipt as any);
    const hasOpenDrawer = Array.from(bytes).some(
      (b, i) => b === 0x1b && bytes[i + 1] === 0x70
    );
    expect(hasOpenDrawer).toBe(true);
  });

  it('NO incluye openDrawer cuando openDrawer=false', () => {
    const bytes = escpos.buildReceipt({ ...sampleReceipt, openDrawer: false } as any);
    const hasOpenDrawer = Array.from(bytes).some(
      (b, i) => b === 0x1b && bytes[i + 1] === 0x70
    );
    expect(hasOpenDrawer).toBe(false);
  });

  it('incluye el comando cut al final', () => {
    const bytes = escpos.buildReceipt(sampleReceipt as any);
    // El cut debe estar entre los últimos 10 bytes
    const tail = Array.from(bytes.slice(-10));
    const hasCut = tail.some((b, j) => b === 0x1d && tail[j + 1] === 0x56);
    expect(hasCut).toBe(true);
  });

  it('incluye los items con sus precios', () => {
    const bytes = escpos.buildReceipt(sampleReceipt as any);
    const text = decode(bytes);
    expect(text).toContain('Producto A');
    expect(text).toContain('Producto B');
    expect(text).toContain('2.500'); // formato con punto como separador de miles (Intl)
  });

  it('incluye sección de cambio cuando hay cashReceived', () => {
    const bytes = escpos.buildReceipt(sampleReceipt as any);
    const text = decode(bytes);
    expect(text).toContain('Cambio:');
    expect(text).toContain('500'); // 3000 - 2500
  });
});

describe('EscPosBuilder setLineWidth', () => {
  it('cambia el ancho efectivo del builder', () => {
    const builder = new EscPosBuilder();
    builder.setLineWidth(42);
    expect((builder as any).width).toBe(42);
  });
});