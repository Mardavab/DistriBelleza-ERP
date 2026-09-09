import { getColombiaToday, getColombiaDayRange } from '../lib/timezone';

describe('timezone utils', () => {
  it('getColombiaToday returns a valid date string YYYY-MM-DD', () => {
    const today = getColombiaToday();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('getColombiaDayRange returns start before end', () => {
    const { start, end } = getColombiaDayRange('2025-01-15');
    expect(new Date(start).getTime()).toBeLessThan(new Date(end).getTime());
  });

  it('getColombiaDayRange start is midnight in Colombia (05:00 UTC)', () => {
    const { start } = getColombiaDayRange('2025-01-15');
    expect(start).toBe('2025-01-15T05:00:00.000Z');
  });

  it('getColombiaDayRange uses today when no date provided', () => {
    const today = getColombiaToday();
    const { start } = getColombiaDayRange();
    expect(start).toContain(today);
  });
});
