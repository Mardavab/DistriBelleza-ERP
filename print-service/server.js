const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { printReceipt, checkPrinterStatus, getSystemPrinters, openCashDrawer } = require('./printer');

const app = express();
const PORT = 9100;
const CONFIG_FILE = path.join(__dirname, 'config.json');

app.use(cors({
  origin: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json());

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch {}
  return { printerName: '' };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

app.get('/printers', (req, res) => {
  const printers = getSystemPrinters();
  const config = loadConfig();
  res.json({
    printers,
    selectedPrinter: config.printerName || printers[0] || null,
  });
});

app.post('/printers/select', (req, res) => {
  const { printerName } = req.body;
  if (!printerName) {
    return res.status(400).json({ success: false, error: 'Nombre de impresora requerido.' });
  }
  saveConfig({ printerName });
  res.json({ success: true, message: `Impresora "${printerName}" configurada.` });
});

app.get('/status', async (req, res) => {
  try {
    const config = loadConfig();
    const status = await checkPrinterStatus(config.printerName);
    res.json(status);
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

app.post('/print', async (req, res) => {
  try {
    const saleData = req.body;

    if (!saleData || !saleData.saleId) {
      return res.status(400).json({ success: false, error: 'Datos de venta incompletos.' });
    }

    const config = loadConfig();
    const result = await printReceipt(saleData, config.printerName);
    res.json(result);
  } catch (err) {
    console.error('Error de impresión:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/open-drawer', async (req, res) => {
  try {
    const config = loadConfig();
    const result = await openCashDrawer(config.printerName);
    res.json(result);
  } catch (err) {
    console.error('Error opening drawer:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  const config = loadConfig();
  const printers = getSystemPrinters();

  console.log('');
  console.log('  Distri Belleza - Servicio de Impresión v2');
  console.log('  Servidor: http://127.0.0.1:' + PORT);
  console.log('');
  console.log('  Impresoras detectadas:', printers.length > 0 ? printers.join(', ') : 'NINGUNA');
  if (config.printerName) {
    console.log('  Impresora seleccionada:', config.printerName);
  }
  console.log('');
  console.log('  Endpoints:');
  console.log('    GET  /printers         - Listar impresoras disponibles');
  console.log('    POST /printers/select  - Seleccionar impresora');
  console.log('    GET  /status           - Estado de la impresora');
  console.log('    POST /print            - Imprimir recibo');
  console.log('    POST /open-drawer      - Abrir cajón de dinero');
  console.log('');
});
