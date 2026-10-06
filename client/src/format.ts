const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const euroCompact = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const number = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 });

export const money = (n: number): string => euro.format(Math.round(n));
export const moneyShort = (n: number): string => (Math.abs(n) >= 10_000 ? euroCompact.format(n) : euro.format(Math.round(n)));
export const num = (n: number): string => number.format(n);
export const dec = (n: number): string => decimal.format(n);
export const signedMoney = (n: number): string => (n > 0 ? '+' : '') + money(n);

export function countdown(ms: number): string {
  if (ms <= 0) return 'nu';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}u`;
  if (h > 0) return `${h}u ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

const dateTime = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const when = (epoch: number): string => dateTime.format(new Date(epoch));

export function tileLabel(tile: number, width: number): string {
  return `(${tile % width}, ${Math.floor(tile / width)})`;
}
