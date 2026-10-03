'use client'

import React from 'react';
import { CheckCircle } from 'lucide-react';
import PrintReceipt, { ReceiptData } from './PrintReceipt';

/**
 * Modal de éxito tras una venta.
 *
 * Subcomponente del POS. Muestra confirmación, opción de imprimir
 * recibo, y botón "Nueva venta" para limpiar el estado.
 */
interface SuccessModalProps {
    successData: {
        saleId?: string;
        success?: boolean;
        message?: string;
    };
    receiptData: ReceiptData | null;
    onPrintDone: () => void;
    onNewSale: () => void;
}

export default function SuccessModal({ successData, receiptData, onPrintDone, onNewSale }: SuccessModalProps) {
    return (
        <div className="modal-overlay dark-blur">
            <div className="modal-success animate-pop">
                <div className="success-icon"><CheckCircle size={60} /></div>
                <h2>¡Venta Exitosa!</h2>
                <p>Venta #{successData.saleId?.slice(0, 8) || 'Nueva'} ha sido registrada con éxito.</p>
                {receiptData && (
                    <div style={{ width: '100%', marginTop: '12px' }}>
                        <PrintReceipt
                            saleData={receiptData}
                            onDone={onPrintDone}
                        />
                    </div>
                )}
                <div className="success-actions">
                    <button className="btn-continue" onClick={onNewSale}>NUEVA VENTA</button>
                </div>
            </div>
        </div>
    );
}