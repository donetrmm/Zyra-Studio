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

  console.log('[cleanup] result:', data);
  return NextResponse.json({ ok: true, result: data });
}
