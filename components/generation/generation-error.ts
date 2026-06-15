// Lógica pura del estado de error de generación (S1). Separada de los componentes
// para poder testearla en node sin render: convierte la respuesta `ok:false` de
// submitGenerationAction en el GenError que el preview muestra de forma persistente.

export type GenError = {
  // safety: rechazo de contenido (reformular). credits: sin saldo (comprar).
  // generic: red/server/timeout/validación (reintentable).
  kind: 'safety' | 'credits' | 'generic';
  message: string;
  refunded: number; // créditos devueltos a mostrar (0 = no mostrar badge)
};

// Forma del fallo que devuelve submitGenerationAction.
export type GenFailure = { ok: false; error: string; message?: string };

// `cost` = costo estimado que se mostró; en fallos que no sean por falta de saldo
// el servidor lo devuelve, así que se muestra como "+N créditos devueltos".
export function genErrorFromResult(res: GenFailure, cost: number): GenError {
  const kind: GenError['kind'] =
    res.error === 'safety'
      ? 'safety'
      : res.error === 'insufficient_credits'
        ? 'credits'
        : 'generic';

  const message =
    res.error === 'insufficient_credits'
      ? 'No tienes saldo para esta generación. Compra créditos y vuelve a intentar.'
      : res.error === 'validation_error'
        ? 'Parámetros inválidos. Revisa el prompt y los ajustes, y reintenta.'
        : res.message || 'Hubo un problema al generar. Reintenta en un momento.';

  // En insufficient_credits no se llegó a cobrar → no hay nada que devolver.
  return { kind, message, refunded: kind === 'credits' ? 0 : cost };
}

// ¿Este error ofrece "Reintentar"? Solo los transitorios: reformular el mismo
// prompt (safety) o sin saldo (credits) no se arreglan reintentando igual.
export function isRetryable(error: GenError): boolean {
  return error.kind === 'generic';
}
