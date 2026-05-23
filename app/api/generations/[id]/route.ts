import { NextResponse } from 'next/server';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { publicThumbnailUrl, signedOutputUrl } from '@/lib/supabase/storage';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { workspace } = await requireWorkspace();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('generations')
    .select(
      'id, prompt, model_id, params, status, output_url, thumbnail_url, credits_charged, created_at, workspace_id',
    )
    .eq('id', id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (data.workspace_id !== workspace.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const outputUrl = data.output_url ? await signedOutputUrl(data.output_url) : null;
  const thumbnailUrl = data.thumbnail_url ? publicThumbnailUrl(data.thumbnail_url) : null;

  const params2 = (data.params ?? {}) as { aspect_ratio?: string };
  return NextResponse.json({
    id: data.id,
    prompt: data.prompt,
    model: data.model_id,
    variant: params2.aspect_ratio ?? 'default',
    status: data.status,
    outputUrl,
    thumbnailUrl,
    credits: data.credits_charged ?? 0,
    createdAt: new Date(data.created_at).getTime(),
  });
}
