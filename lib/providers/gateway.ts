import 'server-only';
import { APICallError, generateText, type ModelMessage } from 'ai';
import { ProviderError } from './types';

// Partes en el shape nativo de Gemini que los módulos ya construyen. Mantener
// este shape hace que la migración de cada módulo sea solo cambiar el fetch.
export type GatewayPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

export type GatewayContent = {
  role?: 'user' | 'model';
  parts: GatewayPart[];
};

export type GatewayTextInput = {
  /** Slug interno del modelo (ej. 'gemini-2.5-flash'); NO el slug de gateway. */
  model: string;
  /** Etiqueta del módulo para mensajes de error (ej. 'ingest', 'matcher'). */
  label: string;
  system?: string;
  contents: GatewayContent[];
  temperature: number;
  maxOutputTokens: number;
  /** true = salida JSON: se limpian fences markdown si el modelo los agrega. */
  json: boolean;
  thinkingBudget?: number;
};

export type GatewayTextResult = {
  text: string;
  /** finishReason normalizado del AI SDK ('stop'|'length'|'content-filter'|...). */
  finishReason: string;
};

export function toGatewayModel(slug: string): string {
  return `google/${slug}`;
}

// El gateway no garantiza responseMimeType:'application/json' como la API
// nativa; el fence-strip central protege a los módulos que hacen JSON.parse
// directo. Idempotente con el extractJson local de ingest/matcher/clarify.
export function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

function toMessages(contents: GatewayContent[]): ModelMessage[] {
  return contents.map((c) => ({
    role: c.role === 'model' ? ('assistant' as const) : ('user' as const),
    content: c.parts.map((p) =>
      'text' in p
        ? { type: 'text' as const, text: p.text }
        : {
            type: 'file' as const,
            mediaType: p.inline_data.mime_type,
            data: p.inline_data.data,
          },
    ),
  })) as ModelMessage[];
}

function translateError(err: unknown, label: string): ProviderError {
  if (err instanceof ProviderError) return err;
  if (APICallError.isInstance(err)) {
    const status = err.statusCode ?? 0;
    if (status === 429) return new ProviderError('Rate limit Gemini', 'rate_limit', true);
    if (status === 401 || status === 403) {
      return new ProviderError('Auth inválida con AI Gateway', 'auth', false);
    }
    return new ProviderError(
      `Gemini ${label} ${status}: ${err.message.slice(0, 200)}`,
      'server',
      status >= 500,
    );
  }
  return new ProviderError(
    `Gemini ${label}: ${err instanceof Error ? err.message : 'error desconocido'}`,
    'unknown',
    false,
  );
}

export async function gatewayText(input: GatewayTextInput): Promise<GatewayTextResult> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new ProviderError('AI_GATEWAY_API_KEY no configurada', 'auth', false);
  }
  const thinkingBudget = input.thinkingBudget ?? 0;
  try {
    const result = await generateText({
      model: toGatewayModel(input.model),
      ...(input.system ? { system: input.system } : {}),
      messages: toMessages(input.contents),
      temperature: input.temperature,
      maxOutputTokens: input.maxOutputTokens,
      // thinkingConfig viaja por passthrough del gateway. Se manda bajo ambos
      // namespaces (google = AI Studio, vertex = Vertex) porque el routing del
      // gateway decide el provider; cada uno lee solo su clave.
      providerOptions: {
        google: { thinkingConfig: { thinkingBudget } },
        vertex: { thinkingConfig: { thinkingBudget } },
      },
    });
    const text = input.json ? stripFences(result.text) : result.text;
    return { text, finishReason: result.finishReason };
  } catch (err) {
    throw translateError(err, input.label);
  }
}
