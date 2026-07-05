import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { signedVoiceSampleUrl } from '@/lib/supabase/storage';
import { VoicesPage } from '@/components/voices/VoicesPage';

export const dynamic = 'force-dynamic';

export default async function VoicesRoute() {
  const { user } = await requireWorkspace();
  const supabase = await createClient();
  const { data: voices } = await supabase
    .from('voice_clones')
    .select('id, name, description, elevenlabs_voice_id, sample_storage_url, status, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  // Voces cargadas (sample_storage_url presente): URL firmada para reproducir el
  // audio subido. Las clonadas no la traen (usan el preview de ElevenLabs).
  const withUrls = await Promise.all(
    (voices ?? []).map(async (v) => {
      let sampleUrl: string | null = null;
      if (v.sample_storage_url) {
        try {
          sampleUrl = await signedVoiceSampleUrl(v.sample_storage_url as string);
        } catch {
          sampleUrl = null;
        }
      }
      return { ...v, sampleUrl };
    }),
  );

  return <VoicesPage voices={withUrls} />;
}
