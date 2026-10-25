/**
 * Asistente de IA: construcción del contexto ANONIMIZADO y del prompt.
 *
 * Qué se envía a la IA: totales y porcentajes. Qué NO se envía nunca: nombres de cuentas,
 * nombres de bancos o tarjetas, comercios, números de cuenta/tarjeta, notas ni fechas exactas.
 * Las deudas se envían como "Tarjeta de crédito A", "Compra a cuotas B", etc.
 */

export interface AiDebt {
  kind: 'credit_card' | 'loan' | 'bnpl' | 'informal';
  balance: number;
  /** Tasa mensual en % (p. ej. 2.1). */
  monthlyRatePct: number;
  monthlyPayment: number | null;
  /** Para tarjetas: % del cupo usado. */
  utilizationPct?: number;
}

export interface AiSnapshot {
  month: string;
  assets: number;
  liabilities: number;
  income: number;
  expense: number;
  debtPayments: number;
  byCategory: { name: string; total: number }[];
  budgets: { name: string; amount: number; spent: number }[];
  debts: AiDebt[];
}

const KIND_LABEL: Record<AiDebt['kind'], string> = {
  credit_card: 'Tarjeta de crédito', loan: 'Crédito', bnpl: 'Compra a cuotas', informal: 'Deuda informal',
};

const cop = (n: number) => `$${Math.round(n).toLocaleString('en-US').replace(/,/g, '.')}`;

/** Texto con la situación del usuario, sin ningún dato identificable. */
export function buildAiContext(s: AiSnapshot): string {
  const counters: Record<string, number> = {};
  const letter = (kind: string) => String.fromCharCode(65 + (counters[kind] = (counters[kind] ?? -1) + 1));

  const lines = [
    `Mes analizado: ${s.month} (moneda: pesos colombianos, COP)`,
    `Patrimonio neto: ${cop(s.assets - s.liabilities)} (activos ${cop(s.assets)}, pasivos ${cop(s.liabilities)})`,
    `Ingresos del mes: ${cop(s.income)} | Gastos del mes: ${cop(s.expense)} | Pagos a deudas: ${cop(s.debtPayments)}`,
    'Gastos por categoría: ' + (s.byCategory.length ? s.byCategory.map((c) => `${c.name} ${cop(c.total)}`).join('; ') : 'sin datos'),
    'Presupuestos: ' +
      (s.budgets.length
        ? s.budgets.map((b) => `${b.name} ${cop(b.spent)} de ${cop(b.amount)} (${b.amount ? Math.round((b.spent / b.amount) * 100) : 0} %)`).join('; ')
        : 'ninguno'),
    'Deudas:',
    ...(s.debts.length
      ? s.debts.map((d) => {
          const parts = [`saldo ${cop(d.balance)}`, `interés ${d.monthlyRatePct.toFixed(2)} % mensual`];
          if (d.monthlyPayment) parts.push(`cuota ${cop(d.monthlyPayment)}`);
          if (d.utilizationPct !== undefined) parts.push(`cupo usado ${Math.round(d.utilizationPct)} %`);
          return `- ${KIND_LABEL[d.kind]} ${letter(d.kind)}: ${parts.join(', ')}`;
        })
      : ['- ninguna']),
  ];
  return lines.join('\n');
}

export function aiSystemPrompt(): string {
  return [
    'Eres el asistente financiero personal de la app FinZen. Hablas en español colombiano, claro y breve.',
    'Responde SOLO con base en los datos que se te dan; si falta información, dilo en vez de inventarla.',
    'Cuando hagas cuentas, muestra la operación. Los montos están en pesos colombianos (COP).',
    'Das orientación general de finanzas personales (presupuesto, deudas, ahorro). No eres un asesor de inversión licenciado: no recomiendes comprar o vender activos concretos.',
    'Si te preguntan qué deuda pagar primero, explica el método avalancha (mayor interés primero) y el de bola de nieve (menor saldo primero).',
  ].join(' ');
}

export interface ChatMessage { role: 'user' | 'assistant'; content: string }

/** Prompt de la pregunta actual: datos + historial corto. */
export function buildUserTurn(context: string, question: string): string {
  return `DATOS DEL USUARIO (anonimizados):\n${context}\n\nPREGUNTA: ${question}`;
}
