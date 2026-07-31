# Loja de Pedidos

Aplicação de exemplo com uma API HTTP de catálogo e pedidos, e um worker que processa
os pedidos de forma assíncrona.

O fluxo é simples: a API grava o pedido com status `pendente` e publica uma mensagem
em uma lista do Redis. O worker consome essa lista, chama um processador de pagamento
simulado e atualiza o status do pedido para `confirmado` ou `recusado`.

## Stack

- TypeScript em Node 20, executado com `tsx` (não há etapa de build)
- Express, `pg` e `ioredis`
- Postgres 16 e Redis 7
- Tudo orquestrado por Docker Compose

## Como subir

```bash
docker compose up -d
```

Na primeira subida o serviço `seed` cria o esquema e carrega o banco com 200 produtos e
um histórico de 12.000 pedidos dos últimos 30 dias. O seed é idempotente: se o banco já
estiver carregado, ele não faz nada. A `api` e o `worker` só iniciam depois que o seed
termina.

Para derrubar tudo e apagar os dados:

```bash
docker compose down -v
```

## Rotas da API

Base: `http://localhost:8080`

| Método | Rota                  | Resposta                                                                 |
| ------ | --------------------- | ------------------------------------------------------------------------ |
| GET    | `/health`             | `200` com `{status}`                                                     |
| GET    | `/produtos`           | `200` com a lista de produtos                                            |
| GET    | `/produtos/:id`       | `200` com o produto, ou `404`                                            |
| POST   | `/pedidos`            | `202` com `{pedido_id, status}`                                          |
| GET    | `/pedidos/:id`        | `200` com o pedido e seus itens, ou `404`                                |
| GET    | `/relatorios/vendas`  | `200` com o consolidado de vendas dos últimos 30 dias, agregado por produto |

O worker expõe apenas `GET /health` em `http://localhost:8081`.

### Exemplo de criação de pedido

```bash
curl -X POST localhost:8080/pedidos \
  -H 'content-type: application/json' \
  -d '{"cliente_id":"cli-0001","itens":[{"produto_id":1,"quantidade":2}]}'
```

O `cliente_id` é uma string livre no formato `cli-0001`. Não existe cadastro de clientes.

## Modelo de dados

- `produtos` — `id`, `nome`, `preco`
- `pedidos` — `id`, `cliente_id`, `status`, `valor_total`, `criado_em`
- `pedido_itens` — `id`, `pedido_id`, `produto_id`, `quantidade`, `preco_unitario`

Status possíveis de um pedido: `pendente`, `confirmado` e `recusado`.

## Gerador de carga

O serviço `carga` envia tráfego contra a API. Ele recebe o nome do cenário como
argumento, imprime um resumo periódico no stdout e roda até você apertar `Ctrl+C`.

```bash
docker compose run --rm carga normal
docker compose run --rm carga cenario-a
docker compose run --rm carga cenario-b
```

- `normal` — tráfego de catálogo e criação de pedidos, em torno de 5 requisições por segundo
- `cenario-a` — o tráfego do `normal` mais uma consulta ao relatório de vendas a cada 2 segundos
- `cenario-b` — o tráfego do `normal` com outra distribuição de clientes

O gerador não sobe junto com o `docker compose up -d`; ele só roda sob demanda com
`docker compose run`.

## Portas

| Serviço            | Porta         |
| ------------------ | ------------- |
| `api`              | 8080          |
| `worker`           | 8081          |
| `postgres`         | 5432          |
| `redis`            | 6379          |
| `prometheus`       | 9090          |
| `grafana`          | 3000          |
| `jaeger`           | 16686         |
| `jaeger` (OTLP)    | 4317 e 4318   |
| `alertmanager`     | 9093          |
| `receptor-alertas` | 9099          |

O Grafana sobe com usuário `admin` e senha `admin`.

## Estrutura do repositório

```
src/api/            servidor Express e rotas
src/worker/         consumidor da fila e processador de pagamento
src/db/             pool, migração e consultas SQL
src/fila/           publicação e consumo no Redis
seed/               carga inicial do banco
carga/              gerador de carga
receptor-alertas/   servidor que registra webhooks recebidos
prometheus/         configuração do Prometheus
alertmanager/       configuração do Alertmanager
grafana/            provisionamento do Grafana
```
