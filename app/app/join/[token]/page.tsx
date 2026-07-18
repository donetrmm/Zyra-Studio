import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { InviteTokenSchema } from '@/lib/schemas/team';
import { JoinCard } from '@/components/team/JoinCard';

export const metadata: Metadata = {
  title: 'Invitación',
};

type Peek =
  | { status: 'valid'; workspaceName: string; role: string }
  | { status: 'not_found' | 'used' | 'expired' };

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  // requireUser primero: el canje exige sesión y el middleware ya mandó a
  // login a los anónimos (el link de invitación sobrevive el roundtrip de
  // OAuth como cualquier ruta de /app).
  await requireUser();
  const { token } = await params;

  const parsed = InviteTokenSchema.safeParse(token);
  let peek: Peek = { status: 'not_found' };
  if (parsed.success) {
    const supabase = await createClient();
    const { data } = await supabase.rpc('peek_workspace_invite', { p_token: parsed.data });
    if (data) peek = data as Peek;
  }

  return (
    <div className="mx-auto grid min-h-[60dvh] w-full max-w-md place-items-center">
      <JoinCard token={parsed.success ? parsed.data : ''} peek={peek} />
    </div>
  );
}
