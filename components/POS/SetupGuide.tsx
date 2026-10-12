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
 * Solución: reemplazar el driver por WinUSB con Zadig (o quitarlo).
 */
export default function SetupGuide({ onClose }: { onClose?: () => void }) {
  const [step, setStep] = useState(0);

  const steps = [
    {
      title: 'Verificá que Windows reconoce la impresora',
      body: (
        <>
          <p>
            Antes de tocar Zadig, confirmá que Windows ve la JAL58M:
          </p>
          <ol>
            <li>Apretá <kbd>Win + X</kbd> → <strong>Administrador de dispositivos</strong>.</li>
            <li>Buscá tu impresora en <em>{`"Colas de impresión"`}</em> o <em>{`"Controladoras de bus serie universal (USB)"`}</em>.</li>
            <li>Clic derecho en el dispositivo → <strong>Propiedades</strong> → pestaña <strong>Detalles</strong> → propiedad <strong>{`"Id. de hardware"`}</strong>.</li>
          </ol>
          <p>
            Vas a ver algo como <code>USB\VID_0416&amp;PID_5011\...</code>. Anotá el
            <strong> VID </strong>(4 caracteres después de <code>VID_</code>) y el
            <strong> PID </strong>(después de <code>PID_</code>). Los necesitás para encontrar la impresora en Zadig.
          </p>
          <p className="setup-tip">
            Si no aparece nada en el Administrador de dispositivos, el problema
            es físico: cable, puerto USB, o la impresora apagada. Resolvé eso
            primero.
          </p>
        </>
      ),
    },
    {
      title: 'Descargá Zadig',
      body: (
        <>
          <p>
            Zadig es una utilidad portable (no se instala) que reemplaza el
            driver de un dispositivo USB por otro, en este caso <strong>WinUSB</strong>.
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
            Bajá la versión {`"Zadig"`} (no la de {`"Zadig for Web"`}). Es un
            ZIP que se descomprime y se ejecuta.
          </p>
        </>
      ),
    },
    {
      title: 'Abrí Zadig como administrador',
      body: (
        <>
          <p>
            <strong>Importante.</strong> Si no lo abrís como administrador no va
            a poder reemplazar drivers ni va a mostrar la impresora.
          </p>
          <ol>
            <li>Clic derecho sobre <code>Zadig.exe</code>.</li>
            <li>Elegí <strong>{`"Ejecutar como administrador"`}</strong>.</li>
            <li>Si Windows pide confirmación, decí <strong>Sí</strong>.</li>
          </ol>
          <p className="setup-tip">
            En la barra de título de Zadig tiene que decir
            <em> {`"Administrator"`}</em> arriba.
          </p>
        </>
      ),
    },
    {
      title: 'Activar List All Devices',
      body: (
        <>
          <p>
            <strong>Este paso es el que casi siempre se olvida.</strong> Por
            defecto Zadig solo muestra dispositivos sin driver cargado, por eso
            no ves nada.
          </p>
          <ol>
            <li>En Zadig andá al menú <strong>Options</strong>.</li>
            <li>Marcá <strong>{`"List All Devices"`}</strong>.</li>
          </ol>
          <p>
            Después de eso, el desplegable de la izquierda va a mostrar todos los
            dispositivos USB: impresoras, mouse, hubs, etc.
          </p>
        </>
      ),
    },
    {
      title: 'Elegí tu impresora por su VID/PID',
      body: (
        <>
          <p>
            En el desplegable de Zadig, buscá el dispositivo cuyo VID y PID coincidan
            con los que copiaste del Administrador de dispositivos (paso 1).
          </p>
          <p>
            Los nombres comunes:
          </p>
          <ul>
            <li><code>USB Printer</code></li>
            <li><code>USB Printing Support</code></li>
            <li><code>JAL58M</code> / <code>Jaltech POS 58mm</code></li>
            <li>Algo como <code>USB\VID_XXXX&PID_YYYY</code></li>
          </ul>
          <p className="setup-tip">
            Si hay varios con el mismo VID/PID, elegí el primero (el principal).
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
            (recomendado). Hacé clic en <strong>{`"Replace Driver"`}</strong>.
          </p>
          <p>
            Confirmá el diálogo de Windows. Si te avisa que es un driver
            {` "sin firmar" `}, aceptá (Zadig usa drivers firmados por Microsoft,
            es seguro).
          </p>
          <p className="setup-tip">
            La barra de progreso puede tardar 20-40 segundos. <strong>No
            desconectés</strong> la impresora mientras corre.
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
            Esta vez debería ir al popup de Edge, seleccionás la JAL58M, y el
            badge pasa a <em>{`"Impresora lista · USB"`}</em>.
          </p>
          <p className="setup-tip">
            Si te sigue denegando, reiniciá la PC y volvé a intentar.
          </p>
        </>
      ),
    },
    {
      title: '¿No anda? Alternativa sin Zadig',
      body: (
        <>
          <p>
            Si Zadig no funciona en tu caso, podés desinstalar el driver de la
            impresora desde Windows. Quedará con el driver estándar
            <em> {`"USB Printing Support"`} </em> de Windows, que el navegador sí
            puede usar.
          </p>
          <ol>
            <li>
              Apretá <kbd>Win + X</kbd> → <strong>Administrador de dispositivos</strong>.
            </li>
            <li>
              Buscá tu impresora (en <em>{`"Colas de impresión"`}</em> o
              <em>{` "USB"`}</em>).
            </li>
            <li>
              Clic derecho → <strong>Desinstalar dispositivo</strong>.
            </li>
            <li>
              Marcá <strong>{`"Eliminar el software de controlador"`}</strong> y confirmá.
            </li>
            <li>
              Desconectá y reconectá el cable USB.
            </li>
            <li>
              Vuelve al POS, tocá <strong>{`"Reset"`}</strong> y después
              <strong> {`"Conectar"`}</strong>.
            </li>
          </ol>
          <p className="setup-tip">
            Windows va a querer reinstalar el driver original cada vez que
            conectes la impresora. Si eso te molesta, después podés usar Zadig
            para reemplazar el driver por WinUSB definitivamente.
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
        .setup-guide ul, .setup-guide ol { margin: 6px 0; padding-left: 20px; }
        .setup-guide li { margin: 4px 0; }
        .setup-guide code, kbd {
          background: rgba(146, 64, 14, 0.1);
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 0.85em;
        }
        kbd {
          border: 1px solid #fde68a;
          background: #fef3c7;
        }
        .setup-tip { font-size: 0.8rem; opacity: 0.85; font-style: italic; }
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
        .actions button:disabled { opacity: 0.4; cursor: not-allowed; }
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