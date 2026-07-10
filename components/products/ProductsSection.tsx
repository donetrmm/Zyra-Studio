'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Package, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { deleteProductAction } from '@/server-actions/products';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
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

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Productos</h2>
          <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-muted-foreground">
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
        <div className="mt-8 flex flex-col items-center gap-3 text-center text-muted-foreground">
          <div className="grid size-14 place-items-center rounded-2xl border border-border bg-muted/30">
            <Package className="size-6" aria-hidden />
          </div>
          <p className="text-[13.5px] text-foreground/70">Sin productos todavía</p>
          <p className="max-w-xs text-[12px]">Agrega el primer producto de esta marca para usarlo en tus campañas</p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onEdit={() => setEditing(product)}
              onDelete={async () => {
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
                } else {
                  toast.error(res.message || 'Error');
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductCard({
  product,
  onEdit,
  onDelete,
}: {
  product: ProductView;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hasDims = product.height_cm != null && product.width_cm != null;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card/50 transition-colors hover:border-muted-foreground/20">
      <div className="p-4">
        <h3 className="truncate text-[14px] font-medium text-foreground">{product.name}</h3>
        {product.medium && (
          <p className="mt-1 truncate text-[11.5px] text-muted-foreground">{product.medium}</p>
        )}
        {hasDims && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {product.height_cm} × {product.width_cm} cm
          </p>
        )}
        {product.palette && product.palette.length > 0 && (
          <div className="mt-2 flex gap-1">
            {product.palette.slice(0, 6).map((hex, i) => (
              <div key={i} className="size-5 rounded-full border border-border" style={{ backgroundColor: hex }} title={hex} />
            ))}
          </div>
        )}
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {product.product_image_ids.length} img producto · {product.packaging_image_ids.length} empaque
        </p>
      </div>
      <div className="flex gap-2 border-t border-border/30 p-3">
        <Link
          href={`/app/studio/product/${product.id}`}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Sparkles className="size-3" aria-hidden /> Abrir estudio
        </Link>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Pencil className="size-3" aria-hidden /> Editar
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:border-destructive/40 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Trash2 className="size-3" aria-hidden /> Eliminar
        </button>
      </div>
    </div>
  );
}
