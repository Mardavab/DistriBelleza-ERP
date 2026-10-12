import React from 'react';
import { render, screen } from '@testing-library/react';

// Mock de globals.css (no se carga CSS en Jest)
jest.mock('../app/globals.css', () => ({}));

// Mock del módulo que tira en entorno jsdom (ver lib/supabase.ts).
// Devolvemos clientes con la forma mínima que `getCurrentCompanySafe()`
// necesita para no invocar la red.
jest.mock('../lib/supabase', () => ({
  __esModule: true,
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
  }),
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  },
}));

// Mock de next/navigation para evitar errores en server components importados.
jest.mock('next/navigation', () => ({
  cookies: () => ({
    getAll: () => [],
    get: () => undefined,
  }),
}));

import RootLayout from '../app/layout';

describe('RootLayout', () => {
  it('renders children', async () => {
    const tree = await RootLayout({
      children: <div data-testid="content">Test Content</div>,
    });
    // No envolver en <>: RootLayout ya retorna <html><body>...</body></html>
    render(tree as React.ReactElement);
    expect(screen.getByTestId('content')).toBeTruthy();
  });
});