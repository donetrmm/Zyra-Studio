import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { signedOutputUrl, publicThumbnailUrl } from '@/lib/supabase/storage';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: preset } = await admin
    .from('presets')
    .select('params, is_public, user_id')
    .eq('id', id)
    .single();
  if (!preset) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const user = await requireUser();
  if (!preset.is_public && preset.user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const presetParams = preset.params as Record<string, unknown>;
  const generationId = presetParams.generationId as string | undefined;
  if (!generationId) {
    return NextResponse.json({ outputUrl: null, thumbnailUrl: presetParams.thumbnailUrl ?? null });
  }

  const { data: gen } = await admin
    .from('generations')
    .select('output_url, thumbnail_url')
    .eq('id', generationId)
    .single();
  if (!gen) {
    return NextResponse.json({ outputUrl: null, thumbnailUrl: presetParams.thumbnailUrl ?? null });
  }

  const outputUrl = gen.output_url ? await signedOutputUrl(gen.output_url) : null;
  const thumbnailUrl = gen.thumbnail_url ? publicThumbnailUrl(gen.thumbnail_url) : null;

  return NextResponse.json({ outputUrl, thumbnailUrl });
}
