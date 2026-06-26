// Motivos legibles del fallo del matcher (Gemini) cuando el plan cae al mix
// genérico. Compartido entre el wizard de campaña nueva y el diálogo de
// "Reprocesar idea" del Studio, para no degradar en silencio y explicar por qué.
export const MATCHER_ERROR_HINTS: Record<string, string> = {
  rate_limit: 'Gemini alcanzó su límite de peticiones, intenta en un minuto',
  auth: 'la API key de Gemini no es válida en este entorno',
  server: 'Gemini respondió con error',
  unknown: 'la respuesta de Gemini no se pudo interpretar',
  sin_match: 'Gemini no logró mapear tus ideas al catálogo',
};
