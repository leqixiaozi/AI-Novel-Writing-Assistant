export function controlBandAtY(y: number, top: number, height: number): number {
  if (!Number.isFinite(y) || !Number.isFinite(top) || !Number.isFinite(height) || height <= 0) return 50;
  return Math.max(0, Math.min(100, Math.round((1 - (y - top) / height) * 4) * 25));
}
