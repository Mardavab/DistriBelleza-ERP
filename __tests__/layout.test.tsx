import React from 'react';
import { render, screen } from '@testing-library/react';
import RootLayout from '../app/layout';

jest.mock('../app/globals.css', () => ({}));

describe('RootLayout', () => {
  it('renders children', () => {
    render(
      <RootLayout>
        <div>Test Content</div>
      </RootLayout>
    );
    expect(screen.getByText('Test Content')).toBeTruthy();
  });
});
