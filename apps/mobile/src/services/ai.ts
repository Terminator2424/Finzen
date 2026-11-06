import * as SecureStore from 'expo-secure-store';
import {
  aiSystemPrompt, buildAiContext, buildUserTurn, monthKey, type AiDebt, type AiSnapshot, type ChatMessage,
} from '@finzen/core';
import { cardSummary, listDebts, listPlansOf } from './debts';
import { getNetWorth, getSetting, setSetting } from './repo';
import { listBudgetLines, monthTotals, spendingByCategory } from './transactions';

/**
 * Asistente de IA. Dos proveedores, ambos opcionales:
 *  - Gemini (API gratuita de Google AI Studio).
 *  - Ollama: IA local en tu PC.
 * A cualquiera de los dos solo se le envían totales anonimizados (ver @finzen/core/ai.ts).
 * La clave de Gemini vive en SecureStore (Keystore de Android), nunca en el repo ni en la nube.
 *
 * Modelo de Gemini: hay DOS valores distintos.
 *  - ai_gemini_model: el que el usuario FIJÓ a mano. Vacío = automático. La app nunca lo rellena sola.
 *  - ai_gemini_cache: el último que funcionó en automático (solo se muestra, se revalida si falla).
 */
export type AiProvider = 'gemini' | 'ollama';
export interface AiConfig {
  provider: AiProvider;
  geminiModel: string;
  geminiCache?: string;
  ollamaUrl: string;
  ollamaModel: string;
}

const GEMINI_KEY = 'finzen_gemini_key';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const FORMAT_RULES =
  '\n\nFormato de la respuesta: texto plano para un chat en el celular. No uses asteriscos, almohadillas (#), tablas ni código. ' +
  'Párrafos de máximo 3 frases. Si necesitas una lista, usa líneas que empiecen con "- " o con "1.", "2.". ' +
  'Responde en menos de 120 palabras, salvo que te pidan más detalle. Escribe los montos como $1.250.000.';
const systemPrompt = () => aiSystemPrompt() + FORMAT_RULES;

/** Quita espacios, caracteres invisibles y el prefijo "models/" que se cuelan al copiar y pegar. */
export function cleanModelName(s: string): string {
  return s.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, '').replace(/^models\//i, '');
}

export async function getAiConfig(): Promise<AiConfig> {
  const [provider, geminiModel, ollamaUrl, ollamaModel, geminiCache] = await Promise.all(
    ['ai_provider', 'ai_gemini_model', 'ai_ollama_url', 'ai_ollama_model', 'ai_gemini_cache'].map(getSetting),
  );
  return {
    provider: provider === 'ollama' ? 'ollama' : 'gemini',
    geminiModel: geminiModel ?? '',
    geminiCache: geminiCache ?? '',
    ollamaUrl: ollamaUrl ?? '',
    ollamaModel: ollamaModel ?? 'llama3.2',
  };
}

function assertSafeOllamaUrl(url: string) {
  if (url && !/^https:\/\/[^\s/]+/i.test(url)) {
    throw new Error('Por seguridad la dirección de Ollama debe empezar por https:// (el tráfico sin cifrar está bloqueado).');
  }
}

export async function saveAiConfig(c: AiConfig): Promise<void> {
  assertSafeOllamaUrl(c.ollamaUrl.trim());
  await setSetting('ai_provider', c.provider, 'device');
  await setSetting('ai_gemini_model', cleanModelName(c.geminiModel), 'device');
  await setSetting('ai_ollama_url', c.ollamaUrl.trim().replace(/\/+$/, ''), 'device');
  await setSetting('ai_ollama_model', c.ollamaModel.trim() || 'llama3.2', 'device');
}

/** Vuelve al modo automático: borra el modelo fijado y el recordado. */
export async function resetGeminiModel(): Promise<void> {
  await setSetting('ai_gemini_model', '', 'device');
  await setSetting('ai_gemini_cache', '', 'device');
}

export const clearGeminiKey = () => SecureStore.deleteItemAsync(GEMINI_KEY);
export const getGeminiKey = () => SecureStore.getItemAsync(GEMINI_KEY);
export const saveGeminiKey = (k: string) => (k.trim() ? SecureStore.setItemAsync(GEMINI_KEY, k.trim()) : SecureStore.deleteItemAsync(GEMINI_KEY));

export async function isAiConfigured(): Promise<boolean> {
  const c = await getAiConfig();
  return c.provider === 'ollama' ? c.ollamaUrl !== '' : !!(await getGeminiKey());
}

/** Foto de la situación financiera SIN nombres (solo tipos de deuda y totales). */
export async function buildSnapshot(): Promise<AiSnapshot> {
  const month = monthKey();
  const nw = await getNetWorth();
  const t = await monthTotals(month);
  const debts: AiDebt[] = [];
  for (const d of await listDebts()) {
    if (d.kind === 'credit_card') {
      const s = await cardSummary(d);
      debts.push({ kind: 'credit_card', balance: d.balance, monthlyRatePct: d.monthly_rate * 100, monthlyPayment: null, utilizationPct: s.utilization * 100 });
      for (const p of await listPlansOf(d.id)) {
        if (p.status === 'active') debts.push({ kind: 'bnpl', balance: p.balance, monthlyRatePct: p.monthly_rate * 100, monthlyPayment: p.monthly_payment });
      }
    } else {
      debts.push({ kind: d.kind, balance: d.balance, monthlyRatePct: d.monthly_rate * 100, monthlyPayment: d.monthly_payment });
    }
  }
  return {
    month, assets: nw.assets, liabilities: nw.liabilities, income: t.income, expense: t.expense, debtPayments: t.debtPayments,
    byCategory: (await spendingByCategory(month)).map((c) => ({ name: c.name, total: c.total })),
    budgets: (await listBudgetLines(month)).map((b) => ({ name: b.name, amount: b.amount, spent: b.spent })),
    debts,
  };
}

async function timedFetch(url: string, init: RequestInit, ms = 60_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('La IA tardó demasiado en responder.');
    throw new Error('No se pudo conectar. Revisa tu internet (o que la PC con Ollama esté encendida y en la misma red).');
  }
  finally { clearTimeout(timer); }
}

// ───────────── Gemini ─────────────
export class GeminiError extends Error {
  status: number;
  googleStatus: string;
  reason: string;
  detail: string;
  constructor(status: number, googleStatus: string, reason: string, detail: string) {
    super(friendlyGeminiMessage(status, googleStatus, reason, detail));
    this.name = 'GeminiError';
    this.status = status;
    this.googleStatus = googleStatus;
    this.reason = reason;
    this.detail = detail;
  }
}

function friendlyGeminiMessage(status: number, googleStatus: string, reason: string, detail: string): string {
  const tech = `(HTTP ${status}${googleStatus ? ` ${googleStatus}` : ''}${reason ? ` · ${reason}` : ''})`;
  if (reason === 'ACCESS_TOKEN_TYPE_UNSUPPORTED') {
    return `Google rechazó el tipo de clave ${tech}. Algunas cuentas reportan este error con las claves nuevas que empiezan por "AQ.". Crea la clave en otro proyecto o con otra cuenta de Google en aistudio.google.com/apikey, o usa Ollama.`;
  }
  if (status === 400 && /api key/i.test(detail)) {
    return `Google dice que la clave de API no es válida ${tech}. Copia de nuevo la clave completa desde aistudio.google.com/apikey. Las claves antiguas "AIza" sin restricciones dejaron de funcionar el 19 de junio de 2026, y las estándar dejan de funcionar en septiembre de 2026.`;
  }
  if (status === 401) return `Google rechazó la clave de API ${tech}. Crea una clave nueva en aistudio.google.com/apikey y pégala en ⚙ Configurar IA.`;
  if (status === 403) return `Google no permite usar esta clave o este modelo con Gemini ${tech}. Revisa que la clave sea de Gemini (AI Studio) y que no esté restringida a otro servicio.`;
  if (status === 404) return `El modelo configurado no existe para tu clave ${tech}. FinZen prueba con otro solo.`;
  if (status === 429) return `Llegaste al límite gratuito de uso de Gemini ${tech}. Espera un minuto (o hasta mañana si es el límite diario).`;
  if (status >= 500) return `Gemini está saturado o con fallas ${tech}. Es temporal: intenta de nuevo en unos segundos.`;
  return `Gemini respondió ${status}: ${detail || 'error'} ${tech}`;
}

async function parseGeminiError(res: Response): Promise<GeminiError> {
  let googleStatus = '';
  let reason = '';
  let detail = '';
  try {
    const j = (await res.json()) as { error?: { message?: string; status?: string; details?: { reason?: string }[] } };
    googleStatus = j.error?.status ?? '';
    detail = j.error?.message ?? '';
    reason = j.error?.details?.find((d) => d.reason)?.reason ?? '';
  } catch { /* la respuesta no trae JSON */ }
  return new GeminiError(res.status, googleStatus, reason, detail);
}

async function geminiFetch(path: string, key: string, init: RequestInit, ms = 60_000): Promise<Response> {
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': key };
  const res = await timedFetch(`${GEMINI_BASE}${path}`, { ...init, headers }, ms);
  if (!res.ok) throw await parseGeminiError(res);
  return res;
}

const TRANSIENT = [500, 502, 503, 504];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      if (!(e instanceof GeminiError) || !TRANSIENT.includes(e.status)) throw e;
      if (i < tries - 1) await sleep(1000 * 2 ** i + Math.random() * 400);
    }
  }
  throw last;
}

/** Fallos de la CLAVE (no del modelo): probar otro modelo no sirve de nada. */
function isKeyProblem(e: GeminiError): boolean {
  return e.status === 401 || e.reason === 'ACCESS_TOKEN_TYPE_UNSUPPORTED' || e.reason === 'API_KEY_INVALID'
    || (e.status === 400 && /api key/i.test(e.detail))
    || (e.status === 403 && /unregistered callers|api key|identity/i.test(e.detail));
}
/** El modelo en sí no sirve para esta clave (retirado, mal escrito, no disponible): conviene soltarlo. */
const isHard = (s: number | null) => s === 400 || s === 403 || s === 404;

function modelVersion(name: string): [number, number] {
  const m = /^gemini-(\d+)(?:\.(\d+))?-/.exec(name);
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : [0, 0];
}
const newestFirst = (a: string, b: string) => {
  const [a1, a2] = modelVersion(a);
  const [b1, b2] = modelVersion(b);
  return b1 - a1 || b2 - a2;
};

/** Modelos disponibles para la clave: Flash del más nuevo al más viejo, luego Flash-Lite y los alias "-latest". */
export async function geminiCandidates(key: string): Promise<string[]> {
  const res = await withRetry(() => geminiFetch('/models?pageSize=200', key, { method: 'GET' }, 20_000));
  const data = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
  const names = (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
  const flash = names.filter((n) => /^gemini-[\d.]+-flash$/.test(n)).sort(newestFirst);
  const lite = names.filter((n) => /^gemini-[\d.]+-flash-lite$/.test(n)).sort(newestFirst);
  const aliases = names.filter((n) => n === 'gemini-flash-latest' || n === 'gemini-flash-lite-latest');
  return [...flash, ...lite, ...aliases];
}

export async function discoverGeminiModel(key: string): Promise<string> {
  const c = await geminiCandidates(key);
  if (!c[0]) throw new Error('No encontré un modelo Gemini Flash disponible para tu clave.');
  return c[0];
}

interface Run<T> { value: T; model: string; from: string | null; fromStatus: number | null; reason: string | null }

/**
 * Prueba primero el modelo fijado (o el último que funcionó) y, si falla por algo que no es la clave,
 * recorre los modelos disponibles. Devuelve cuál funcionó y por qué se descartó el primero.
 */
async function withModelFallback<T>(
  key: string, pinned: string, cached: string, op: (model: string, tries: number) => Promise<T>,
): Promise<Run<T>> {
  const first = pinned || cached;
  let firstErr: GeminiError | null = null;
  if (first) {
    try { return { value: await op(first, 3), model: first, from: null, fromStatus: null, reason: null }; }
    catch (e) {
      if (!(e instanceof GeminiError) || isKeyProblem(e)) throw e;
      firstErr = e;
    }
  }
  const candidates = (await geminiCandidates(key)).filter((m) => m !== first);
  let lastErr: unknown = firstErr;
  for (const m of candidates.slice(0, 3)) {
    try {
      const value = await op(m, 1);
      return {
        value, model: m, from: first || null, fromStatus: firstErr?.status ?? null,
        reason: firstErr ? `HTTP ${firstErr.status}${firstErr.googleStatus ? ` ${firstErr.googleStatus}` : ''}` : null,
      };
    } catch (e) {
      lastErr = e;
      if (!(e instanceof GeminiError) || isKeyProblem(e)) throw e;
    }
  }
  throw lastErr ?? new Error('No encontré un modelo Gemini Flash disponible para tu clave.');
}

async function pingGemini(key: string, model: string, tries: number): Promise<void> {
  await withRetry(() => geminiFetch(`/models/${encodeURIComponent(model)}:generateContent`, key, {
    method: 'POST',
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Responde solo: ok' }] }], generationConfig: { maxOutputTokens: 8 } }),
  }, 30_000), tries);
}

export interface GeminiTest {
  model: string;
  ms: number;
  /** Modelo que se intentó primero y falló (null si funcionó a la primera). */
  from: string | null;
  reason: string | null;
  /** El modelo fijado no sirve para esta clave: el campo vuelve a automático. */
  pinnedCleared: boolean;
}

/** Prueba REAL de la clave y del modelo. Solo deja guardado lo que la prueba validó. */
export async function testGeminiConnection(key: string, pinnedRaw: string): Promise<GeminiTest> {
  const t0 = Date.now();
  const pinned = cleanModelName(pinnedRaw);
  const cached = (await getSetting('ai_gemini_cache')) ?? '';
  const run = await withModelFallback(key, pinned, cached, (m, tries) => pingGemini(key, m, tries));
  await setSetting('ai_gemini_cache', run.model, 'device');
  const pinnedCleared = !!pinned && run.from === pinned && isHard(run.fromStatus);
  return { model: run.model, ms: Date.now() - t0, from: run.from, reason: run.reason, pinnedCleared };
}

async function generateGemini(key: string, model: string, history: ChatMessage[], turn: string, tries: number): Promise<string> {
  const contents = [
    ...history.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
    { role: 'user', parts: [{ text: turn }] },
  ];
  const res = await withRetry(() => geminiFetch(`/models/${encodeURIComponent(model)}:generateContent`, key, {
    method: 'POST',
    body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt() }] }, contents, generationConfig: { temperature: 0.4 } }),
  }), tries);
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
  if (!text) throw new Error('La IA no devolvió respuesta (puede haber sido bloqueada). Reformula la pregunta.');
  return text;
}

async function askGemini(cfg: AiConfig, history: ChatMessage[], turn: string): Promise<string> {
  const key = await getGeminiKey();
  if (!key) throw new Error('Falta la clave de Gemini (Asistente → ⚙).');
  const pinned = cleanModelName(cfg.geminiModel);
  const run = await withModelFallback(key, pinned, cfg.geminiCache ?? '', (m, tries) => generateGemini(key, m, history, turn, tries));
  await setSetting('ai_gemini_cache', run.model, 'device');
  if (pinned && run.from === pinned && isHard(run.fromStatus)) await setSetting('ai_gemini_model', '', 'device');
  return run.value;
}

// ───────────── Ollama ─────────────
async function askOllama(cfg: AiConfig, history: ChatMessage[], turn: string): Promise<string> {
  if (!cfg.ollamaUrl) throw new Error('Falta la dirección de Ollama (Asistente → ⚙).');
  const res = await timedFetch(`${cfg.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.ollamaModel, stream: false,
      messages: [{ role: 'system', content: systemPrompt() }, ...history, { role: 'user', content: turn }],
    }),
  }, 120_000);
  if (!res.ok) throw new Error(`Ollama respondió ${res.status}. ¿Descargaste el modelo "${cfg.ollamaModel}"? (ollama pull ${cfg.ollamaModel})`);
  const j = (await res.json()) as { message?: { content?: string } };
  const text = j.message?.content?.trim();
  if (!text) throw new Error('Ollama no devolvió respuesta.');
  return text;
}

/** Responde una pregunta con el contexto financiero anonimizado + los últimos mensajes del chat. */
export async function askAssistant(question: string, history: ChatMessage[]): Promise<string> {
  const cfg = await getAiConfig();
  const turn = buildUserTurn(buildAiContext(await buildSnapshot()), question);
  const recent = history.slice(-6);
  return cfg.provider === 'ollama' ? askOllama(cfg, recent, turn) : askGemini(cfg, recent, turn);
}