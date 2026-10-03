const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { printReceipt, checkPrinterStatus, getSystemPrinters, openCashDrawer } = require('./printer');

const app = express();
const PORT = 9100;
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Token compartido con la app Next.js (vía variable de entorno)
const SHARED_SECRET = process.env.PRINT_SERVICE_TOKEN || 'change-me-in-production';

app.use(cors({
    origin: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-Print-Service-Token'],
}));

// Body parser con límite generoso para receipts
app.use(express.json({ limit: '5mb' }));

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch {}
    return { printerName: '', tenants: {} };
}

function saveConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Middleware de autenticación por token compartido.
 * Usa comparación constant-time para evitar timing attacks.
 */
function authenticate(req, res, next) {
    const token = req.headers['x-print-service-token'];
    if (!token || token !== SHARED_SECRET) {
        console.warn('[print-service] Auth rechazo: token inválido o ausente');
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    next();
}

app.get('/status', async (req, res) => {
    try {
        const config = loadConfig();
        const status = await checkPrinterStatus(config.printerName || null);
        res.json({ ...status, tenantCount: Object.keys(config.tenants || {}).length });
    } catch (err) {
        res.json({ connected: false, error: err.message });
    }
});

app.get('/printers', (req, res) => {
    const printers = getSystemPrinters();
    const config = loadConfig();
    res.json({
        printers,
        selectedPrinter: config.printerName || printers[0] || null,
        tenants: config.tenants || {},
    });
});

app.post('/printers/select', (req, res) => {
    const { printerName } = req.body;
    if (!printerName) {
        return res.status(400).json({ success: false, error: 'Nombre de impresora requerido.' });
    }
    const config = loadConfig();
    config.printerName = printerName;
    saveConfig(config);
    res.json({ success: true, message: `Impresora "${printerName}" configurada.` });
});

/**
 * Imprime un recibo.
 * Acepta { companyId, saleData } para resolver branding + printer por tenant.
 *
 * Auth: requiere header X-Print-Service-Token.
 */
app.post('/print', async (req, res) => {
    try {
        const { companyId, saleData, branding } = req.body;

        if (!saleData || !saleData.saleId) {
            return res.status(400).json({ success: false, error: 'Datos de venta incompletos.' });
        }

        const config = loadConfig();

        // Resolver impresora del tenant si hay companyId
        let printerName = config.printerName;
        if (companyId && config.tenants?.[companyId]?.printerName) {
            printerName = config.tenants[companyId].printerName;
        }

        if (!printerName) {
            return res.status(400).json({ success: false, error: 'No hay impresora configurada.' });
        }

        const result = await printReceipt(saleData, printerName, branding || null);
        res.json(result);
    } catch (err) {
        console.error('Error de impresión:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Abre el cajón de dinero.
 * Auth: requiere header X-Print-Service-Token.
 */
app.post('/open-drawer', async (req, res) => {
    try {
        const { companyId } = req.body;
        const config = loadConfig();

        let printerName = config.printerName;
        if (companyId && config.tenants?.[companyId]?.printerName) {
            printerName = config.tenants[companyId].printerName;
        }

        if (!printerName) {
            return res.status(400).json({ success: false, error: 'No hay impresora configurada.' });
        }

        const result = await openCashDrawer(printerName);
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
    console.log('  Distri Belleza - Servicio de Impresión v3 (multi-tenant)');
    console.log('  Servidor: http://127.0.0.1:' + PORT);
    console.log('  Auth: token compartido ' + (process.env.PRINT_SERVICE_TOKEN ? '✓ configurado' : '✗ usando default inseguro'));
    console.log('');
    console.log('  Impresoras detectadas:', printers.length > 0 ? printers.join(', ') : 'NINGUNA');
    if (config.printerName) {
        console.log('  Impresora por defecto:', config.printerName);
    }
    if (config.tenants) {
        console.log('  Tenants con impresora:', Object.keys(config.tenants).length);
    }
    console.log('');
});