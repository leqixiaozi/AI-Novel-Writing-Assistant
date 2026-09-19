export function upstream(rawUrl) {
  const pathname = new URL(rawUrl, 'http://localhost').pathname;
  const under = prefix => pathname === prefix || pathname.startsWith(`${prefix}/`);
  if (under('/api/new-design')) return 5301;
  if (under('/api')) return 3000;
  if (under('/new-design') || pathname === '/__new_hmr') return 5274;
  return 5275;
}
