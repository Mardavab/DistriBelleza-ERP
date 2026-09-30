const { ThermalPrinter, PrinterTypes, CharacterSet } = require('node-thermal-printer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHARS_PER_LINE = 32;

function getSystemPrinters() {
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      const output = execSync('lpstat -p 2>/dev/null', { encoding: 'utf8' });
      const printers = [];
      const lines = output.trim().split('\n');
      for (const line of lines) {
        const match = line.match(/(?:printer|impresora)\s+(\S+)/i);
        if (match) printers.push(match[1]);
      }
      return printers;
    }

    if (process.platform === 'win32') {
      const output = execSync('wmic printer get name', { encoding: 'utf8' });
      return output.trim().split('\n').filter(l => l.trim() && l.trim() !== 'Name').map(l => l.trim());
    }
  } catch {
    return [];
  }
  return [];
}

function buildReceipt(saleData) {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    characterSet: CharacterSet.PC852_LATIN2,
    removeSpecialCharacters: false,
    lineCharacter: '=',
  });

  function padRight(str, len) {
    if (str.length >= len) return str.substring(0, len);
    return str + ' '.repeat(len - str.length);
  }

  function padLeft(str, len) {
    if (str.length >= len) return str.substring(0, len);
    return ' '.repeat(len - str.length) + str;
  }

  function formatCurrency(amount) {
    return '$' + Number(amount).toLocaleString('es-CO');
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function formatTime(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  }

  printer.alignCenter();
  printer.bold(true);
  printer.println('DISTRIBELLEZA');
  printer.bold(false);
  printer.println('Productos de Belleza');
  printer.println('================================');
  printer.newLine();

  printer.alignLeft();
  printer.println(`Venta #${(saleData.saleId || '').slice(0, 8)}`);
  printer.println(`Fecha: ${formatDate(saleData.createdAt)} ${formatTime(saleData.createdAt)}`);
  if (saleData.cashier) printer.println(`Cajero: ${saleData.cashier}`);
  printer.println('--------------------------------');
  printer.newLine();

  if (saleData.items && saleData.items.length > 0) {
    for (const item of saleData.items) {
      const name = item.productName || 'Producto';
      const qty = item.quantity || 1;
      const unitPrice = item.unitPrice || 0;
      const total = qty * unitPrice;

      const priceStr = padLeft(formatCurrency(unitPrice), 10);
      const nameLen = CHARS_PER_LINE - 4 - 1 - 10;
      const nameStr = padRight(name.substring(0, nameLen), nameLen);
      const line = `${padRight(String(qty), 4)} ${nameStr}${priceStr}`;
      printer.println(line);

      if (item.discount && Number(item.discount) > 0) {
        printer.println(`  Dto: -${formatCurrency(item.discount)}`);
      }
    }
  }

  printer.println('--------------------------------');
  printer.newLine();

  printer.println(`${padRight('Subtotal:', 20)}${padLeft(formatCurrency(saleData.subtotal || 0), 12)}`);

  if (saleData.totalDiscount && Number(saleData.totalDiscount) > 0) {
    printer.println(`${padRight('Descuento:', 20)}${padLeft('-' + formatCurrency(saleData.totalDiscount), 12)}`);
  }

  printer.newLine();
  printer.bold(true);
  printer.println(`${padRight('TOTAL:', 20)}${padLeft(formatCurrency(saleData.total || 0), 12)}`);
  printer.bold(false);
  printer.newLine();

  const paymentLabels = {
    CASH: 'EFECTIVO',
    CARD: 'TARJETA',
    BANK_TRANSFER: 'TRANSFERENCIA',
    CREDIT: 'CREDITO',
  };
  printer.println(`${padRight('Pago:', 20)}${paymentLabels[saleData.paymentMethod] || saleData.paymentMethod}`);

  if (saleData.paymentMethod === 'CASH' && saleData.cashReceived) {
    printer.println(`${padRight('Recibido:', 20)}${padLeft(formatCurrency(saleData.cashReceived), 12)}`);
    const change = Number(saleData.cashReceived) - Number(saleData.total);
    if (change > 0) {
      printer.println(`${padLeft('Cambio:', 20)}${padLeft(formatCurrency(change), 12)}`);
    }
  }

  if (saleData.paymentMethod === 'BANK_TRANSFER' && saleData.transferType) {
    printer.println(`Canal: ${saleData.transferType}`);
  }

  printer.alignCenter();
  printer.println('!Gracias por su compra!');

  if (saleData.openDrawer) {
    printer.openCashDrawer();
  }

  printer.cut();

  return printer.getBuffer();
}

function sendRawToPrinter(printerName, buffer) {
  const tmpFile = path.join(os.tmpdir(), `receipt-${Date.now()}.bin`);
  fs.writeFileSync(tmpFile, buffer);

  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      execSync(`lp -d "${printerName}" -o raw "${tmpFile}"`, { timeout: 10000 });
    } else if (process.platform === 'win32') {
      execSync(`copy /b "${tmpFile}" "\\\\localhost\\${printerName}"`, { timeout: 10000 });
    }
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

async function printReceipt(saleData, printerName) {
  const printers = getSystemPrinters();
  if (printers.length === 0) {
    throw new Error('No hay impresoras configuradas en el sistema. Agregue la impresora en Preferencias del Sistema.');
  }

  const name = printerName || printers[0];
  if (!printers.includes(name)) {
    throw new Error(`Impresora "${name}" no encontrada. Disponibles: ${printers.join(', ')}`);
  }

  const buffer = buildReceipt(saleData);
  sendRawToPrinter(name, buffer);

  return { success: true, message: 'Recibo impreso exitosamente.' };
}

async function checkPrinterStatus(printerName) {
  try {
    const printers = getSystemPrinters();
    if (printers.length === 0) {
      return { connected: false, printers: [], error: 'No hay impresoras configuradas en el sistema.' };
    }

    const name = printerName || printers[0];
    return {
      connected: printers.includes(name),
      printers,
      selectedPrinter: name,
      message: printers.includes(name)
        ? `Impresora "${name}" lista.`
        : `Impresora "${name}" no encontrada.`,
    };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

async function openCashDrawer(printerName) {
  const printers = getSystemPrinters();
  if (printers.length === 0) {
    throw new Error('No hay impresoras configuradas en el sistema.');
  }

  const name = printerName || printers[0];
  if (!printers.includes(name)) {
    throw new Error(`Impresora "${name}" no encontrada.`);
  }

  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    characterSet: CharacterSet.PC852_LATIN2,
    removeSpecialCharacters: false,
  });

  printer.openCashDrawer();
  const buffer = printer.getBuffer();
  sendRawToPrinter(name, buffer);

  return { success: true, message: 'Cajón abierto exitosamente.' };
}

module.exports = { printReceipt, checkPrinterStatus, getSystemPrinters, openCashDrawer };
