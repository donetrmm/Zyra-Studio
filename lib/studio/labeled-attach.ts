// Sub-roles de personaje con etiqueta (outfit/estado). A diferencia de los roles
// base (campos del registro `characters`), viven en tablas propias
// (character_outfits/character_states) y el adjuntar es "crear con etiqueta
// nueva" o "reemplazar la imagen de uno existente". Este módulo es la resolución
// PURA (validación de etiqueta + decisión create-vs-update) para mantener el
// componente delgado y cubrir las ramas con test (regla 80-tests). No lee ni
// escribe nada: el diálogo llama las server actions con el plan resuelto.

export type LabeledRole = 'outfit' | 'state';

export type LabeledSelection =
  | { type: 'new'; label: string }
  | { type: 'existing'; id: string };

export type LabeledAttachPlan =
  | { kind: 'create'; label: string }
  | { kind: 'update'; id: string }
  | { error: string };

// Cap de etiqueta = el de CreateCharacterOutfit/StateSchema (`.max(40)`).
const LABEL_MAX = 40;

export function planLabeledAttach(selection: LabeledSelection): LabeledAttachPlan {
  if (selection.type === 'existing') {
    return selection.id
      ? { kind: 'update', id: selection.id }
      : { error: 'Elige un elemento de la lista.' };
  }
  const label = selection.label.trim();
  if (!label) return { error: 'Escribe una etiqueta.' };
  if (label.length > LABEL_MAX) return { error: `La etiqueta es muy larga (máx. ${LABEL_MAX}).` };
  return { kind: 'create', label };
}
