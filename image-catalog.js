let cachedImages = null;

export async function listProductImages() {
  if (cachedImages) return cachedImages;
  const response = await fetch("/assets/products/catalog.json", {cache:"no-cache"});
  if (!response.ok) throw new Error("No se pudo cargar el catálogo local de imágenes");
  const data = await response.json();
  cachedImages = Array.isArray(data) ? data.filter(item => item.id && item.imageUrl && item.thumbUrl) : [];
  return cachedImages;
}
