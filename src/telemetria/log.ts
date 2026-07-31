import { trace } from '@opentelemetry/api';
import { NOME_DO_SERVICO } from './servico';

type Nivel = 'info' | 'warn' | 'error';

/**
 * Campos extras de correlacao que a linha de log pode carregar.
 * `pedido_id` e o identificador de negocio exigido pelo requisito 1.
 */
export type CamposExtras = {
  pedido_id?: number | string;
  [chave: string]: unknown;
};

/**
 * Le o span ativo no momento em que a linha e escrita. Sao os mesmos
 * identificadores que aparecem no Jaeger, nao um id proprio da aplicacao.
 * Quando nao ha span ativo (subida do processo, por exemplo) os campos saem
 * como string vazia, para que toda linha tenha o mesmo formato.
 */
function identificadoresDoTrace(): { trace_id: string; span_id: string } {
  const contexto = trace.getActiveSpan()?.spanContext();

  return {
    trace_id: contexto?.traceId ?? '',
    span_id: contexto?.spanId ?? '',
  };
}

function escrever(level: Nivel, msg: string, extras?: CamposExtras): void {
  const linha = {
    timestamp: new Date().toISOString(),
    level,
    service: NOME_DO_SERVICO,
    msg,
    ...identificadoresDoTrace(),
    ...extras,
  };

  process.stdout.write(JSON.stringify(linha) + '\n');
}

export const log = {
  info(msg: string, extras?: CamposExtras): void {
    escrever('info', msg, extras);
  },
  warn(msg: string, extras?: CamposExtras): void {
    escrever('warn', msg, extras);
  },
  error(msg: string, extras?: CamposExtras): void {
    escrever('error', msg, extras);
  },
};
