const COLOMBIA_OFFSET_MS = -5 * 60 * 60 * 1000;

export function getColombiaDate(): Date {
  const now = new Date();
  return new Date(now.getTime() + COLOMBIA_OFFSET_MS);
}

export function getColombiaToday(): string {
  return getColombiaDate().toISOString().split('T')[0];
}

export function getColombiaDayRange(date?: string): { start: string; end: string } {
  const targetDate = date || getColombiaToday();
  const start = new Date(`${targetDate}T00:00:00-05:00`);
  const end = new Date(`${targetDate}T23:59:59-05:00`);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}
