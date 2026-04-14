/**
 * Resolves a URL for use within a Web Worker context.
 * 
 * In dedicated workers, relative URLs resolve from the worker script location 
 * (e.g., /assets/scene.worker-*.js), which breaks app-relative asset paths.
 * This utility ensures consistent resolution against the application root.
 * 
 * @param url The relative or absolute URL to resolve.
 * @returns The resolved URL string.
 */
export function resolveTextureUrlForWorker(url: string): string {
  if (!url) {
    return url;
  }

  // Skip absolute URLs, data URIs, and blob URLs
  if (/^(https?:|data:|blob:)/i.test(url) || url.startsWith('//')) {
    return url;
  }

  // Normalize backslashes (Windows) to forward slashes
  var normalized = url.replace(/\\/g, '/');

  // If already root-relative, return as-is
  if (normalized.startsWith('/')) {
    return normalized;
  }

  // Prepend / to ensure it resolves from the origin root
  return `/${normalized}`;
}
