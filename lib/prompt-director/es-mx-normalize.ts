// Normalizador de texto hablado es-MX (PD-01). Expande tokens que el modelo de
// video MASCA al leerlos en voz: monedas ($499), ratios (2x1), 24/7, unidades
// (3km) y abreviaturas (Dr.). Un numero crudo en el dialogo sale entrecortado o
// robotico; expandirlo a palabras lo arregla.
//
// CLAVE: solo se aplica al DIALOGO (texto entrecomillado), nunca a la accion
// visual completa — sobre toda la accion corromperia marcadores legitimos del
// prompt (9:16, 480p, 3-7s:, @imageN). Pipeline del diccionario de pronunciacion:
//   normalizeSpokenInDialogue (numeros/simbolos) -> applyRespellings (tonica).
//
// Determinista, sin dependencias (Vercel Hobby): el conversor numero->palabras
// es-MX se escribe a mano. Genero MASCULINO por defecto (pesos, centavos,
// kilometros, gramos... todos masculinos); apocope del "uno" final ante sustantivo.

const UNITS_0_29 = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete',
  'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés',
  'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve',
];

const TENS: Record<number, string> = {
  3: 'treinta', 4: 'cuarenta', 5: 'cincuenta', 6: 'sesenta',
  7: 'setenta', 8: 'ochenta', 9: 'noventa',
};

const HUNDREDS: Record<number, string> = {
  1: 'ciento', 2: 'doscientos', 3: 'trescientos', 4: 'cuatrocientos', 5: 'quinientos',
  6: 'seiscientos', 7: 'setecientos', 8: 'ochocientos', 9: 'novecientos',
};

// Apocope del "uno" final ante sustantivo masculino: "uno" -> "un",
// "veintiuno" -> "veintiún", "treinta y uno" -> "treinta y un".
function apocopate(word: string): string {
  if (word === 'uno') return 'un';
  if (word.endsWith('veintiuno')) return word.replace(/veintiuno$/, 'veintiún');
  if (word.endsWith('uno')) return word.replace(/uno$/, 'un');
  return word;
}

// Convierte 0..999 a palabras (sin apocope). 0 devuelve '' (lo maneja el caller).
function under1000(n: number): string {
  if (n === 0) return '';
  if (n < 30) return UNITS_0_29[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    return u === 0 ? TENS[t] : `${TENS[t]} y ${UNITS_0_29[u]}`;
  }
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h === 1 && r === 0) return 'cien';
  const head = HUNDREDS[h];
  return r === 0 ? head : `${head} ${under1000(r)}`;
}

// Numero entero -> palabras es-MX. apocope=true apocopa el "uno" FINAL (ante
// sustantivo masculino, p.ej. "veintiún pesos"). El multiplicador de "mil"
// siempre apocopa ("veintiún mil"); "mil" no lleva "uno" ("mil", no "un mil").
export function numberToWordsEsMx(n: number, opts: { apocope?: boolean } = {}): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  const value = Math.floor(n);
  if (value === 0) return 'cero';

  const millions = Math.floor(value / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1000);
  const rest = value % 1000;

  const parts: string[] = [];
  if (millions > 0) {
    parts.push(millions === 1 ? 'un millón' : `${apocopate(under1000(millions))} millones`);
  }
  if (thousands > 0) {
    parts.push(thousands === 1 ? 'mil' : `${apocopate(under1000(thousands))} mil`);
  }
  if (rest > 0) {
    const restWords = under1000(rest);
    parts.push(opts.apocope ? apocopate(restWords) : restWords);
  }
  return parts.join(' ');
}

// --- Expansion de tokens ---------------------------------------------------

const UNIT_WORDS: Record<string, [string, string]> = {
  // token -> [singular, plural]
  km: ['kilómetro', 'kilómetros'],
  cm: ['centímetro', 'centímetros'],
  mm: ['milímetro', 'milímetros'],
  m: ['metro', 'metros'],
  kg: ['kilo', 'kilos'],
  mg: ['miligramo', 'miligramos'],
  g: ['gramo', 'gramos'],
  ml: ['mililitro', 'mililitros'],
  l: ['litro', 'litros'],
};

const ABBREVIATIONS: Record<string, string> = {
  Srta: 'señorita',
  Sra: 'señora',
  Sr: 'señor',
  Dra: 'doctora',
  Dr: 'doctor',
};

function moneyToWords(intPart: string, centsPart?: string): string {
  const pesos = parseInt(intPart.replace(/,/g, ''), 10);
  const cents = centsPart ? parseInt(centsPart.padEnd(2, '0').slice(0, 2), 10) : 0;
  const segments: string[] = [];
  if (pesos > 0) {
    segments.push(`${numberToWordsEsMx(pesos, { apocope: true })} ${pesos === 1 ? 'peso' : 'pesos'}`);
  }
  if (cents > 0) {
    const centWords = `${numberToWordsEsMx(cents, { apocope: true })} ${cents === 1 ? 'centavo' : 'centavos'}`;
    segments.push(segments.length ? `con ${centWords}` : centWords);
  }
  // $0.00 (caso degenerado): "cero pesos".
  if (segments.length === 0) return 'cero pesos';
  return segments.join(' ');
}

// Expande tokens hablados es-MX. Pensado para correr sobre el DIALOGO, no sobre
// el prompt completo (ver normalizeSpokenInDialogue). El orden importa: moneda
// primero (consume el numero tras "$") para que no lo re-toquen unidades/ratios.
export function normalizeSpokenEsMx(text: string): string {
  let out = text ?? '';

  // Moneda: $499, $1,299, $9.99. La parte decimal son centavos.
  out = out.replace(/\$\s?(\d[\d,]*)(?:\.(\d{1,2}))?/g, (_m, int: string, cents?: string) =>
    moneyToWords(int, cents),
  );

  // Porcentaje: 50% -> "cincuenta por ciento".
  out = out.replace(/(\d+)\s?%/g, (_m, n: string) => `${numberToWordsEsMx(parseInt(n, 10), { apocope: true })} por ciento`);

  // 24/7 -> "veinticuatro siete" (caso fijo; evita tocar fracciones/fechas).
  out = out.replace(/\b24\s?\/\s?7\b/g, 'veinticuatro siete');

  // Ratio NxM: 2x1 -> "dos por uno". Ambos lados sin apocope ("por uno").
  out = out.replace(/\b(\d+)\s?[xX]\s?(\d+)\b/g, (_m, a: string, b: string) =>
    `${numberToWordsEsMx(parseInt(a, 10))} por ${numberToWordsEsMx(parseInt(b, 10))}`,
  );

  // Unidades: 3km -> "tres kilómetros". Alternancia ordenada (km/cm/mm/kg/mg/ml
  // antes que m/g/l) para no partir "km" en "m". Word boundary al final para no
  // matchear dentro de palabras (p.ej. "litros").
  out = out.replace(/\b(\d+)\s?(km|cm|mm|kg|mg|ml|m|g|l|L)\b/g, (_m, n: string, unit: string) => {
    const [singular, plural] = UNIT_WORDS[unit === 'L' ? 'l' : unit];
    const num = parseInt(n, 10);
    return `${numberToWordsEsMx(num, { apocope: true })} ${num === 1 ? singular : plural}`;
  });

  // Abreviaturas de tratamiento: Dr. -> "doctor". Alternancia longest-first.
  out = out.replace(/\b(Srta|Sra|Sr|Dra|Dr)\./g, (_m, abbr: string) => ABBREVIATIONS[abbr]);

  return out;
}

// Aplica normalizeSpokenEsMx SOLO al contenido entre comillas (el dialogo del
// scene_prompt), dejando intacta la accion visual y los marcadores del prompt.
// Soporta comillas rectas y curvas; normaliza TODOS los segmentos (timelines
// multi-beat con una linea por tramo).
export function normalizeSpokenInDialogue(text: string): string {
  const s = text ?? '';
  return s.replace(/(["“])([^"“”]{2,})(["”])/g, (_m, open: string, body: string, close: string) =>
    `${open}${normalizeSpokenEsMx(body)}${close}`,
  );
}
