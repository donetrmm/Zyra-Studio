import { z } from 'zod';

// Filtros del listado de Biblioteca. El cursor viaja como par (createdAt, id)
// de la última fila mostrada — keyset, no offset: estable ante inserciones y
// borrados entre páginas.
export const ListLibrarySchema = z.object({
  type: z.enum(['image', 'video', 'audio']).optional(),
  favoritesOnly: z.boolean().default(false),
  includeStudio: z.boolean().default(false),
  q: z.string().max(200).optional(),
  sort: z.enum(['recent', 'old']).default('recent'),
  cursor: z
    .object({
      createdAt: z.string().datetime({ offset: true }),
      id: z.string().uuid(),
    })
    .nullable()
    .default(null),
});

export type ListLibraryInput = z.infer<typeof ListLibrarySchema>;
