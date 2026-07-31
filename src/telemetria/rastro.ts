import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { NOME_DO_SERVICO } from './servico';

/**
 * Tracer proprio da aplicacao, usado para os spans de negocio. Os spans de rota
 * e de banco continuam vindo da auto instrumentacao.
 */
export const tracer = trace.getTracer(NOME_DO_SERVICO);

/**
 * Registra uma excecao capturada no span ativo e marca o span como erro
 * (requisito 2). Nao relanca: o fluxo da aplicacao continua exatamente o mesmo,
 * a instrumentacao so passa a contar o que acontece.
 */
export function registrarExcecaoNoSpan(span: Span | undefined, erro: unknown): string {
  const motivo = erro instanceof Error ? erro.message : String(erro);

  if (span) {
    span.recordException(erro instanceof Error ? erro : new Error(motivo));
    span.setStatus({ code: SpanStatusCode.ERROR, message: motivo });
  }

  return motivo;
}
