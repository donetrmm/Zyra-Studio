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

// Extrae un fotograma de un video en memoria y devuelve el JPG resultante.
export async function extractVideoFrame(buffer: Buffer, opts: FrameOpts): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'zyra-frame-'));
  const inputPath = join(dir, 'input.mp4');
  const outputPath = join(dir, 'frame.jpg');
  await writeFile(inputPath, buffer);
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const ffmpeg = spawn(ffmpegInstaller.path, buildFrameArgs(inputPath, outputPath, opts), {
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
