import { NextResponse } from 'next/server';
import { verifyQStashSignature } from '@/lib/jobs/receiver';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get('upstash-signature');
  if (!signature) {
    return NextResponse.json({ error: 'missing signature' }, { status: 401 });
  }
  try {
    const verifyUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/jobs/cleanup`
      : req.url;
    await verifyQStashSignature({ signature, body: rawBody, url: verifyUrl });
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('cleanup_old_data');
  if (error) {
    console.error('[cleanup] error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // El RPC borra las filas y devuelve los paths exactos de sus objetos de
  // Storage (migración 065) — SQL no puede tocar los buckets, se borran aquí.
  // Best-effort por lotes: un remove fallido se loguea con sus paths para
  // poder barrerlo a mano; no bloquea el resto del cleanup.
  const result = (data ?? {}) as {
    storage?: { outputs?: string[]; thumbnails?: string[]; references?: string[] };
    [k: string]: unknown;
  };
  const buckets: Array<[string, string[]]> = [
    ['outputs', result.storage?.outputs ?? []],
    ['thumbnails', result.storage?.thumbnails ?? []],
    ['references', result.storage?.references ?? []],
  ];
  let objectsRemoved = 0;
  let objectsFailed = 0;
  for (const [bucket, paths] of buckets) {
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error: rmErr } = await admin.storage.from(bucket).remove(chunk);
      if (rmErr) {
        objectsFailed += chunk.length;
        console.error('[cleanup] remove de storage falló', {
          bucket,
          count: chunk.length,
          error: rmErr.message,
          paths: chunk,
        });
      } else {
        objectsRemoved += chunk.length;
      }
    }
  }

  const { storage: _storage, ...counts } = result;
  console.log('[cleanup] result:', { ...counts, objectsRemoved, objectsFailed });
  return NextResponse.json({ ok: true, result: { ...counts, objectsRemoved, objectsFailed } });
}
