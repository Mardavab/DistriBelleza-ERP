/**
 * Minimal Web Serial API type declarations.
 *
 * Disponible en Chrome/Edge desde v89. Permite a la página hablar con
 * dispositivos seriales (incluidos los puentos USB-serial tipo CH340/CH341
 * que usan muchas impresoras térmicas genéricas).
 */

declare global {
  interface SerialPortInfo {
    usbVendorId?: number;
    usbProductId?: number;
  }

  interface SerialPortRequestOptions {
    filters?: SerialPortFilter[];
  }

  interface SerialPortFilter {
    usbVendorId?: number;
    usbProductId?: number;
  }

  interface SerialOptions {
    baudRate: number;
    dataBits?: 7 | 8;
    stopBits?: 1 | 2;
    parity?: 'none' | 'even' | 'odd';
    flowControl?: 'none' | 'hardware';
    bufferSize?: number;
  }

  interface SerialPort {
    open(options: SerialOptions): Promise<void>;
    close(): Promise<void>;
    getInfo(): SerialPortInfo;
    readable: ReadableStream<Uint8Array> | null;
    writable: WritableStream<Uint8Array> | null;
    addEventListener(type: 'connect' | 'disconnect', listener: EventListener): void;
    removeEventListener(type: 'connect' | 'disconnect', listener: EventListener): void;
  }

  interface Serial {
    requestPort(opts?: SerialPortRequestOptions): Promise<SerialPort>;
    getPorts(): Promise<SerialPort[]>;
    addEventListener(type: 'connect' | 'disconnect', listener: EventListener): void;
    removeEventListener(type: 'connect' | 'disconnect', listener: EventListener): void;
  }

  interface Navigator {
    serial: Serial;
  }
}

export {};