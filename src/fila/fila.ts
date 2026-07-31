import { ROOT_CONTEXT, context, propagation } from '@opentelemetry/api';
import type { Context } from '@opentelemetry/api';
import Redis from 'ioredis';

export const NOME_DA_FILA = 'pedidos';

/**
 * Chave que carrega o W3C Trace Context junto da mensagem (requisito 2).
 * Fila nao propaga contexto sozinha: o contexto e dado, e dado viaja no payload.
 */
export const CHAVE_DE_RASTRO = 'rastro';

export type MensagemPedido = {
  pedido_id: number;
  cliente_id: string;
  valor_total: number;
  /** Portador do trace context (`traceparent`/`tracestate`). */
  [CHAVE_DE_RASTRO]?: Record<string, string>;
};

const url = process.env.REDIS_URL ?? 'redis://localhost:6379';

export function criarConexaoRedis(): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export async function publicarPedido(
  redis: Redis,
  mensagem: MensagemPedido
): Promise<void> {
  const portador: Record<string, string> = {};
  propagation.inject(context.active(), portador);

  const comRastro: MensagemPedido = { ...mensagem, [CHAVE_DE_RASTRO]: portador };

  await redis.lpush(NOME_DA_FILA, JSON.stringify(comRastro));
}

export async function consumirPedido(
  redis: Redis,
  segundosDeEspera = 5
): Promise<Record<string, unknown> | null> {
  const resposta = await redis.brpop(NOME_DA_FILA, segundosDeEspera);

  if (!resposta) {
    return null;
  }

  return JSON.parse(resposta[1]) as Record<string, unknown>;
}

/**
 * Reconstroi o contexto de trace que veio na mensagem.
 *
 * A extracao parte de `ROOT_CONTEXT`, e nao do contexto ativo do worker: o loop
 * de consumo roda dentro do span do `brpop` da auto instrumentacao, e usar esse
 * contexto como base faria o span do pedido nascer pendurado no span da leitura
 * da fila, no trace do worker, em vez de no trace do pedido.
 */
export function contextoDaMensagem(mensagem: Record<string, unknown>): Context {
  const portador = mensagem[CHAVE_DE_RASTRO];

  if (!portador || typeof portador !== 'object') {
    return ROOT_CONTEXT;
  }

  return propagation.extract(ROOT_CONTEXT, portador as Record<string, string>);
}
