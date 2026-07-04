import 'server-only';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

export type FrameOpts = { atSeconds: number; thumbnail: boolean };

// Args para extraer UN fotograma. thumbnail=true → miniatura ligera (512px, q4).
// thumbnail=false → calidad completa para condicionar video (sin downscale, q2).
export function buildFrameArgs(inputPath: string, outputPath: string, opts: FrameOpts): string[] {
  const base = ['-loglevel', 'error', '-i', inputPath, '-ss', String(opts.atSeconds), '-frames:v', '1'];
  const quality = opts.thumbnail ? ['-vf', 'scale=512:-1', '-q:v', '4'] : ['-q:v', '2'];
  return [...base, ...quality, outputPath];
}

// Args para extraer la PISTA DE AUDIO de un clip (spike audio encadenado
// 2026-07-04): sin video (-vn), re-encode AAC 128k (robusto ante cualquier
// códec de origen; un clip de <=15s tarda ~1s). Contenedor .m4a.
export function buildAudioArgs(inputPath: string, outputPath: string): string[] {
  return ['-loglevel', 'error', '-i', inputPath, '-vn', '-acodec', 'aac', '-b:a', '128k', outputPath];
}

// Andamiaje compartido de una corrida de ffmpeg sobre un video en memoria:
// tmp dir + input a disco + spawn + leer el archivo de salida + cleanup.
// LANZA en cualquier fallo; los wrappers deciden el contrato (throw vs null).
async function runFfmpeg(
  buffer: Buffer,
  outputName: string,
  args: (inputPath: string, outputPath: string) => string[],
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'zyra-ffmpeg-'));
  const inputPath = join(dir, 'input.mp4');
  const outputPath = join(dir, outputName);
  try {
    await writeFile(inputPath, buffer);
    return await new Promise<Buffer>((resolve, reject) => {
      const ffmpeg = spawn(ffmpegInstaller.path, args(inputPath, outputPath), {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let errMsg = '';
      ffmpeg.stderr.on('data', (c) => (errMsg += c.toString()));
      ffmpeg.on('error', reject);
      ffmpeg.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`ffmpeg exit ${code}: ${errMsg.slice(0, 300)}`));
          return;
        }
        try {
          resolve(await readFile(outputPath));
        } catch (e) {
          reject(e);
        }
      });
    });
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    await rmdir(dir).catch(() => {});
  }
}

// Extrae un fotograma de un video en memoria y devuelve el JPG resultante.
// Lanza si falla: el thumbnail es parte del contrato del finalize.
export async function extractVideoFrame(buffer: Buffer, opts: FrameOpts): Promise<Buffer> {
  return runFfmpeg(buffer, 'frame.jpg', (i, o) => buildFrameArgs(i, o, opts));
}

// Extrae el audio de un video en memoria como M4A (AAC). null si el clip no
// tiene pista de audio (generateAudio=false) o si CUALQUIER paso falla —
// mkdtemp/writeFile incluidos, no solo ffmpeg: el caller decide seguir sin
// referencia, nunca romper el avance de la cadena.
export async function extractVideoAudio(buffer: Buffer): Promise<Buffer | null> {
  try {
    return await runFfmpeg(buffer, 'audio.m4a', buildAudioArgs);
  } catch (err) {
    console.warn('[video-audio] extracción falló', { err: (err as Error)?.message?.slice(0, 300) });
    return null;
  }
}
