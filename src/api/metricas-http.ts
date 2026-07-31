import type { NextFunction, Request, Response } from 'express';
import client from 'prom-client';
import { registro } from '../telemetria/metricas';

const duracaoDasRequisicoes = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duracao das requisicoes HTTP em segundos',
  labelNames: ['route', 'method', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registro],
});

/**
 * Correcao de cardinalidade (requisito 3).
 *
 * `requisicao.path` e o caminho concreto: `/produtos/42`, `/pedidos/1071`. Cada
 * identificador que entra pela URL viraria um valor novo do label `route` e,
 * com ele, uma serie de time series nova por bucket do histograma — sem limite
 * superior, porque o conjunto de ids cresce com o uso.
 *
 * O que identifica a rota e o template registrado no Express, que e um conjunto
 * fechado: `requisicao.route.path` devolve `/produtos/:id`. O `baseUrl` entra
 * junto para o caso de o Router ser montado com prefixo. Requisicao que nao
 * casa com nenhuma rota nao tem `route`, e cai num valor fixo em vez de
 * carregar o caminho que o cliente inventou.
 */
function rotaDaRequisicao(requisicao: Request): string {
  const template = requisicao.route?.path;

  if (typeof template !== 'string') {
    return 'sem_rota';
  }

  const caminho = `${requisicao.baseUrl ?? ''}${template}`;

  return caminho === '' ? '/' : caminho;
}

export function medirRequisicoes(
  requisicao: Request,
  resposta: Response,
  proximo: NextFunction
): void {
  const encerrarMedicao = duracaoDasRequisicoes.startTimer();

  resposta.on('finish', () => {
    encerrarMedicao({
      route: rotaDaRequisicao(requisicao),
      method: requisicao.method,
      status: String(resposta.statusCode),
    });
  });

  proximo();
}
