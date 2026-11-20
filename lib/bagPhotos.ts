export type BagPhoto = { kind: 'inline' | 'storage'; value: string };

/** Accept existing demo images, Storage paths and legacy Firebase download URLs. */
export function parseBagPhoto(value: unknown): BagPhoto | null {
  if (typeof value !== 'string' || !value) return null;
  if (value.startsWith('data:image/')) return { kind: 'inline', value };
  if (value.startsWith('data:')) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'gs:' && url.hostname && url.pathname.length > 1) return { kind: 'storage', value };
    if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com') return null;
    const encoded = url.pathname.match(/^\/v0\/b\/[^/]+\/o\/(.+)$/)?.[1];
    if (!encoded) return null;
    const path = decodeURIComponent(encoded);
    return path ? { kind: 'storage', value: path } : null;
  } catch {
    return value.includes('://') || value.startsWith('/') ? null : { kind: 'storage', value };
  }
}
