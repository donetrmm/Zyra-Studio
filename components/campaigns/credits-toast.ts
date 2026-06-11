import { toast } from 'sonner';

// Bloqueo por balance (specs/v2/03 tarea 6): el toast lleva CTA directo al
// flujo de compra en vez de dejar al usuario sin salida.
export function insufficientCreditsToast(message = 'Créditos insuficientes') {
  toast.error(message, {
    action: {
      label: 'Comprar créditos',
      onClick: () => {
        window.location.assign('/app/billing');
      },
    },
  });
}
