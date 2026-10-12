'use client';

import React, { useState } from 'react';
import { XCircle, ExternalLink, CheckCircle2 } from 'lucide-react';

/**
 * Wizard de solución cuando el driver de la impresora entra en conflicto con
 * el navegador (SecurityError al hacer `device.open()` en WebUSB).
 *
 * Caso típico: la JAL58M trae un driver genérico que Windows instala y
 * queda agarrando la interfaz USB. Edge no puede reclamarla.
 *
 * Solución: reemplazar el driver por WinUSB con Zadig.
 */
export default function SetupGuide({ onClose }: { onClose?: () => void }) {
  const [step, setStep] = useState(0);

  const steps = [
    {
      title: 'Descargá Zadig',
      body: (
        <>
          <p>
            Zadig es una utilidad portable (no se instala) que reemplaza el driver de un
            dispositivo USB por otro, en este caso <strong>WinUSB</strong>.
          </p>
          <a
            href="https://zadig.akeo.ie/"
            target="_blank"
            rel="noreferrer"
            className="setup-link"
          >
            <ExternalLink size={14} /> https://zadig.akeo.ie/
          </a>
          <p className="setup-tip">
            Bajá la versión {`"Zadig"`} (no la de {`"Zadig for Web"`}). Es un ZIP que se
            descomprime y se ejecuta.
          </p>
        </>
      ),
    },
    {
      title: 'Abrí Zadig',
      body: (
        <>
          <p>Ejecutá el archivo <code>Zadig.exe</code> como administrador.</p>
          <p className="setup-tip">
            La impresora debe estar enchufada y encendida.
          </p>
          <p>
            <strong>Menú Options</strong>
            {' '}
            <span className="kbd">→</span>
            {' '}
            marcá <strong>{`"List All Devices"`}</strong> para que aparezcan los
            dispositivos USB incluso los que ya tienen driver.
          </p>
        </>
      ),
    },
    {
      title: 'Elegí tu impresora',
      body: (
        <>
          <p>
            En el desplegable de la izquierda elegí tu impresora.
            Generalmente aparece como:
          </p>
          <ul>
            <li><code>USB Printer</code></li>
            <li><code>JAL58M</code> / <code>Jaltech POS 58mm</code></li>
            <li>El nombre del driver genérico (<code>usbprint</code>)</li>
          </ul>
          <p className="setup-tip">
            Si no la ves, desconectá y reconectá el cable USB mientras Zadig
            está abierto, o cambiá el puerto USB.
          </p>
        </>
      ),
    },
    {
      title: 'Reemplazá el driver',
      body: (
        <>
          <p>
            A la derecha, en el cuadro verde, elegí <strong>WinUSB</strong>
            (recomendado) en vez del driver actual.
          </p>
          <p>
            Hacé clic en <strong>{`"Replace Driver"`}</strong> o{' '}
            <strong>{`"Reinstall Driver"`}</strong>. Confirmá el diálogo de
            Windows (pide permisos de admin).
          </p>
          <p className="setup-tip">
            Esto deja el dispositivo accesible desde el navegador.
            <strong>La impresora sigue imprimiendo normalmente</strong>;
            Zadig solo cambia qué driver la maneja.
          </p>
        </>
      ),
    },
    {
      title: 'Volvé a conectar',
      body: (
        <>
          <p>
            Cerrá Zadig, volvé a la pestaña del POS y tocá
            <strong> {`"Reset"`} </strong> en el badge de la impresora y después
            <strong> {`"Conectar"`}</strong>.
          </p>
          <p>
            Esta vez el popup debería授权 ya授权: la
            impresora debería pasar a <strong>{`"Impresora lista · Serie"`}</strong>
            (o USB, según corresponda).
          </p>
          <p className="setup-tip">
            Si te sigue denegando, reiniciá la PC y volvé a intentar.
          </p>
        </>
      ),
    },
  ];

  const isLast = step === steps.length - 1;
  const isFirst = step === 0;
  const current = steps[step];

  return (
    <div className="setup-guide">
      <style jsx>{`
        .setup-guide {
          background: #fffbeb;
          border: 1px solid #fde68a;
          border-radius: 12px;
          padding: 16px;
          font-size: 0.85rem;
          color: #78350f;
          max-width: 480px;
        }
        .setup-guide h3 { margin: 0 0 4px; font-size: 1rem; color: #92400e; }
        .setup-guide .progress { font-size: 0.75rem; opacity: 0.7; margin-bottom: 12px; }
        .setup-guide p { margin: 8px 0; line-height: 1.45; }
        .setup-guide ul { margin: 6px 0; padding-left: 20px; }
        .setup-guide code {
          background: rgba(146, 64, 14, 0.1);
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 0.85em;
        }
        .setup-tip { font-size: 0.8rem; opacity: 0.85; font-style: italic; }
        .kbd {
          background: #fde68a;
          padding: 1px 6px;
          border-radius: 4px;
          font-family: monospace;
        }
        .setup-link {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: #92400e;
          text-decoration: underline;
          font-weight: 600;
          padding: 6px 10px;
          background: white;
          border: 1px solid #fde68a;
          border-radius: 6px;
          margin: 4px 0;
        }
        .actions { display: flex; gap: 8px; margin-top: 14px; }
        .actions button {
          all: unset;
          cursor: pointer;
          padding: 6px 14px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 0.82rem;
          text-align: center;
          transition: all 0.15s;
        }
        .btn-primary { background: #d97706; color: white; }
        .btn-primary:hover { background: #b45309; }
        .btn-secondary { background: transparent; color: #92400e; }
        .btn-secondary:hover { background: rgba(146, 64, 14, 0.1); }
        .btn-success { background: #10b981; color: white; }
        .btn-success:hover { background: #059669; }
        .close-x {
          all: unset;
          cursor: pointer;
          position: absolute;
          top: 10px;
          right: 12px;
          color: #92400e;
          opacity: 0.5;
        }
        .close-x:hover { opacity: 1; }
        .setup-guide { position: relative; }
        .success-icon { color: #059669; }
      `}</style>

      {onClose && (
        <button className="close-x" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>
      )}

      <h3>
        {isLast && <CheckCircle2 size={16} className="success-icon" style={{ verticalAlign: 'middle', marginRight: 4 }} />}
        Cómo liberar la impresora ({step + 1}/{steps.length}): {current.title}
      </h3>
      <div className="progress">Paso {step + 1} de {steps.length}</div>

      <div className="step-body">{current.body}</div>

      <div className="actions">
        <button
          className="btn-secondary"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={isFirst}
        >
          ← Atrás
        </button>
        {isLast ? (
          onClose && (
            <button className="btn-success" onClick={onClose}>
              Listo, ya hice el cambio
            </button>
          )
        ) : (
          <button className="btn-primary" onClick={() => setStep((s) => s + 1)}>
            Siguiente →
          </button>
        )}
      </div>
    </div>
  );
}