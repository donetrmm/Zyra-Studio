import type { Metadata } from 'next';
import { GuideView } from '@/components/guide/GuideView';

export const metadata: Metadata = {
  title: 'Guía',
};

export default function GuidePage() {
  return <GuideView />;
}
