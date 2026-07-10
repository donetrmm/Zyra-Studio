'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Package, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { createProductAction, deleteProductAction, setProductImagesAction } from '@/server-actions/products';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { PageEmptyState } from '@/components/ui/page-empty-state';
import { AssetCard } from '@/components/assets/AssetCard';
import { AssetGrid } from '@/components/assets/AssetGrid';
import { AssetSearch } from '@/components/assets/AssetSearch';
import { ProductEditor, type ProductView } from '@/components/products/ProductEditor';

// Lista anidada de productos de un brand kit (V3 multi-producto). Espeja el
// patrón de BrandKitsPage: grid de tarjetas + editor inline que se abre debajo
// del encabezado, sin overlay modal, para quedar consistente con el resto del
// panel de marca.
export function ProductsSection({
  brandKitId,
  products: initial,
  previews,
  usages,
}: {
  brandKitId: string;
  products: ProductView[];
  previews: Record<string, string>;
  usages: Record<string, string>;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [products, setProducts] = useState(initial);
  // Re-sincroniza tras router.refresh(): ajuste de estado durante render,
  // no en effect (mismo patrón que BrandKitsPage).
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setProducts(initial);
  }
  const [editing, setEditing] = useState<ProductView | 'new' | null>(null);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.medium ?? '').toLowerCase().includes(q),
    );
  }, [products, query]);

  async function handleDelete(product: ProductView) {
    const ok = await confirm({
      title: `¿Eliminar "${product.name}"?`,
      description: 'El producto se eliminará permanentemente.',
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    const res = await deleteProductAction(product.id);
    if (res.ok) {
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
      toast.success('Producto eliminado');
    } else toast.error(res.message || 'Error');
  }

  // Duplica: crea el producto con la misma ficha y, si tiene imágenes, las
  // comparte (mismos ids de media_references) vía setProductImagesAction.
  async function handleDuplicate(product: ProductView) {
    const res = await createProductAction({
      brandId: brandKitId,
      name: `${product.name} (copia)`,
      medium: product.medium ?? undefined,
      heightCm: product.height_cm ?? undefined,
      widthCm: product.width_cm ?? undefined,
      thicknessMm: product.thickness_mm ?? undefined,
      weightKg: product.weight_kg ?? undefined,
      visualDetails: product.visual_details ?? undefined,
      palette: product.palette ?? undefined,
    });
    if (!res.ok) {
      toast.error(res.message || 'No se pudo duplicar');
      return;
    }
    if (product.product_image_ids.length || product.packaging_image_ids.length) {
      await setProductImagesAction(res.data.id, {
        productImageIds: product.product_image_ids,
        packagingImageIds: product.packaging_image_ids,
      });
    }
    toast.success('Producto duplicado');
    router.refresh();
  }

  const showSearch = products.length > 5;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-heading text-base font-semibold text-foreground">Productos</h2>
          <p className="mt-1 max-w-xl text-2xs leading-relaxed text-muted-foreground">
            Cada producto tiene su propia ficha física y referencias visuales, para anclar escala y fidelidad en el storyboard.
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => setEditing('new')} className="shrink-0">
          <Plus className="size-4" aria-hidden />
          Nuevo producto
        </Button>
      </div>

      {editing && (
        <ProductEditor
          brandKitId={brandKitId}
          product={editing === 'new' ? null : editing}
          previews={previews}
          usages={usages}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
      )}

      {products.length === 0 && !editing ? (
        <PageEmptyState
          className="min-h-[220px]"
          icon={Package}
          title="Sin productos todavía"
          sub="Agrega el primer producto de esta marca para usarlo en tus campañas."
        />
      ) : (
        <>
          {showSearch && (
            <AssetSearch className="mt-4" value={query} onChange={setQuery} placeholder="Buscar producto…" />
          )}
          {filtered.length === 0 ? (
            <PageEmptyState
              className="min-h-[220px]"
              icon={Package}
              title="Sin resultados"
              sub="Ningún producto coincide con tu búsqueda."
            />
          ) : (
            <AssetGrid className="mt-4">
              {filtered.map((product) => {
                const hasDims = product.height_cm != null && product.width_cm != null;
                const hasPalette = Boolean(product.palette && product.palette.length > 0);
                const imgId = product.product_image_ids[0] ?? product.packaging_image_ids[0] ?? null;
                return (
                  <AssetCard
                    key={product.id}
                    media={{
                      url: imgId ? previews[imgId] ?? null : null,
                      alt: product.name,
                      aspect: 'square',
                      fallbackIcon: Package,
                    }}
                    title={product.name}
                    description={product.medium}
                    readiness={
                      product.product_image_ids.length > 0
                        ? { status: 'ready', label: 'Listo' }
                        : { status: 'incomplete', label: 'Sin imágenes' }
                    }
                    meta={
                      hasDims || hasPalette ? (
                        <span className="inline-flex items-center gap-2 text-2xs text-muted-foreground/70">
                          {hasDims && (
                            <span>
                              {product.height_cm} × {product.width_cm} cm
                            </span>
                          )}
                          {hasPalette && (
                            <span className="flex gap-1">
                              {product.palette!.slice(0, 5).map((hex, i) => (
                                <span
                                  key={i}
                                  className="size-3 rounded-full border border-border"
                                  style={{ backgroundColor: hex }}
                                  title={hex}
                                />
                              ))}
                            </span>
                          )}
                        </span>
                      ) : null
                    }
                    primary={{ kind: 'link', href: `/app/studio/product/${product.id}`, label: 'Estudio', icon: Sparkles }}
                    secondary={{ kind: 'button', onClick: () => setEditing(product), label: 'Editar', icon: Pencil }}
                    menu={[
                      { label: 'Duplicar', icon: Copy, onClick: () => handleDuplicate(product) },
                      { label: 'Eliminar', icon: Trash2, onClick: () => handleDelete(product), destructive: true },
                    ]}
                  />
                );
              })}
            </AssetGrid>
          )}
        </>
      )}
    </div>
  );
}
