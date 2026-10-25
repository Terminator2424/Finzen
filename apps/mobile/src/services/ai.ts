import * as SecureStore from 'expo-secure-store';
import {
  aiSystemPrompt, buildAiContext, buildUserTurn, monthKey, type AiDebt, type AiSnapshot, type ChatMessage,
} from '@finzen/core';
import { cardSummary, listDebts, listPlansOf } from './debts';
import { getNetWorth, getSetting, setSetting } from './repo';
import { listBudgetLines, monthTotals, spendingByCategory } from './transactions';

/**
 * Asistente de IA. Dos proveedores, ambos opcionales:
 *  - Gemini (API gratuita de Google AI Studio): funciona desde el celular en cualquier parte.
 *  - Ollama: IA local en tu PC (necesita la PC encendida y en la misma red). El único uso de la PC.
 * A cualquiera de los dos solo se le envían totales anonimizados (ver @finzen/core/ai.ts).
 * La clave de Gemini vive en SecureStore (Keystore de Android), nunca en el repo ni en la nube.
 */
export type AiProvider = 'gemini' | 'ollama';
export interface AiConfig {
  provider: AiProvider;
  geminiModel: string; // '' = elegir automáticamente
  ollamaUrl: string;
  ollamaModel: string;
}

const GEMINI_KEY = 'finzen_gemini_key';

export async function getAiConfig(): Promise<AiConfig> {
  const [provider, geminiModel, ollamaUrl, ollamaModel] = await Promise.all(
    ['ai_provider', 'ai_gemini_model', 'ai_ollama_url', 'ai_ollama_model'].map(getSetting),
  );
  return {
    provider: provider === 'ollama' ? 'ollama' : 'gemini',
    geminiModel: geminiModel ?? '',
    ollamaUrl: ollamaUrl ?? '',
    ollamaModel: ollamaModel ?? 'llama3.2',
  };
}

/**
 * Ollama solo por HTTPS: el tráfico HTTP en claro está bloqueado en toda la app (así nadie en tu WiFi
 * puede leer lo que se envía). Para tu PC usa un túnel/proxy con HTTPS (p. ej. Tailscale Serve o Caddy).
 */
function assertSafeOllamaUrl(url: string) {
  if (url && !/^https:\/\/[^\s/]+/i.test(url)) {
    throw new Error('Por seguridad la dirección de Ollama debe empezar por https:// (el tráfico sin cifrar está bloqueado).');
  }
}

export async function saveAiConfig(c: AiConfig): Promise<void> {
  assertSafeOllamaUrl(c.ollamaUrl.trim());
  await setSetting('ai_provider', c.provider, 'device');
  await setSetting('ai_gemini_model', c.geminiModel.trim(), 'device');
  await setSetting('ai_ollama_url', c.ollamaUrl.trim().replace(/\/+$/, ''), 'device');
  await setSetting('ai_ollama_model', c.ollamaModel.trim() || 'llama3.2', 'device');
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

/** Elige el modelo "flash" más reciente disponible para la clave (los nombres cambian con el tiempo). */
export async function discoverGeminiModel(key: string): Promise<string> {
  const res = await timedFetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', { headers: { 'x-goog-api-key': key } }, 20_000);
  if (!res.ok) throw new Error(await geminiError(res));
  const data = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
  const candidates = (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /^gemini-[\d.]+-flash$/.test(n)) // estable, sin lite/preview/exp/imagen
    .sort((a, b) => parseFloat(b.split('-')[1]!) - parseFloat(a.split('-')[1]!));
  if (!candidates[0]) throw new Error('No encontré un modelo Gemini Flash disponible para tu clave.');
  return candidates[0];
}

async function geminiError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } };
    return `Gemini respondió ${res.status}: ${j.error?.message ?? 'error'}`;
  } catch { return `Gemini respondió ${res.status}`; }
}

async function askGemini(cfg: AiConfig, history: ChatMessage[], turn: string): Promise<string> {
  const key = await getGeminiKey();
  if (!key) throw new Error('Falta la clave de Gemini (Asistente → ⚙).');
  let model = cfg.geminiModel;
  if (!model) {
    model = await discoverGeminiModel(key);
    await setSetting('ai_gemini_model', model, 'device');
  }
  const contents = [
    ...history.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
    { role: 'user', parts: [{ text: turn }] },
  ];
  const res = await timedFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: aiSystemPrompt() }] }, contents, generationConfig: { temperature: 0.4 } }),
  });
  if (!res.ok) throw new Error(await geminiError(res));
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
  if (!text) throw new Error('La IA no devolvió respuesta (puede haber sido bloqueada). Reformula la pregunta.');
  return text;
}

async function askOllama(cfg: AiConfig, history: ChatMessage[], turn: string): Promise<string> {
  if (!cfg.ollamaUrl) throw new Error('Falta la dirección de Ollama (Asistente → ⚙).');
  const res = await timedFetch(`${cfg.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.ollamaModel, stream: false,
      messages: [{ role: 'system', content: aiSystemPrompt() }, ...history, { role: 'user', content: turn }],
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
