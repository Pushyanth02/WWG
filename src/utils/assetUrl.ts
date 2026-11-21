/**
 * Resolves a root-relative public asset path (e.g. "/assets/manifest.json")
 * against Vite's configured base URL so the app works seamlessly both at "/"
 * and on subpath hosts like GitHub Pages ("/WWG/").
 */
export function assetUrl(path: string): string {
  if (!path || /^(https?:|data:|blob:)/i.test(path)) {
    return path;
  }
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (base && normalized.startsWith(`${base}/`)) {
    return normalized;
  }
  return `${base}${normalized}`;
}
