type BrandKit = {
  name: string;
  colors: { name: string; hex: string }[];
  fonts: string[];
  tone_description: string | null;
  style_guidelines: string | null;
};

export function applyBrandKit(
  prompt: string,
  kit: BrandKit,
  type: 'image' | 'video' | 'audio',
): string {
  const trimmed = prompt.trimEnd().replace(/[.\s]+$/, '');
  const parts: string[] = [trimmed];

  if (type === 'audio') {
    if (kit.tone_description) {
      parts.unshift(`[Tone: ${kit.tone_description}]`);
    }
    return parts.join('\n\n');
  }

  if (kit.colors.length > 0) {
    const palette = kit.colors.map((c) => `${c.name} (${c.hex})`).join(', ');
    parts.push(`Color palette: ${palette}`);
  }
  if (kit.fonts.length > 0) {
    parts.push(`Typography: ${kit.fonts.join(', ')}`);
  }
  if (kit.style_guidelines) {
    parts.push(`Style: ${kit.style_guidelines}`);
  }

  return parts.join('. ');
}
