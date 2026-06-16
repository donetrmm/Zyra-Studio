import 'server-only';
import { downloadOutputBuffer, uploadReference } from '@/lib/supabase/storage';
import { extractVideoFrame } from '@/lib/jobs/video-frame';

// Extrae el PRIMER fotograma del clip siguiente (ya generado) a calidad completa
// y lo sube a references para usarlo como cuadro de cierre del clip que se
// regenera. `nextOutputPath` es generations.output_url del clip i+1 (path en el
// bucket outputs). Devuelve el path interno del fotograma, o null si algo falla
// (el caller cae a regeneración solo-init).
export async function buildClosingFrameRef(params: {
  workspaceId: string;
  sequenceId: string;
  sceneIndex: number; // índice del clip que se regenera
  nextOutputPath: string;
}): Promise<string | null> {
  try {
    const { buffer } = await downloadOutputBuffer(params.nextOutputPath);
    const frame = await extractVideoFrame(buffer, { atSeconds: 0, thumbnail: false });
    return await uploadReference(
      params.workspaceId,
      `chain/${params.sequenceId}/${params.sceneIndex}-closing.jpg`,
      frame,
      'image/jpeg',
    );
  } catch (err) {
    console.error('[closing-frame] no se pudo construir el cierre', {
      sequenceId: params.sequenceId,
      sceneIndex: params.sceneIndex,
      err: (err as Error)?.message,
    });
    return null;
  }
}
