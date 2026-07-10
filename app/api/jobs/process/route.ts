import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyQStashSignature } from '@/lib/jobs/receiver';
import { createAdminClient } from '@/lib/supabase/admin';
import { dispatchJob, dispatchCancel } from '@/lib/jobs/dispatch';
import { enqueueJob } from '@/lib/jobs/queue';
import { confirmCredits, failGeneration } from '@/lib/credits/operations';
import { finalizeGeneration } from '@/lib/jobs/finalize';
import { advanceSequenceChain, storeChainAudio, storeChainFrame } from '@/lib/campaigns/orchestrator';
import { extractVideoAudio } from '@/lib/jobs/video-frame';
import { downloadOutputBuffer } from '@/lib/supabase/storage';
import { promoteStoryboardPanel, storyboardCampaignItemId } from '@/lib/jobs/storyboard-finalize';
import type { GenerationRow } from '@/lib/jobs/handlers/types';
import '@/lib/jobs/handlers/register'; // side-effect: registra handlers

export const runtime = 'nodejs';
// 300s: una llamada de imagen (gpt-image-2) bloquea hasta ~280s; ver spec estudio.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  generationId: z.string().uuid(),
  action: z.enum(['submit', 'poll', 'advance_chain', 'promote_storyboard']),
  // Solo para 'advance_chain': PATH interno (references) del fotograma del clip
  // previo a heredar. El finalize lo sube con la URL fresca.
  lastFramePath: z.string().optional(),
  // Compat: la URL cruda solo en jobs encolados antes del deploy.
  lastFrameUrl: z.string().url().optional(),
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
      'id, user_id, workspace_id, type, provider, model_id, prompt, params, reference_ids, parent_generation_id, status, provider_task_id, provider_payload, poll_attempts, timeout_at, cancel_requested, credits_estimated',
    )
    .eq('id', generationId)
    .single();
  if (loadErr || !gen) {
    // Distinguir "no hay fila" (PGRST116: borrada por cleanup → ack, no reintentar)
    // de un fallo de carga (red, timeout, respuesta gigante): antes TODO se ack'eaba
    // como not_found y un fallo transitorio dejaba la gen en 'processing' para
    // siempre (QStash da el job por entregado). Con 500, QStash reintenta (3x).
    if (loadErr && loadErr.code !== 'PGRST116') {
      console.error('[worker] fallo cargando la gen', { generationId, error: loadErr.message });
      return NextResponse.json({ ok: false, error: 'load_failed' }, { status: 500 });
    }
    console.warn('[worker] gen no encontrada', { generationId });
    return NextResponse.json({ ok: true, ack: 'not_found' });
  }
  const generation = gen as unknown as GenerationRow;

  // 3.5. Avance de cadena (specs/v2/09): job dedicado. La gen aquí ya está
  // 'done' (terminal), así que se intercepta ANTES del guard terminal. Corre el
  // avance en su propia invocación con presupuesto fresco; ejecutarlo inline en
  // la invocación de finalize arriesgaba que un kill por maxDuration dejara la
  // próxima escena colgada en 'sample'.
  if (action === 'advance_chain') {
    try {
      if (generation.params?.chain && (parsed.lastFramePath || parsed.lastFrameUrl)) {
        // Spike audio encadenado: la extracción corre AQUÍ (presupuesto fresco
        // de 60s), no en el finalize — un post-step inline tras 'done' arriesga
        // el kill por maxDuration y dejaría la cadena sin avanzar (mismo patrón
        // que movió el promote del storyboard a su propio job). Best-effort en
        // su propio try: sin audio la cadena avanza igual.
        const chain = generation.params.chain as { sequenceId: string; sceneIndex: number; audioSource?: string };
        let prevAudioPath: string | null = null;
        if (chain.audioSource === 'prev_clip') {
          try {
            // output_url no viaja en el select estándar del worker: query
            // puntual solo en este modo (la gen ya está 'done' con el MP4 subido).
            const { data: outRow } = await admin
              .from('generations')
              .select('output_url')
              .eq('id', generation.id)
              .single();
            const outputUrl = (outRow as { output_url?: string | null } | null)?.output_url;
            if (outputUrl) {
              const { buffer } = await downloadOutputBuffer(outputUrl);
              const audioBuffer = await extractVideoAudio(buffer);
              if (audioBuffer) {
                prevAudioPath = await storeChainAudio(
                  generation.workspace_id,
                  chain.sequenceId,
                  chain.sceneIndex,
                  audioBuffer,
                );
              }
            }
          } catch (err) {
            console.warn('[worker] audio del clip previo no disponible, la cadena sigue sin él', { generationId, err });
          }
        }
        await advanceSequenceChain(
          generation,
          { path: parsed.lastFramePath, url: parsed.lastFrameUrl },
          prevAudioPath,
        );
      }
    } catch (err) {
      console.error('[worker] avance de cadena falló', { generationId, err });
    }
    return NextResponse.json({ ok: true, ack: 'chain_advanced' });
  }

  // 3.6. Promote del panel de storyboard: job dedicado. La gen aquí ya está
  // 'done' (terminal), así que se intercepta ANTES del guard terminal. Antes esto
  // corría inline tras finalize, pero en el path estricto (Nano + FLUX expand +
  // finalize) el download+upload+insert del promote empujaba la invocación sobre
  // maxDuration (60s): la función moría tras 'done' pero antes de enlazar el beat,
  // dejando el panel huérfano (output en storage, sin media_reference ni enlace).
  // Con presupuesto fresco de 60s el promote entra holgado.
  if (action === 'promote_storyboard') {
    try {
      await promoteStoryboardPanel(generation);
      // El evento 'done' de Realtime lo disparó el finalize ANTES de que existiera
      // el enlace, así que el cliente ya refrescó con el panel viejo. Este UPDATE
      // idempotente re-emite el evento para que refresque de nuevo, ahora con el
      // beat enlazado. provider_payload no viaja en el broadcast (migración 050),
      // así que el record queda chico.
      await admin
        .from('generations')
        .update({ status: 'done' })
        .eq('id', generation.id)
        .eq('status', 'done');
    } catch (err) {
      console.error('[worker] promote storyboard panel fallo', { generationId, err });
      // 500 -> QStash reintenta la entrega (retries: 3 en enqueueJob). El promote
      // es idempotente y con guard de frescura, así que reintentar es seguro.
      // Antes se hacía ack aquí: el panel quedaba cobrado pero sin enlazar, y la
      // única salida era regenerarlo pagando de nuevo.
      return NextResponse.json({ ok: false, error: 'promote_failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, ack: 'promoted' });
  }

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
    // El trigger sync_campaign_item_from_generation pone el item en 'failed'
    // pero NO la razón (warnings quedaba []). Si esta generación es de un item
    // de campaña, anotar un motivo accionable para que la UI lo muestre y el
    // usuario sepa qué hacer (ajustar la escena / regenerar). Best-effort.
    try {
      const reason =
        result.code === 'safety'
          ? 'El proveedor rechazó esta escena por moderación. Ajusta la descripción y vuelve a generarla.'
          : result.code === 'timeout'
            ? 'La generación tardó demasiado y se canceló. Reintenta cuando quieras.'
            : result.code === 'rate_limit'
              ? 'El proveedor está saturado ahora mismo. Reintenta en un momento.'
              : `No se pudo generar: ${result.message}`;
      // Paneles de storyboard: el item se linkea por params.storyboard (no por
      // generation_id, que solo usan los items de video) — sin este branch el
      // UPDATE afecta 0 filas y el motivo del fallo se pierde tras un reload.
      const sbItemId = storyboardCampaignItemId(generation);
      if (sbItemId) {
        await admin.from('campaign_items').update({ warnings: [reason] }).eq('id', sbItemId);
      } else {
        await admin.from('campaign_items').update({ warnings: [reason] }).eq('generation_id', generation.id);
      }
    } catch (err) {
      console.error('[worker] no se pudo anotar el motivo del fallo en el item', { generationId, err });
    }
    return NextResponse.json({ ok: true, ack: 'failed' });
  }

  if (result.kind === 'skip') {
    // Claim atómico perdido dentro del handler one-shot (image-turn.ts): otra
    // invocación de QStash (reintento) ya tomó este job y lo está procesando
    // o ya terminó. No-op — nada que confirmar, refundear ni re-encolar. El
    // manejo pleno de retries/dedupe queda para una task posterior; aquí solo
    // se evita el error de exhaustividad del switch al agregar 'skip' a JobResult.
    return NextResponse.json({ ok: true, ack: 'skip' });
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
    // Post-step del storyboard en su PROPIO job QStash (presupuesto fresco de 60s):
    // promover el output a media_reference y enlazarlo al campaign_item. Antes corría
    // inline aquí, pero sumado al finalize (y en estricto al FLUX expand) empujaba la
    // invocación sobre maxDuration -> panel huérfano. Best-effort: si falla el
    // encolado el output ya está 'done' y el beat es regenerable.
    if (storyboardCampaignItemId(generation)) {
      try {
        await enqueueJob({ generationId: generation.id, action: 'promote_storyboard', delaySeconds: 0 });
      } catch (err) {
        console.error('[worker] no se pudo encolar el promote del storyboard', { generationId, err });
      }
    }
    // Encadenado de secuencias (specs/v2/09): si este clip es parte de una
    // cadena y el proveedor devolvió su último fotograma, encolar el avance como
    // su PROPIO job (presupuesto fresco). Best-effort: un fallo al encolar no
    // debe tirar el clip ya servido (la escena queda 'planned', regenerable).
    if (generation.params?.chain && result.lastFrameUrl) {
      try {
        // #10: descargar el fotograma AHORA, con la URL del proveedor fresca, y
        // subirlo a references. El job de avance recibe el PATH interno — la URL
        // efímera de Atlas nunca sobrevive al worker ni depende de cuándo corra.
        const chain = generation.params.chain as { sequenceId: string; sceneIndex: number };
        const lastFramePath = await storeChainFrame(
          generation.workspace_id,
          chain.sequenceId,
          chain.sceneIndex,
          result.lastFrameUrl,
        );
        if (lastFramePath) {
          await enqueueJob({
            generationId: generation.id,
            action: 'advance_chain',
            lastFramePath,
            delaySeconds: 0,
          });
        }
      } catch (err) {
        console.error('[worker] no se pudo encolar el avance de cadena', { generationId, err });
      }
    }
    return NextResponse.json({ ok: true, ack: 'finalized' });
  } catch (err) {
    console.error('[worker] finalize falló', { generationId, err });
    // Si finalize falla, marcar la generación failed pero NO refundear: el
    // provider ya generó y cobró su cuota, el usuario pagó por un output que no
    // logramos servir. Pero hay que CONFIRMAR el cargo (mueve la reserva de
    // pending a spent): un UPDATE crudo dejaba el cost colgado en pending para
    // siempre. confirm_credits es idempotente (no-op si ya estaba confirmada).
    try {
      await confirmCredits(generation.user_id, generation.credits_estimated, generation.id);
    } catch (confErr) {
      console.error('[worker] confirm_credits en finalize-fail falló', { generationId, confErr });
    }
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
