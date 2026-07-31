# Incidente: pedidos confirmados que nunca foram cobrados

## Sintoma

O financeiro fechou o mês e faltou dinheiro: existem pedidos com `status = confirmado`,
que o cliente vê como sucesso, para os quais nenhuma cobrança foi aprovada.

Como reproduzir:

```bash
cp .env.example .env
docker compose up -d
docker compose run -d --rm carga cenario-a     # menos de 1 minuto para se manifestar
```

Do lado de fora não há sinal nenhum: `POST /pedidos` responde `202`, `GET /pedidos/:id`
responde `200` com `status: "confirmado"`, e nenhuma rota devolve 5xx. Monitoramento de
caixa preta não enxerga o problema, e é exatamente por isso que o Grafana não mostrava
nada antes desta instrumentação.

## Evidência

### 1. O trace

`trace_id` real observado no Jaeger: **`7fe86883f325cd77c0fb26989cceeb5e`**

```
http://localhost:16686/trace/7fe86883f325cd77c0fb26989cceeb5e
```

21 spans, 2 serviços (`api` e `worker`) num único trace, depois da travessia da fila.
O span `pedido.processar` está marcado como erro e carrega, ao mesmo tempo:

```
otel.status_code        = ERROR
otel.status_description = gateway respondeu de forma inesperada
cobranca.resultado      = falha
pedido.status           = confirmado        <-- a contradição, num span só
pedido.id               = 662
pedido.valor_total      = 2416.39
```

O evento de exceção registrado no span:

```
event=exception
exception.type=Error
exception.message=gateway respondeu de forma inesperada
exception.stacktrace=Error: gateway respondeu de forma inesperada
    at processarPagamento (/app/src/worker/pagamento.ts:31:11)
```

Um único span diz que a cobrança falhou **e** que o pedido ficou confirmado. Essa é a
queixa inteira, num lugar só.

![Trace único atravessando a fila, com `pedido.processar` marcado como erro](jaeger-trace.png)

### 2. A query PromQL

Sinal que revela a queixa — a fração de cobranças que terminam em `falha`:

```promql
sum(rate(cobrancas_processadas_total{resultado="falha"}[1m]))
/
sum(rate(cobrancas_processadas_total[1m]))
```

Medido: `0` no cenário `normal`, `0,4337` (43,4%) no `cenario-a`.

E a query que mostra o rombo em unidade de negócio — pedidos confirmados que não têm
cobrança aprovada por trás:

```promql
(
  sum(rate(pedidos_confirmados_total[1m]))
  -
  sum(rate(cobrancas_processadas_total{resultado="aprovada"}[1m]))
) * 60
```

No `normal` essa diferença é 0: 410 confirmados para 410 aprovadas. No `cenario-a` ela
sobe para ~46 pedidos por minuto confirmados sem cobrança.

![Dashboard: à esquerda o período `normal`, à direita o `cenario-a`. A área vermelha do painel do dinheiro é o rombo](dashboard.png)

### 3. O comando de busca no log

Partindo do `trace_id` do Jaeger, as linhas dos dois processos:

```bash
docker compose logs api worker | grep 7fe86883f325cd77c0fb26989cceeb5e
```

```json
{"timestamp":"2026-07-31T16:02:52.127Z","level":"info","service":"api","msg":"pedido 662 criado para cli-0137","trace_id":"7fe86883f325cd77c0fb26989cceeb5e","span_id":"544d82365bc63798","pedido_id":662}
{"timestamp":"2026-07-31T16:02:52.127Z","level":"info","service":"worker","msg":"mensagem do pedido 662 recebida da fila","trace_id":"7fe86883f325cd77c0fb26989cceeb5e","span_id":"b06e14426f7a7f3f","pedido_id":662}
{"timestamp":"2026-07-31T16:02:52.172Z","level":"error","service":"worker","msg":"cobranca do pedido 662 falhou: gateway respondeu de forma inesperada","trace_id":"7fe86883f325cd77c0fb26989cceeb5e","span_id":"b06e14426f7a7f3f","pedido_id":662}
{"timestamp":"2026-07-31T16:02:52.175Z","level":"info","service":"worker","msg":"pedido 662 ficou confirmado","trace_id":"7fe86883f325cd77c0fb26989cceeb5e","span_id":"b06e14426f7a7f3f","pedido_id":662}
```

As duas últimas linhas estão a 3 milissegundos uma da outra: `cobranca ... falhou`
seguida de `pedido 662 ficou confirmado`. E o que a API devolve para o cliente:

```bash
curl -s localhost:8080/pedidos/662
{"id":662,"cliente_id":"cli-0137","status":"confirmado","valor_total":2416.39, ...}
```

Para achar todos os casos:

```bash
docker compose logs worker | grep '"level":"error"' | grep 'cobranca'
```

## Causa raiz

Arquivo: **`src/worker/index.ts`**.

- No repositório base (numeração original): **linha 53**, dentro do `catch` que começa na
  linha 52, combinada com a linha 47 e a linha 56.
- Neste repositório entregue, depois da instrumentação: **linha 90**, com a linha 74 e a
  linha 103.

O bloco original é:

```ts
let recusado = false;                                    // base: 47   entregue: 74

try {
  const resultado = await processarPagamento(clienteId, valorTotal);
  recusado = !resultado.aprovado;                        // base: 51   entregue: 78
} catch (erro) {
  registrarFalhaLegado(erro);                            // base: 53   entregue: 90
}

const status = recusado ? 'recusado' : 'confirmado';     // base: 56   entregue: 103
await atualizarStatusPedido(pedidoId, status);
```

O mecanismo, em três passos:

1. `recusado` é inicializado como `false`.
2. Quando `processarPagamento` lança — em `src/worker/pagamento.ts:31`, para clientes cujo
   `cliente_id` termina em `7` — o `catch` chama `registrarFalhaLegado(erro)` e **não
   toca em `recusado`**. A exceção morre ali: não é relançada, não vira log, não vira
   métrica, não muda o fluxo.
3. Como `recusado` continua `false`, o ternário escolhe `'confirmado'`. O pedido é
   gravado como confirmado sem que cobrança nenhuma tenha sido aprovada.

O `catch` trata **exceção** e **recusa** como se fossem a mesma coisa, e ainda escolhe o
desfecho otimista para as duas. Recusa legítima (`aprovado: false`, cliente terminado em
`3`) funciona corretamente e vira `recusado`; falha de infraestrutura vira `confirmado`.

O agravante de observabilidade é `registrarFalhaLegado`, em
`src/worker/registro-legado.ts:11`: ele empilha a ocorrência num array em memória,
limitado a 500 itens, que **nenhum código lê e nenhuma rota expõe**. A aplicação sabia da
falha o tempo todo — só não contava a ninguém, e o array ainda se apaga quando o
container reinicia. É literalmente a "resposta está no que o código sabe e hoje não conta
a ninguém" da pista do enunciado.

Por que não aparecia em nada antes:

| Sinal | Por que ficava mudo |
|---|---|
| Status HTTP | `POST /pedidos` responde `202` antes de a cobrança acontecer; o worker não tem borda HTTP |
| Latência | O caminho da exceção é mais **rápido** que o de sucesso, não mais lento |
| Log | O `catch` não escrevia linha nenhuma |
| Trace | Havia span de rota e de banco, nenhum span da cobrança |
| Métrica | Não existia métrica de negócio; só de infraestrutura, e a infraestrutura estava 100% saudável |

## Correção sugerida

**Não aplicada** — o defeito é o objeto de estudo deste desafio e corrigi-lo faria o
`cenario-a` parar de reproduzir a queixa.

O que eu faria, em ordem de prioridade:

1. **Não confirmar o que não foi cobrado.** Falha de cobrança não é aprovação. O desfecho
   da exceção precisa ser distinto dos outros dois — um status `falha_na_cobranca` (ou
   manter `pendente` para nova tentativa), nunca `confirmado`:

   ```ts
   let desfecho: 'aprovada' | 'recusada' | 'falha' = 'falha';

   try {
     const resultado = await processarPagamento(clienteId, valorTotal);
     desfecho = resultado.aprovado ? 'aprovada' : 'recusada';
   } catch (erro) {
     registrarFalhaLegado(erro);
     desfecho = 'falha';
   }

   const status =
     desfecho === 'aprovada' ? 'confirmado' :
     desfecho === 'recusada' ? 'recusado' :
     'falha_na_cobranca';
   ```

   Isso muda o contrato de `GET /pedidos/:id`, então precisa combinar com quem consome.

2. **Repetir a tentativa antes de desistir.** `gateway respondeu de forma inesperada` é
   erro transitório por natureza. Reenfileirar com backoff e um limite de tentativas, e
   só depois marcar o desfecho terminal.

3. **Fila de mortos.** O que estourar o limite de tentativas vai para uma dead letter
   queue com o `trace_id` junto, para o financeiro conseguir cruzar caso a caso.

4. **Aposentar o `registro-legado`.** Um buffer em memória que ninguém lê é pior que
   nenhum registro, porque dá a impressão de que a falha está sendo tratada. Ele já foi
   substituído nesta entrega por log de nível `error`, exceção no span e a métrica
   `cobrancas_processadas_total{resultado="falha"}`.

5. **Conciliação periódica.** Uma checagem que compare `pedidos_confirmados_total` com
   `cobrancas_processadas_total{resultado="aprovada"}` na janela do dia. As duas séries
   devem andar coladas; qualquer distância persistente é dinheiro faltando, mesmo que
   nenhuma exceção esteja sendo lançada.
