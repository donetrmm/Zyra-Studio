'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import {
  CreateProductSchema,
  UpdateProductSchema,
  SetProductImagesSchema,
} from '@/lib/schemas/products';
import { productSlug } from '@/lib/campaigns/product-slug';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

export async function listProductsAction(
  brandId?: string,
): Promise<Result<unknown[]>> {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  let query = supabase
    .from('products')
    .select('*')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false });
  if (brandId) query = query.eq('brand_id', brandId);
  const { data, error } = await query;
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  return { ok: true, data: data ?? [] };
}

export async function createProductAction(
  input: unknown,
): Promise<Result<{ id: string }>> {
  const parsed = CreateProductSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  if (parsed.data.brandId) {
    const { data: kit } = await supabase
      .from('brand_kits')
      .select('id')
      .eq('id', parsed.data.brandId)
      .eq('workspace_id', workspace.id)
      .maybeSingle();
    if (!kit) {
      return { ok: false, error: 'forbidden', message: 'Marca no pertenece al workspace' };
    }
  }

  const { data, error } = await supabase
    .from('products')
    .insert({
      workspace_id: workspace.id,
      brand_id: parsed.data.brandId ?? null,
      name: parsed.data.name,
      slug: productSlug(parsed.data.name),
      medium: parsed.data.medium ?? null,
      height_cm: parsed.data.heightCm ?? null,
      width_cm: parsed.data.widthCm ?? null,
      thickness_mm: parsed.data.thicknessMm ?? null,
      weight_kg: parsed.data.weightKg ?? null,
      visual_details: parsed.data.visualDetails ?? null,
      palette: parsed.data.palette ?? null,
      product_image_ids: [],
      packaging_image_ids: [],
    })
    .select('id')
    .single();
  if (error || !data) {
    return { ok: false, error: 'internal_error', message: error?.message ?? 'insert failed' };
  }
  revalidatePath('/app/brand/kits');
  return { ok: true, data: { id: data.id as string } };
}

export async function updateProductAction(
  id: string,
  input: unknown,
): Promise<Result<{ updated: true }>> {
  const parsed = UpdateProductSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  if (parsed.data.brandId) {
    const { data: kit } = await supabase
      .from('brand_kits')
      .select('id')
      .eq('id', parsed.data.brandId)
      .eq('workspace_id', workspace.id)
      .maybeSingle();
    if (!kit) {
      return { ok: false, error: 'forbidden', message: 'Marca no pertenece al workspace' };
    }
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.brandId !== undefined) update.brand_id = parsed.data.brandId;
  if (parsed.data.name !== undefined) {
    update.name = parsed.data.name;
    update.slug = productSlug(parsed.data.name);
  }
  if (parsed.data.medium !== undefined) update.medium = parsed.data.medium;
  if (parsed.data.heightCm !== undefined) update.height_cm = parsed.data.heightCm;
  if (parsed.data.widthCm !== undefined) update.width_cm = parsed.data.widthCm;
  if (parsed.data.thicknessMm !== undefined) update.thickness_mm = parsed.data.thicknessMm;
  if (parsed.data.weightKg !== undefined) update.weight_kg = parsed.data.weightKg;
  if (parsed.data.visualDetails !== undefined) update.visual_details = parsed.data.visualDetails;
  if (parsed.data.palette !== undefined) update.palette = parsed.data.palette;

  const { error } = await supabase
    .from('products')
    .update(update)
    .eq('id', id)
    .eq('workspace_id', workspace.id);
  if (error) {
    return { ok: false, error: 'internal_error', message: error.message };
  }
  revalidatePath('/app/brand/kits');
  return { ok: true, data: { updated: true } };
}

// Imágenes de producto/empaque: los ids apuntan a media_references del
// workspace — se valida ownership de cada uno.
export async function setProductImagesAction(
  id: string,
  input: unknown,
): Promise<Result<{ updated: true }>> {
  const parsed = SetProductImagesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const allIds = [...parsed.data.productImageIds, ...parsed.data.packagingImageIds];
  if (allIds.length > 0) {
    const { data: refs } = await supabase
      .from('media_references')
      .select('id, workspace_id, type')
      .in('id', allIds);
    const valid = new Set(
      (refs ?? [])
        .filter((r) => r.workspace_id === workspace.id && r.type === 'image')
        .map((r) => r.id as string),
    );
    if (allIds.some((rid) => !valid.has(rid))) {
      return { ok: false, error: 'forbidden', message: 'Imagen no pertenece al workspace' };
    }
  }

  const { error } = await supabase
    .from('products')
    .update({
      product_image_ids: parsed.data.productImageIds,
      packaging_image_ids: parsed.data.packagingImageIds,
    })
    .eq('id', id)
    .eq('workspace_id', workspace.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath('/app/brand/kits');
  return { ok: true, data: { updated: true } };
}

export async function deleteProductAction(
  id: string,
): Promise<Result<{ deleted: true }>> {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspace.id);
  if (error) {
    return { ok: false, error: 'internal_error', message: error.message };
  }
  revalidatePath('/app/brand/kits');
  return { ok: true, data: { deleted: true } };
}
