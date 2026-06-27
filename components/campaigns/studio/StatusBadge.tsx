import { Loader2 } from 'lucide-react';
import { STATUS_LABEL } from './types';

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? STATUS_LABEL.planned;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs ${s.tone}`}>
      {s.live && <Loader2 className="size-2.5 animate-spin" aria-hidden />}
      {s.label}
    </span>
  );
}
