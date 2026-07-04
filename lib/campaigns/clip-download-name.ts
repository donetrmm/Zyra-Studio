// Nombre de archivo al descargar el video de un item de Producción. Los clips
// de una secuencia llevan su número 1-based zero-padded (en el explorador,
// `clip-10` no debe colarse antes de `clip-2`) más un sufijo corto del id de
// generación para que dos secuencias no se sobrescriban el mismo número.
// Creativos sueltos no tienen número de clip: conservan el nombre por id.
export function clipDownloadName(item: {
  sequenceId: string | null;
  sceneIndex: number | null;
  generationId: string;
}): string {
  if (item.sequenceId != null && item.sceneIndex != null) {
    return `clip-${String(item.sceneIndex + 1).padStart(2, '0')}-${item.generationId.slice(0, 6)}`;
  }
  return `1to1-${item.generationId.slice(0, 8)}`;
}
