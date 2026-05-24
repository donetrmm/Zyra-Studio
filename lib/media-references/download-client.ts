'use client';

// Descarga una imagen de Supabase Storage como blob y dispara el save dialog
// del browser. Reusable desde PreviewArea, ChatThread, LibraryView.
//
// El attribute `download` en <a href> no funciona cross-origin sin
// Content-Disposition: attachment en la respuesta — por eso bajamos el blob
// y disparamos el download desde un object URL local.
export async function downloadGenerationImage(
  url: string,
  filenameHint: string,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const ext = blob.type.includes('png')
    ? 'png'
    : blob.type.includes('webp')
      ? 'webp'
      : 'jpg';
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `${filenameHint}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
