import client from 'prom-client';

export const registro = new client.Registry();

client.collectDefaultMetrics({ register: registro });

export const TIPO_DE_CONTEUDO = registro.contentType;

/**
 * Metricas de negocio (requisito 3).
 *
 * Nenhuma delas leva identificador de pedido ou de cliente como label: em
 * metrica o identificador cria uma serie por valor. O caso individual se acha
 * pelo span e pela linha de log, que e onde o identificador custa barato.
 */

export const pedidosCriados = new client.Counter({
  name: 'pedidos_criados_total',
  help: 'Total de pedidos aceitos pela api e publicados na fila',
  registers: [registro],
});

export const pedidosConfirmados = new client.Counter({
  name: 'pedidos_confirmados_total',
  help: 'Total de pedidos que o worker marcou como confirmados',
  registers: [registro],
});

export const RESULTADOS_DE_COBRANCA = ['aprovada', 'recusada', 'falha'] as const;

export type ResultadoDeCobranca = (typeof RESULTADOS_DE_COBRANCA)[number];

export const cobrancasProcessadas = new client.Counter({
  name: 'cobrancas_processadas_total',
  help: 'Total de tentativas de cobranca por desfecho',
  labelNames: ['resultado'],
  registers: [registro],
});

/**
 * Serie que so nasce no primeiro evento some do grafico enquanto esta tudo bem
 * e quebra o alerta que dependia dela. Por isso os tres contadores — e cada
 * valor do label `resultado` — nascem em zero na subida do processo.
 */
export function inicializarMetricasDeNegocio(): void {
  pedidosCriados.inc(0);
  pedidosConfirmados.inc(0);

  for (const resultado of RESULTADOS_DE_COBRANCA) {
    cobrancasProcessadas.labels(resultado).inc(0);
  }
}

inicializarMetricasDeNegocio();

export function coletar(): Promise<string> {
  return registro.metrics();
}
