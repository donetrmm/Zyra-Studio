import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyQStashSignature } from '@/lib/jobs/receiver';
import { createAdminClient } from '@/lib/supabase/admin';
import { dispatchJob, dispatchCancel } from '@/lib/jobs/dispatch';
import { enqueueJob } from '@/lib/jobs/queue';
import { failGeneration } from '@/lib/credits/operations';
import { finalizeGeneration } from '@/lib/jobs/finalize';
import type { GenerationRow } from '@/lib/jobs/handlers/types';
import '@/lib/jobs/handlers/register'; // side-effect: registra handlers

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  generationId: z.string().uuid(),
  action: z.enum(['submit', 'poll']),
});

const TERMINAL_STATUSES = new Set(['done', 'failed', 'canceled']);

export async function POST(req: Request) {
  // 1. Verificar firma ANTES de leer el body como JSON
  const rawBody = await req.text();
  const signature = req.headers.get('upstash-signature');
  if (!signature) {
    return NextResponse.json({ error: 'missing signature' }, { status: 401 });
  }
  try {
    // QStash firma contra la URL pública que le pasamos en publishJSON.
    // req.url detrás de proxy (ngrok, Vercel) resuelve a localhost/internal,
    // no a la URL pública. Usamos NEXT_PUBLIC_APP_URL para matchear.
    const verifyUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/jobs/process`
      : req.url;
    await verifyQStashSignature({
      signature,
      body: rawBody,
      url: verifyUrl,
    });
  } catch (err) {
    console.error('[worker] firma inválida', err);
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  // 2. Parsear body
  let parsed;
  try {
    parsed = BodySchema.parse(JSON.parse(rawBody));
  } catch (err) {
    console.error('[worker] body inválido', err);
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const { generationId, action } = parsed;

  // 3. Cargar generation con service_role
  const admin = createAdminClient();
  const { data: gen, error: loadErr } = await admin
    .from('generations')
    .select(
      'id, user_id, workspace_id, type, provider, model_id, prompt, params, reference_ids, status, provider_task_id, provider_payload, poll_attempts, timeout_at, cancel_requested, credits_estimated',
    )
    .eq('id', generationId)
    .single();
  if (loadErr || !gen) {
    // Row borrada (cleanup, etc.) → ack y exit. No error para QStash.
    console.warn('[worker] gen no encontrada', { generationId });
    return NextResponse.json({ ok: true, ack: 'not_found' });
  }
  const generation = gen as unknown as GenerationRow;

  // 4. Guard: status terminal → ack
  if (TERMINAL_STATUSES.has(generation.status)) {
    return NextResponse.json({ ok: true, ack: 'terminal' });
  }

  // 5. Guard: cancel_requested o timeout
  const timedOut =
    generation.timeout_at !== null && new Date(generation.timeout_at) < new Date();
  if (generation.cancel_requested || timedOut) {
    try {
      await dispatchCancel(generation);
    } catch (err) {
      console.error('[worker] cancel adapter falló', { generationId, err });
    }
    const reason = generation.cancel_requested ? 'canceled by user' : 'timeout';
    try {
      // fail_generation RPC es idempotente: marca status='failed' +
      // error_message + refund condicional. Si necesitamos diferenciar
      // 'canceled' vs 'failed' lo hacemos en un segundo UPDATE acotado por
      // WHERE status='failed' (solo flippa lo que el RPC recién dejó).
      await failGeneration(
        generation.user_id,
        generation.id,
        generation.credits_estimated,
        reason,
      );
      if (generation.cancel_requested) {
        await admin
          .from('generations')
          .update({ status: 'canceled' })
          .eq('id', generation.id)
          .eq('status', 'failed'); // solo flippa si fail_generation lo dejó así
      }
    } catch (err) {
      console.error('[worker] fail_generation falló', { generationId, err });
    }
    return NextResponse.json({ ok: true, ack: reason });
  }

  // 6. Dispatch al handler del provider
  const result = await dispatchJob(generation, action);

  // 7. Procesar resultado
  if (result.kind === 'continue') {
    // Re-encolar para el próximo poll. WHERE status IN ('queued','processing')
    // garantiza que un duplicado tardío de QStash no rebaje un terminal
    // ('done' / 'failed' / 'canceled'). Si el UPDATE afecta 0 rows, otra
    // invocación ganó la carrera — no re-encolamos y ack.
    const update: Record<string, unknown> = {
      status: 'processing',
      poll_attempts: generation.poll_attempts + 1,
    };
    if (result.taskId && !generation.provider_task_id) {
      update.provider_task_id = result.taskId;
    }
    if (result.providerPayload) {
      update.provider_payload = {
        ...(generation.provider_payload ?? {}),
        ...result.providerPayload,
      };
    }
    const { count } = await admin
      .from('generations')
      .update(update, { count: 'exact' })
      .eq('id', generation.id)
      .in('status', ['queued', 'processing']);
    if (count === 0) {
      // Otra invocación llevó el job a terminal entre nuestro SELECT y UPDATE.
      // No re-encolamos.
      return NextResponse.json({ ok: true, ack: 'continue_lost_race' });
    }
    await enqueueJob({
      generationId: generation.id,
      action: 'poll',
      delaySeconds: result.delaySeconds,
    });
    return NextResponse.json({ ok: true, ack: 'continue' });
  }

  if (result.kind === 'fail') {
    // fail_generation RPC hace UPDATE de status='failed' + error_message +
    // refund condicional (idempotente). No duplicamos el UPDATE.
    try {
      await failGeneration(
        generation.user_id,
        generation.id,
        generation.credits_estimated,
        result.message,
      );
    } catch (err) {
      console.error('[worker] fail_generation falló', { generationId, err });
    }
    return NextResponse.json({ ok: true, ack: 'failed' });
  }

  // result.kind === 'finalize' — handler entregó el buffer
  const startedAt = generation.provider_payload?._started_at as number | undefined;
  const processingMs = startedAt ? Date.now() - startedAt : 0;
  try {
    await finalizeGeneration({
      gen: generation,
      outputBuffer: result.outputBuffer,
      mimeType: result.mimeType,
      processingMs,
      metadata: result.metadata,
    });
    return NextResponse.json({ ok: true, ack: 'finalized' });
  } catch (err) {
    console.error('[worker] finalize falló', { generationId, err });
    // Si finalize falla, marcar la generación failed pero NO refundear el cost
    // (la imagen/video ya fue generada y consumida del provider). El usuario
    // pagó por un output que no logramos servir. Operacionalmente: log + alert
    // manual; en una fase futura se podría reintentar el upload.
    //
    // WHERE status IN ('queued','processing'): si un duplicado de QStash ya
    // ejecutó finalize con éxito y dejó status='done', NO degradar a 'failed'.
    await admin
      .from('generations')
      .update({
        status: 'failed',
        error_message: `finalize failed: ${(err as Error)?.message ?? 'unknown'}`,
        completed_at: new Date().toISOString(),
      })
      .eq('id', generation.id)
      .in('status', ['queued', 'processing']);
    return NextResponse.json({ ok: false, error: 'finalize failed' }, { status: 500 });
  }
}
