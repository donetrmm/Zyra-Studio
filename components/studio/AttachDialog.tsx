'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Box,
  Droplets,
  Image as ImageIcon,
  Loader2,
  Map,
  Package,
  PersonStanding,
  Shirt,
  User,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { addGenerationAsReferenceAction, deleteMediaReferenceAction } from '@/server-actions/media-references';
import { attachStudioImageAction } from '@/server-actions/studio';
import {
  createCharacterOutfitAction,
  listCharacterOutfitsAction,
  updateCharacterOutfitImageAction,
} from '@/server-actions/character-outfits';
import {
  createCharacterStateAction,
  listCharacterStatesAction,
  updateCharacterStateImageAction,
} from '@/server-actions/character-states';
import {
  planLabeledAttach,
  type LabeledRole,
  type LabeledSelection,
} from '@/lib/studio/labeled-attach';
import type { StudioRole } from '@/lib/studio/attach-merge';
import type { StudioRefOption, StudioAssetType } from './types';

type RoleDef = { key: StudioRole; label: string; icon: React.ComponentType<{ className?: string }> };

const ROLES_BY_TYPE: Record<StudioAssetType, RoleDef[]> = {
  product: [
    { key: 'product', label: 'Imagen de producto', icon: Box },
    { key: 'packaging', label: 'Empaque', icon: Package },
  ],
  location: [
    { key: 'master', label: 'Maestra', icon: ImageIcon },
    { key: 'reference', label: 'Referencia', icon: ImageIcon },
    { key: 'scale_map', label: 'Mapa de escala', icon: Map },
  ],
  character: [
    { key: 'master', label: 'Maestra', icon: User },
    { key: 'angle', label: 'Ángulo', icon: ImageIcon },
    { key: 'full_body', label: 'Cuerpo completo', icon: PersonStanding },
  ],
};

// Sub-roles con etiqueta (solo personaje): NO son campos del registro characters
// sino filas de character_outfits/character_states, así que van por su propio
// camino (elegir existente → reemplaza imagen; etiqueta nueva → crea). Genérico
// sobre el rol para no duplicar la vista (las tablas/actions son espejos).
type LabeledItem = { id: string; label: string };

type LabeledActionResult = { ok: true } | { ok: false; message?: string };

type LabeledRoleConfig = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  placeholder: string;
  // Devuelve el Result de la action tal cual: distinguir "lista vacía" (data: [])
  // de "no se pudo cargar" (ok: false) — tragarse el error empujaba a crear un
  // duplicado en vez de reemplazar.
  loadItems: (characterId: string) => Promise<{ ok: true; data: LabeledItem[] } | { ok: false }>;
  create: (characterId: string, label: string, imageId: string) => Promise<LabeledActionResult>;
  update: (id: string, imageId: string) => Promise<LabeledActionResult>;
};

const LABELED_ROLE_CONFIG: Record<LabeledRole, LabeledRoleConfig> = {
  outfit: {
    label: 'Outfit',
    icon: Shirt,
    placeholder: 'Etiqueta (ej. Look casual)',
    loadItems: (characterId) => listCharacterOutfitsAction(characterId),
    create: (characterId, label, imageId) =>
      createCharacterOutfitAction({ characterId, label, outfitImageId: imageId }),
    update: (id, imageId) => updateCharacterOutfitImageAction({ outfitId: id, outfitImageId: imageId }),
  },
  state: {
    label: 'Estado',
    icon: Droplets,
    placeholder: 'Etiqueta (ej. Mojado)',
    loadItems: (characterId) => listCharacterStatesAction(characterId),
    create: (characterId, label, imageId) =>
      createCharacterStateAction({ characterId, label, stateImageId: imageId }),
    update: (id, imageId) => updateCharacterStateImageAction({ stateId: id, stateImageId: imageId }),
  },
};

const LABELED_ROLE_DEFS: LabeledRole[] = ['outfit', 'state'];

type View = { kind: 'roles' } | { kind: 'labeled'; role: LabeledRole };

export function AttachDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  generationId: string | null;
  assetId: string;
  assetType: StudioAssetType;
  onAttached: (newRef: StudioRefOption) => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'roles' });
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const roles = ROLES_BY_TYPE[props.assetType];
  const labeledRoles = props.assetType === 'character' ? LABELED_ROLE_DEFS : [];
  const totalButtons = roles.length + labeledRoles.length;

  async function attach(roleKey: StudioRole, roleLabel: string) {
    if (!props.generationId || saving) return;
    setSaving(roleKey);
    const ref = await addGenerationAsReferenceAction({ generationId: props.generationId });
    if (!ref.ok) {
      if (mountedRef.current) {
        setSaving(null);
        toast.error('No se pudo preparar la imagen');
      }
      return;
    }
    // Read-modify-write server-side: attachStudioImageAction relee el activo
    // fresco de la BD antes de fusionar (roles base = campos del registro).
    const res = await attachStudioImageAction({
      assetType: props.assetType,
      assetId: props.assetId,
      role: roleKey,
      referenceId: ref.data.id,
    });
    if (!res.ok) {
      // La ref recién copiada quedaría huérfana si el adjuntar falla: se limpia
      // (best-effort, server-side; corre aunque el diálogo se haya cerrado).
      void deleteMediaReferenceAction({ id: ref.data.id }).catch(() => {});
      if (mountedRef.current) {
        setSaving(null);
        toast.error(res.message ?? 'No se pudo guardar');
      }
      return;
    }
    // Diálogo cerrado mid-flight: el adjuntar ya quedó server-side; no tocamos la
    // UI (evita setState en desmontado y un toast de éxito tras cancelar).
    if (!mountedRef.current) return;
    setSaving(null);
    props.onAttached({
      id: ref.data.id,
      previewUrl: ref.data.previewUrl,
      filename: ref.data.filename,
    });
    props.onOpenChange(false);
    toast.success(`Añadida a ${roleLabel}`);
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {view.kind === 'roles' || !props.generationId ? (
          <>
            <DialogHeader>
              <DialogTitle>Adjuntar al activo</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">Elige el rol de esta imagen.</p>
            {/* Columnas según el nº total de botones: producto 2, locación 3,
                personaje 5 (3 base + outfit/estado). */}
            <div className={`grid ${totalButtons === 2 ? 'grid-cols-2' : 'grid-cols-3'} gap-3 pt-2`}>
              {roles.map((r) => {
                const Icon = r.icon;
                return (
                  <Button
                    key={r.key}
                    type="button"
                    variant="outline"
                    className="h-24 flex-col gap-2 whitespace-normal text-center text-xs"
                    disabled={saving !== null}
                    onClick={() => attach(r.key, r.label)}
                  >
                    <Icon className="h-6 w-6" />
                    {r.label}
                  </Button>
                );
              })}
              {labeledRoles.map((role) => {
                const cfg = LABELED_ROLE_CONFIG[role];
                const Icon = cfg.icon;
                return (
                  <Button
                    key={role}
                    type="button"
                    variant="outline"
                    className="h-24 flex-col gap-2 whitespace-normal text-center text-xs"
                    disabled={saving !== null}
                    onClick={() => setView({ kind: 'labeled', role })}
                  >
                    <Icon className="h-6 w-6" />
                    {cfg.label}
                  </Button>
                );
              })}
            </div>
          </>
        ) : (
          <LabeledAttachView
            key={view.role}
            role={view.role}
            generationId={props.generationId}
            characterId={props.assetId}
            onAttached={props.onAttached}
            onDone={() => props.onOpenChange(false)}
            onBack={() => setView({ kind: 'roles' })}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function LabeledAttachView(props: {
  role: LabeledRole;
  generationId: string;
  characterId: string;
  onAttached: (newRef: StudioRefOption) => void;
  onDone: () => void;
  onBack: () => void;
}) {
  const config = LABELED_ROLE_CONFIG[props.role];
  const [items, setItems] = useState<LabeledItem[] | null>(null); // null = cargando
  const [loadError, setLoadError] = useState(false);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    config.loadItems(props.characterId).then((res) => {
      if (!active) return;
      // Distingue lista vacía (data: []) de fallo de carga (ok: false).
      if (res.ok) setItems(res.data);
      else setLoadError(true);
    });
    return () => {
      active = false;
    };
  }, [props.characterId, config]);

  async function run(selection: LabeledSelection) {
    if (saving) return;
    const plan = planLabeledAttach(selection);
    if ('error' in plan) {
      toast.error(plan.error);
      return;
    }
    setSaving(true);
    const ref = await addGenerationAsReferenceAction({ generationId: props.generationId });
    if (!ref.ok) {
      if (mountedRef.current) {
        setSaving(false);
        toast.error('No se pudo preparar la imagen');
      }
      return;
    }
    const res =
      plan.kind === 'create'
        ? await config.create(props.characterId, plan.label, ref.data.id)
        : await config.update(plan.id, ref.data.id);
    if (!res.ok) {
      // La ref recién copiada quedaría huérfana si el guardado falla: se limpia
      // (best-effort, server-side; corre aunque el diálogo se haya cerrado).
      void deleteMediaReferenceAction({ id: ref.data.id }).catch(() => {});
      if (mountedRef.current) {
        setSaving(false);
        toast.error(res.message ?? 'No se pudo guardar');
      }
      return;
    }
    // Diálogo cerrado mid-flight: ya quedó guardado server-side; no tocamos la UI.
    if (!mountedRef.current) return;
    setSaving(false);
    props.onAttached({ id: ref.data.id, previewUrl: ref.data.previewUrl, filename: ref.data.filename });
    props.onDone();
    toast.success(`${config.label} guardado`);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <button
            type="button"
            onClick={props.onBack}
            disabled={saving}
            aria-label="Volver a los roles"
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          Adjuntar como {config.label}
        </DialogTitle>
      </DialogHeader>

      {items === null && !loadError ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : (
        <div className="space-y-4 pt-1">
          {loadError && (
            <p className="text-xs text-destructive">
              No se pudieron cargar los existentes. Puedes crear uno nuevo.
            </p>
          )}
          {items && items.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                Reemplazar la imagen de uno existente
              </p>
              <ul className="space-y-1.5">
                {items.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => run({ type: 'existing', id: it.id })}
                      disabled={saving}
                      className="w-full truncate rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-foreground hover:border-primary/40 disabled:opacity-50"
                    >
                      {it.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Crear con una etiqueta nueva</p>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={config.placeholder}
              maxLength={40}
              disabled={saving}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
            />
            <Button
              type="button"
              className="w-full"
              disabled={saving || !label.trim()}
              onClick={() => run({ type: 'new', label })}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {saving ? 'Guardando…' : 'Crear y adjuntar'}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
