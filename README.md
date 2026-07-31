# Loja de pedidos — instrumentação completa

API de pedidos em TypeScript com worker de processamento assíncrono, instrumentada com
OpenTelemetry (tracing), `prom-client` (métricas) e log estruturado em JSON correlacionado
ao trace. Stack de observabilidade local: Prometheus, Grafana, Jaeger e Alertmanager.

O relatório do incidente investigado está em [`reports/incidente.md`](reports/incidente.md).

## Como rodar

Pré-requisitos: Docker e Docker Compose v2. Nada mais precisa estar instalado na máquina.

```bash
git clone <url-do-fork>
cd <pasta-do-fork>
cp .env.example .env
docker compose up -d
```

Espere os serviços ficarem saudáveis (~30s) e confira:

```bash
curl -s localhost:8080/health          # {"status":"ok"}
curl -s localhost:8081/health          # {"status":"ok"}
```

Endereços:

| Serviço | URL |
|---|---|
| API | http://localhost:8080 |
| Worker (só `/health` e `/metrics`) | http://localhost:8081 |
| Prometheus | http://localhost:9090 |
| Grafana (`admin` / `admin`) | http://localhost:3000 |
| Jaeger | http://localhost:16686 |
| Alertmanager | http://localhost:9093 |
| Receptor de alertas | http://localhost:9099 |

O dashboard **Pedidos e Cobranças** já sobe provisionado, sem nenhum clique de
configuração, e a regra `FalhaEmCobrancas` já aparece em http://localhost:9090/rules.

Um pedido de ponta a ponta:

```bash
curl -s localhost:8080/produtos | head -c 200
curl -s -X POST localhost:8080/pedidos \
  -H 'content-type: application/json' \
  -d '{"cliente_id":"cli-0001","itens":[{"produto_id":1,"quantidade":2}]}'
```

Geradores de carga:

```bash
docker compose run -d --rm carga normal       # tráfego saudável
docker compose run -d --rm carga cenario-a    # reproduz a queixa do financeiro
docker ps --filter name=carga -q | xargs -r docker rm -f   # parar
```

Achar as linhas de log de um trace, nos dois processos:

```bash
docker compose logs api worker | grep <trace_id>
```

## Equivalências com o curso

O curso ensinou observabilidade em Java com Actuator, Micrometer e o bridge do
OpenTelemetry. Abaixo, o que foi usado de fato neste repositório em TypeScript.

| Pilar | No curso (Java) | Aqui (TypeScript/Node) |
|---|---|---|
| Métricas | Micrometer (`MeterRegistry`, `Counter`, `Timer`) com Spring Boot Actuator expondo `/actuator/prometheus` | [`prom-client`](https://github.com/siimon/prom-client) 15.1.3: `client.Registry`, `client.Counter` e `client.Histogram` em `src/telemetria/metricas.ts` e `src/api/metricas-http.ts`, expostos por uma rota `/metrics` escrita à mão em `src/api/rotas.ts` e em `src/worker/index.ts` |
| Tracing | OpenTelemetry Java Agent / Spring Boot starter, `@WithSpan` e `Tracer` do bridge do Micrometer | `@opentelemetry/sdk-node` (`NodeSDK`) carregado por `--require ./src/telemetria/otel.ts`, com `getNodeAutoInstrumentations()` para HTTP/Express/pg/ioredis, e spans manuais via `trace.getTracer(...).startActiveSpan()` em `src/telemetria/rastro.ts` |
| Logs estruturados | Logback/Log4j2 com encoder JSON e MDC, populado pelo `LoggingEventListener` do OpenTelemetry (`%mdc{trace_id}`) | Logger próprio em `src/telemetria/log.ts` escrevendo JSON no stdout; no lugar do MDC, `trace.getActiveSpan()?.spanContext()` lê `traceId`/`spanId` do contexto ativo a cada linha |
| Propagação de contexto | `W3CTraceContextPropagator`, injeção/extração automática em `RestTemplate`, Feign e `@KafkaListener` | Mesma especificação W3C Trace Context, mas manual, porque Redis list não tem cabeçalho: `propagation.inject(context.active(), portador)` na publicação e `propagation.extract(ROOT_CONTEXT, portador)` no consumo, em `src/fila/fila.ts` |

## Decisões e limiares

### O erro de cardinalidade

O histograma `http_request_duration_seconds` usava `requisicao.path` como valor do label
`route`, ou seja, o caminho concreto da URL: `/produtos/42`, `/pedidos/1071`.

**Por que isso derrubaria um Prometheus em produção:** o conjunto de ids cresce sem limite
com o uso, cada id novo cria um valor novo de label e, portanto, uma time series nova para
*cada um dos 12 buckets* do histograma mais `_sum` e `_count` — a série nunca é
reaproveitada, o índice invertido e o head block do Prometheus crescem sem teto, e o
processo morre por consumo de memória semanas depois de o código ter ido para produção,
sem nenhum sinal em teste.

Não é teoria: medido nesta stack, com **2 minutos** do gerador de carga `normal`:

| | valores distintos de `route` | séries de `http_request_duration_seconds*` |
|---|---|---|
| Antes | 151 | 1963 |
| Depois | 6 | 78 |

A correção, em `src/api/metricas-http.ts`, troca o caminho concreto pelo template
registrado no Express (`requisicao.baseUrl + requisicao.route?.path`), que é um conjunto
fechado e conhecido na subida: `/health`, `/metrics`, `/produtos`, `/produtos/:id`,
`/pedidos`, `/pedidos/:id`. Requisição que não casa com rota nenhuma cai no valor fixo
`sem_rota`, para que um cliente não consiga inflar o label inventando caminhos.

Identificador de pedido e de cliente continuam presentes **em span e em log**, onde custam
barato e são o que permite achar o caso individual. O que não podem é virar label de
métrica.

### O que cada métrica de negócio responde

| Métrica | Tipo | Pergunta que responde |
|---|---|---|
| `pedidos_criados_total` | contador | Quanta demanda entrou? É o topo do funil, contado na `api` no momento em que o pedido é aceito e publicado na fila |
| `pedidos_confirmados_total` | contador | Quantos pedidos o cliente viu como sucesso? Contado no `worker`, é o número que o cliente e o time de produto enxergam |
| `cobrancas_processadas_total{resultado}` | contador com label | O dinheiro entrou? `aprovada` é receita real, `recusada` é o gateway dizendo não (comportamento legítimo e esperado), `falha` é exceção na cobrança. Somar recusa e falha na mesma série é o caminho mais curto para não achar a queixa: a primeira é normal, a segunda é dinheiro sumindo |

A pergunta do incidente sai da comparação entre a segunda e a terceira: quando
`pedidos_confirmados_total` cresce mais rápido que
`cobrancas_processadas_total{resultado="aprovada"}`, a diferença é pedido confirmado sem
cobrança.

Os três contadores — e os três valores do label `resultado` — são inicializados em zero na
subida do processo (`inicializarMetricasDeNegocio()` em `src/telemetria/metricas.ts`).
Série que só nasce no primeiro evento não aparece no gráfico enquanto está tudo bem, e o
alerta que dependia dela avalia contra vazio em vez de contra zero.

### O alerta `FalhaEmCobrancas`

Arquivo: `prometheus/regras/cobrancas.yml`. A regra é avaliada sobre a proporção de
cobranças que terminam em falha, e não sobre erro HTTP, porque a queixa **não** aparece na
borda: a `api` responde `202` e o pedido chega a `confirmado` mesmo quando a cobrança
lança exceção.

```promql
sum(rate(cobrancas_processadas_total{resultado="falha"}[1m]))
/
sum(rate(cobrancas_processadas_total[1m]))
> 0.02
```

| | Valor |
|---|---|
| Valor observado no cenário `normal` | **0,00%** — 0 falhas em 445 cobranças ao longo de 3 minutos |
| Valor observado no `cenario-a` | **14%** acumulado no primeiro minuto, chegando a **43%** de taxa instantânea |
| Limiar escolhido | **2%** |
| `for` | **45s** |

Por que razão e não valor absoluto: a proporção não depende do volume de tráfego, então o
mesmo limiar continua valendo se a loja dobrar de tamanho ou se a carga cair de
madrugada. Quando não há tráfego nenhum, o denominador é zero, a expressão não retorna
resultado e o alerta não dispara — que é o comportamento desejado.

Por que 2%: é folgado o suficiente para não reagir a uma falha isolada num período de
baixo volume, e uma ordem de grandeza abaixo do que o `cenario-a` produz. O `normal`
mediu zero, então qualquer limiar positivo silenciaria; 2% dá margem sem deixar de gritar.

`for: 45s` cumpre o limite de 30s a 1m do desafio. Com `evaluation_interval` de 15s e
`group_wait: 10s` no Alertmanager, o caminho completo até o webhook foi medido em
**72 segundos** entre subir o `cenario-a` e a linha aparecer no `receptor-alertas`:

```
2026-07-31T16:02:32.246Z alerta=FalhaEmCobrancas status=firing
```

Comportamento verificado nos dois sentidos: 3 minutos de cenário `normal` após
`docker compose restart receptor-alertas` não produziram alerta nenhum.

### Outras decisões

- **`rule_files` no `prometheus.yml`.** O `compose.yaml` monta `./prometheus/regras` em
  `/etc/prometheus/regras`, mas o `prometheus.yml` base não declarava `rule_files`, então
  nenhuma regra daquele diretório era carregada. Foram acrescentadas as duas linhas que
  apontam para `/etc/prometheus/regras/*.yml`.
- **Campos de trace sempre presentes no log.** Linhas escritas fora de qualquer span (a
  subida do processo, por exemplo) saem com `trace_id` e `span_id` como string vazia, em
  vez de omitirem os campos, para que toda linha tenha o mesmo formato e possa ser
  processada sem tratamento especial.
- **Contexto de trace na mensagem.** O portador W3C viaja na chave `rastro` do JSON
  publicado no Redis. A extração parte de `ROOT_CONTEXT`, e não do contexto ativo do
  worker: o loop de consumo roda dentro do span do `brpop` da auto instrumentação, e usar
  esse contexto como base penduraria o span do pedido no trace do worker em vez de no
  trace do pedido.
- **Métricas de negócio em módulo compartilhado.** Os dois processos expõem os três
  contadores; cada um incrementa os que lhe dizem respeito. Consultas usam `sum(...)`
  para agregar os dois jobs.
- **O defeito da aplicação não foi corrigido**, conforme exigido. Veja
  [`reports/incidente.md`](reports/incidente.md).

## Estrutura

```
.
├── src/
│   ├── api/          servidor, rotas e middleware de métricas HTTP
│   ├── worker/       consumo da fila, pagamento simulado
│   ├── db/           pool, migração e consultas
│   ├── fila/         publicação/consumo no Redis + propagação de contexto
│   └── telemetria/   bootstrap do OTel, logger, métricas e tracer da aplicação
├── carga/            gerador de carga (não alterado)
├── receptor-alertas/ webhook de destino do Alertmanager (não alterado)
├── prometheus/
│   ├── prometheus.yml
│   └── regras/cobrancas.yml
├── alertmanager/
├── grafana/provisioning/
│   ├── datasources/
│   └── dashboards/pedidos-e-cobrancas.json
└── reports/
    ├── incidente.md
    ├── dashboard.png
    └── jaeger-trace.png
```
