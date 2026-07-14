import { z } from 'zod';

// Tokens de invitación: base64url de 24 bytes (crypto.randomBytes). El regex
// rechaza cualquier cosa que no sea un token nuestro antes de tocar la BD.
export const InviteTokenSchema = z
  .string()
  .min(20)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const RedeemInviteSchema = z.object({ token: InviteTokenSchema });

export const RevokeInviteSchema = z.object({ inviteId: z.string().uuid() });

export const RemoveMemberSchema = z.object({ userId: z.string().uuid() });

export const SetActiveWorkspaceSchema = z.object({ workspaceId: z.string().uuid() });
