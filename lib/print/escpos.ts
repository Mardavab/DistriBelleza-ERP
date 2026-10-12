/**
 * Builder de comandos ESC/POS para impresoras térmicas.
 *
 * Genera un `Uint8Array` con la secuencia de bytes estándar ESC/POS (Epson)
 * que se envía por WebUSB. Compatible con impresoras genéricas 58mm/80mm.
 *
 * Encoding: usamos Windows-1252 (Latin-1 ampliado), que cubre ñ, acentos y
 * la mayoría de símbolos que se usan en español. Los caracteres fuera del
 * rango 0x00–0xFF se reemplazan por '?'.
 *
 * Tamaño de línea por defecto: 32 caracteres (típico de 58mm con fuente A).
 * Para 80mm ajustar a 42.
 */

import type { ReceiptData } from '../../components/POS/PrintReceipt';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const DEFAULT_LINE_WIDTH = 32;

function encodeText(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    bytes[i] = code <= 0xff ? code : 0x3f; // '?'
  }
  return bytes;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function lineWidth(text: string, width = DEFAULT_LINE_WIDTH): string {
  if (text.length >= width) return text.slice(0, width);
  return text;
}

function twoCols(left: string, right: string, width = DEFAULT_LINE_WIDTH): string {
  const space = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(space) + right;
}

function separator(char = '-', width = DEFAULT_LINE_WIDTH): string {
  return char.repeat(width);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

export class EscPosBuilder {
  private chunks: Uint8Array[] = [];
  private boldOn = false;
  private width = DEFAULT_LINE_WIDTH;

  /**
   * Establece el ancho lógico del papel (caracteres por línea).
   * 58mm ≈ 32, 80mm ≈ 42.
   */
  setLineWidth(width: number): this {
    this.width = width;
    return this;
  }

  /** ESC @ — Inicializa la impresora. */
  init(): this {
    this.chunks.push(new Uint8Array([ESC, 0x40]));
    return this;
  }

  /** Selecciona code page 16 (WPC1252) que soporta ñ y acentos. */
  selectCodePage1252(): this {
    // ESC t 16 — algunas impresoras lo requieren para ñ/acentos.
    this.chunks.push(new Uint8Array([ESC, 0x74, 16]));
    return this;
  }

  /** ESC E n — Activa/desactiva negrita. */
  bold(on: boolean): this {
    if (on !== this.boldOn) {
      this.chunks.push(new Uint8Array([ESC, 0x45, on ? 0x01 : 0x00]));
      this.boldOn = on;
    }
    return this;
  }

  /** ESC a n — Alineación: 0=left, 1=center, 2=right. */
  align(alignment: 'left' | 'center' | 'right'): this {
    const map = { left: 0, center: 1, right: 2 } as const;
    this.chunks.push(new Uint8Array([ESC, 0x61, map[alignment]]));
    return this;
  }

  /** GS ! n — Tamaño de fuente. n = (w<<4 | h). 0x00=normal, 0x11=2x2. */
  size(widthMul: 0 | 1 | 2 | 3, heightMul: 0 | 1 | 2 | 3): this {
    const n = (widthMul << 4) | heightMul;
    this.chunks.push(new Uint8Array([GS, 0x21, n]));
    return this;
  }

  sizeNormal(): this {
    return this.size(0, 0);
  }

  sizeDouble(): this {
    return this.size(1, 1);
  }

  /** Texto plano (sin salto de línea). */
  text(str: string): this {
    this.chunks.push(encodeText(str));
    return this;
  }

  /** Línea de texto con LF. Si excede el ancho, se trunca. */
  line(str: string, width = this.width): this {
    this.chunks.push(encodeText(lineWidth(str, width)));
    this.chunks.push(new Uint8Array([LF]));
    return this;
  }

  /** Línea vacía. */
  blank(n = 1): this {
    for (let i = 0; i < n; i++) {
      this.chunks.push(new Uint8Array([LF]));
    }
    return this;
  }

  /** Avance de papel n líneas (ESC d n). */
  feed(n: number): this {
    if (n <= 0) return this;
    this.chunks.push(new Uint8Array([ESC, 0x64, n]));
    return this;
  }

  /** GS V m — Corte. m=0 parcial, m=1 total, m=48 feed+cut. */
  cut(mode: 0 | 1 | 48 = 0): this {
    this.chunks.push(new Uint8Array([GS, 0x56, mode]));
    return this;
  }

  /**
   * ESC p m t1 t2 — Pulso al cajón de dinero (pin 2).
   * on-time = t1 * 2 ms, off-time = t2 * 2 ms.
   * on=0/1 selecciona el pin (0 = cajón conectado al pin 2 del RJ12).
   */
  openDrawer(on = 0, t1 = 25, t2 = 250): this {
    this.chunks.push(new Uint8Array([ESC, 0x70, on, t1, t2]));
    return this;
  }

  /**
   * Construye el ticket completo a partir de un ReceiptData.
   * El método `text()` previo se descarta si se llama después de `init()`.
   */
  buildReceipt(data: ReceiptData): Uint8Array {
    // Reiniciamos por si se reutiliza la instancia.
    this.chunks = [];
    this.boldOn = false;
    const w = this.width;

    this.init().selectCodePage1252().align('center');

    // Header de marca
    const header = data.branding?.header?.trim();
    if (header) {
      this.bold(true).sizeDouble().line(header, w).sizeNormal().bold(false);
    }

    this.line('RECIBO DE VENTA', w);
    this.line(formatDate(data.createdAt), w);
    this.line(`Venta #${data.saleId.slice(0, 8)}`, w);
    if (data.cashier) {
      this.line(`Cajero: ${truncate(data.cashier, w - 8)}`, w);
    }
    this.blank(1).align('left').line(separator('=', w), w);

    // Tabla: "Producto / Cant x Precio / Total"
    for (const item of data.items) {
      const nameLine = truncate(item.productName, w);
      this.line(nameLine, w);
      const qtyStr = String(item.quantity);
      const unit = formatMoney(item.unitPrice);
      const total = formatMoney(item.unitPrice * item.quantity);
      const detail = `${qtyStr} x ${unit}`;
      // right column = total
      this.line(twoCols(`  ${detail}`, total, w), w);
    }

    this.line(separator('-', w), w);

    this.line(twoCols('Subtotal:', formatMoney(data.subtotal), w), w);
    if (data.totalDiscount > 0) {
      this.line(twoCols('Descuento:', `-${formatMoney(data.totalDiscount)}`, w), w);
    }
    this.bold(true).line(twoCols('TOTAL:', formatMoney(data.total), w), w).bold(false);

    this.line(separator('=', w), w);
    this.line(`Pago: ${paymentLabel(data.paymentMethod, data.transferType)}`, w);

    if (data.paymentMethod === 'CASH' && data.cashReceived !== undefined && data.cashReceived !== null) {
      this.line(twoCols('Recibido:', formatMoney(data.cashReceived), w), w);
      const change = data.cashReceived - data.total;
      if (change > 0) {
        this.line(twoCols('Cambio:', formatMoney(change), w), w);
      }
    }

    this.feed(1);

    // Footer
    this.align('center');
    const footer = data.branding?.footer?.trim();
    if (footer) {
      this.line(separator('-', w), w);
      this.line(footer, w);
    } else {
      this.line('¡Gracias por su compra!', w);
    }

    this.feed(3);

    // Cajón + corte
    if (data.openDrawer) {
      this.openDrawer();
    }
    this.cut(0);

    return concat(this.chunks);
  }

  /** Bytes para abrir el cajón solo (sin imprimir). */
  buildOpenDrawer(): Uint8Array {
    this.chunks = [];
    this.init();
    this.openDrawer();
    this.cut(0);
    return concat(this.chunks);
  }

  /**
   * Devuelve los bytes acumulados actualmente (sin resetear).
   * Útil para tests; en producción usar build* methods.
   */
  peekBytes(): Uint8Array {
    return concat(this.chunks);
  }
}

function paymentLabel(method: string, transferType?: string): string {
  switch (method) {
    case 'CASH':
      return 'Efectivo';
    case 'CARD':
      return 'Tarjeta';
    case 'BANK_TRANSFER':
      return `Transferencia${transferType ? ` (${transferType})` : ''}`;
    case 'CREDIT':
      return 'Crédito';
    default:
      return method;
  }
}

export const escpos = new EscPosBuilder();
export { formatMoney, formatDate };