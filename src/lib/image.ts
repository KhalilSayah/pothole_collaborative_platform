/** Downscale and re-encode a captured photo before upload. */
export async function shrink(file: File, maxEdge = 1280, quality = 0.82): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Image illisible'));
      i.src = url;
    });

    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);

    return await new Promise<Blob>((res, rej) =>
      c.toBlob(b => b ? res(b) : rej(new Error('Encodage impossible')), 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** One-shot GPS fix, for a stationary pedestrian report. */
export function locate(timeout = 15000): Promise<GeolocationPosition> {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Géolocalisation indisponible'));
    navigator.geolocation.getCurrentPosition(res,
      e => rej(new Error(e.code === 1
        ? "Accès à la position refusé. Autorisez la localisation pour signaler."
        : 'Position introuvable. Réessayez à ciel ouvert.')),
      { enableHighAccuracy: true, timeout, maximumAge: 0 });
  });
}
