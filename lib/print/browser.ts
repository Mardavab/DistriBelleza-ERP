'use client';

/**
 * Impresión vía diálogo nativo del navegador (`window.print()`).
 *
 * Este camino SIEMPRE funciona en Windows cuando la impresora tiene un
 * driver instalado, sin importar conflictos de drivers USB. A diferencia
 * de WebUSB/WebSerial, no requiere permisos especiales ni configuración.
 *
 * Limitaciones:
 * - El cajero tiene que confirmar el diálogo de impresión (un clic).
 * - No podemos enviar comandos ESC/POS (apertura de cajón, corte) porque
 *   el driver de Windows se encarga de traducir el contenido a la impresora.
 *
 * Para cajones de dinero, hay que usar la palanca física del cajón o
 * un pulsador conectado al puerto RJ12 de la impresora.
 */

import type { ReceiptData } from '../../components/POS/PrintReceipt';

const PAPER_WIDTH_MM = 58;
const PRINT_WIDTH_PX = Math.round((PAPER_WIDTH_MM * 96) / 25.4); // 58mm a 96 DPI

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

function paymentLabel(method: string, transferType?: string): string {
  switch (method) {
    case 'CASH': return 'Efectivo';
    case 'CARD': return 'Tarjeta';
    case 'BANK_TRANSFER': return `Transferencia${transferType ? ` (${transferType})` : ''}`;
    case 'CREDIT': return 'Crédito';
    default: return method;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Genera HTML con el recibo formateado para impresión térmica 58mm.
 */
export function buildReceiptHtml(data: ReceiptData): string {
  const itemsHtml = data.items.map((item) => {
    const lineTotal = item.unitPrice * item.quantity;
    const name = escapeHtml(item.productName);
    const line1 = `<div class="line">${name}</div>`;
    const line2 = `<div class="line two-col"><span>${item.quantity} x ${formatMoney(item.unitPrice)}</span><span>${formatMoney(lineTotal)}</span></div>`;
    return line1 + line2;
  }).join('');

  const cashSection = data.paymentMethod === 'CASH' && data.cashReceived !== undefined && data.cashReceived !== null
    ? `<div class="line two-col"><span>Recibido:</span><span>${formatMoney(data.cashReceived)}</span></div>
       ${data.cashReceived - data.total > 0
         ? `<div class="line two-col"><span>Cambio:</span><span>${formatMoney(data.cashReceived - data.total)}</span></div>`
         : ''}`
    : '';

  const header = data.branding?.header
    ? `<div class="center bold big">${escapeHtml(data.branding.header)}</div>`
    : '';

  const footer = data.branding?.footer?.trim()
    ? `<div class="separator"></div>
       <div class="center">${escapeHtml(data.branding.footer)}</div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Recibo</title>
<style>
  @page {
    size: ${PAPER_WIDTH_MM}mm auto;
    margin: 0;
  }
  html, body {
    margin: 0;
    padding: 0;
    background: white;
    color: black;
    font-family: 'Courier New', Courier, monospace;
    font-size: 9pt;
    line-height: 1.2;
  }
  .receipt {
    width: ${PRINT_WIDTH_PX}px;
    padding: 1mm 1mm;
    box-sizing: border-box;
    overflow-wrap: anywhere;
    word-wrap: break-word;
    letter-spacing: -0.2px;
  }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .big {
    font-size: 10pt;
    font-weight: bold;
    line-height: 1.15;
    overflow-wrap: anywhere;
    word-wrap: break-word;
    letter-spacing: -0.3px;
  }
  .line {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-wrap: break-word;
    margin: 1px 0;
  }
  .two-col {
    display: flex;
    justify-content: space-between;
    gap: 4px;
  }
  .two-col > span:first-child {
    text-align: left;
  }
  .two-col > span:last-child {
    text-align: right;
  }
  .separator {
    border-top: 1px dashed #000;
    margin: 4px 0;
    height: 0;
  }
  .total-line {
    font-weight: bold;
    font-size: 11pt;
    margin-top: 4px;
  }
  @media print {
    .receipt { padding: 2mm 3mm; }
  }
</style>
</head>
<body>
  <div class="receipt">
    ${header}
    <div class="center bold">RECIBO DE VENTA</div>
    <div class="center">${escapeHtml(formatDate(data.createdAt))}</div>
    <div class="center">Venta #${escapeHtml(data.saleId.slice(0, 8))}</div>
    ${data.cashier ? `<div class="center">Cajero: ${escapeHtml(data.cashier)}</div>` : ''}
    <div class="separator"></div>
    ${itemsHtml}
    <div class="separator"></div>
    <div class="line two-col"><span>Subtotal:</span><span>${formatMoney(data.subtotal)}</span></div>
    ${data.totalDiscount > 0
      ? `<div class="line two-col"><span>Descuento:</span><span>-${formatMoney(data.totalDiscount)}</span></div>`
      : ''}
    <div class="line two-col total-line"><span>TOTAL:</span><span>${formatMoney(data.total)}</span></div>
    <div class="separator"></div>
    <div>Pago: ${escapeHtml(paymentLabel(data.paymentMethod, data.transferType))}</div>
    ${cashSection}
    <div class="separator"></div>
    ${footer || '<div class="center">¡Gracias por su compra!</div>'}
  </div>
</body>
</html>`;
}

/**
 * Abre el diálogo de impresión del navegador con un recibo formateado.
 *
 * Devuelve una promesa que se resuelve cuando el usuario cierra el diálogo
 * (imprima o cancele).
 */
export function printViaDialog(data: ReceiptData): Promise<{ printed: boolean }> {
  return new Promise((resolve, reject) => {
    try {
      const html = buildReceiptHtml(data);
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      const cleanup = () => {
        try {
          document.body.removeChild(iframe);
        } catch {
          // ignore
        }
      };

      const doc = iframe.contentDocument;
      if (!doc) {
        cleanup();
        reject(new Error('No se pudo crear el contexto de impresión.'));
        return;
      }

      doc.open();
      doc.write(html);
      doc.close();

      const triggerPrint = () => {
        try {
          const win = iframe.contentWindow;
          if (!win) throw new Error('No se pudo acceder al iframe de impresión.');

          let finished = false;
          const done = (printed: boolean) => {
            if (finished) return;
            finished = true;
            cleanup();
            resolve({ printed });
          };

          win.addEventListener('afterprint', () => done(true));

          win.focus();
          win.print();

          // Fallback tras cerrar o confirmar diálogo
          setTimeout(() => done(false), 3000);
        } catch (e) {
          cleanup();
          reject(e);
        }
      };

      setTimeout(triggerPrint, 250);
    } catch (e) {
      reject(e);
    }
  });
}