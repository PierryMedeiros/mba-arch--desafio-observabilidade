# Diário de execução — Desafio de Observabilidade

Registro escrito durante o trabalho, na ordem em que as coisas aconteceram.
Formato: `[HH:MM]` marca o relógio de parede real de cada anotação.

---

## [12:43] Setup

Clonei `https://github.com/PierryMedeiros/mba-arch--desafio-observabilidade` numa pasta
nova (`aluno-run/`) e criei a branch `resolucao` antes de tocar em qualquer arquivo.

Ambiente: Docker 28.0.2, Compose v2.34.0, Node v23.10.0 no host, 8 vCPU, 7.8 GB RAM,
WSL2 (Linux 5.15).

Primeira leitura do README inteiro: ~12 minutos. Densidade alta, mas a estrutura é clara.
Anotações da primeira leitura, antes de rodar qualquer coisa:

1. **Linha 34 — "Repositório base: https://github.com/devfullcycle/REPO-A-DEFINIR".**
   Placeholder não substituído. Um aluno que segue o README ao pé da letra não sabe de
   onde clonar. Primeiro item para o FEEDBACK.
2. **Linha 36 — "Faça o fork e trabalhe nele. A entrega final fica na branch `main`".**
   Conflita com a instrução de trabalhar em `resolucao` que recebi. Vou seguir a
   instrução do exercício (branch `resolucao`) e registrar a divergência.
3. O README fala em "reports/incidente.md" e "grafana/provisioning/dashboards" como
   pastas que eu preencho. Preciso confirmar se existem ou se eu crio.
4. Requisito 5 pede regra `FalhaEmCobrancas` sobre "o sinal que de fato revela a queixa",
   e diz explicitamente que não é erro HTTP. Isso já estreita muito o espaço de busca —
   marcar para o bloco "a investigação foi investigação de verdade?".

---

## [12:44–12:46] Etapa 1 — subir e explorar (~12 min)

`cp .env.example .env && docker compose up -d`. **Subiu de primeira, sem nenhum ajuste.**
Build + subida em ~90s. Os 9 servicos saudaveis, `api` e `worker` `healthy`,
`/health` respondendo nos dois.

Confirmei item por item a secao "O que ja esta instrumentado":

- Tracing automatico: OK — um `POST /pedidos` virou um trace com 15 spans (rota,
  `pg.query`, `lpush`). Confere.
- Log JSON com `timestamp/level/service/msg` e sem nada de trace: confere.
- `/metrics` com `http_request_duration_seconds`: confere.
- Prometheus com os dois alvos `up`: confere.
- Grafana com datasources e pasta de dashboards vazia: confere — na verdade a pasta tem
  `dashboards.yml` (o provider), o que e melhor do que "vazia". So falta o JSON.
- Alertmanager -> receptor: confere. `prometheus/regras/` so com `.gitkeep`.

**A secao bate com a realidade.** Nao perdi tempo descobrindo o que existia: o README
descreve o starter com precisao. Unico desencontro: o texto diz "A pasta de dashboards
esta vazia" e ela nao esta, tem o `dashboards.yml` ja configurado. A favor do aluno.

### O erro de cardinalidade caiu no colo (~2 min, sem ler codigo)

Ainda na exploracao, bati em `/produtos/1`, `/produtos/2`, `/produtos/42` e olhei
`/metrics`:

```
http_request_duration_seconds_count{route="/produtos/1",...} 1
http_request_duration_seconds_count{route="/produtos/42",...} 1
http_request_duration_seconds_count{route="/pedidos/25",...} 1
```

Achei pela saida de `/metrics`, no passo 1, antes de escrever qualquer linha. Mas seria
desonesto dizer que "investiguei": o README anuncia que o erro existe (linha 79), diz que
e de cardinalidade (requisito 3), e o criterio de aceite entrega o exemplo literal
(`/produtos/:id` esta correto, `/produtos/42` reprova). Eu sabia o que procurar antes de
procurar. Anotado para o FEEDBACK.

## [12:46] Etapa 2 — correlacao log<->trace

Li `src/telemetria/log.ts`, `metricas.ts`, `otel.ts`, `src/api/*`, `src/fila/fila.ts`.
Codigo pequeno e limpo; ~10 min para entender o conjunto todo.

**Decisao que o enunciado deixou em aberto (arbitrei):** o `log` de hoje e
`log.info(msg: string)`. Para cumprir "linhas relacionadas a um pedido carregam tambem
`pedido_id`" eu precisava de um segundo parametro de campos extras. Alterar a assinatura
do logger e instrumentacao, nao mudanca funcional — mas o enunciado nao diz nada sobre
poder mexer na forma do logger. Segui em frente.

**Segunda arbitragem, essa mais seria.** O criterio de aceite e
`docker compose logs api | grep '"msg"' | tail -1 | jq .` devolvendo `trace_id`. Nem toda
linha nasce dentro de um span: `"api ouvindo na porta 8080"` roda na subida, fora de
qualquer trace. Se o avaliador rodar o comando numa stack recem-subida sem trafego, o
`tail -1` pega justamente essa linha e o criterio reprova uma entrega correta. Optei por
**sempre emitir os campos**, com string vazia quando nao ha span ativo, para o criterio
ser deterministico. E um criterio verificavel por sorte — vai para o FEEDBACK.

## [12:52] Abrindo o worker pela primeira vez

Nota antes de abrir: ate aqui **nao li nada de `src/worker/`**. Vou abrir
`src/worker/index.ts` porque o requisito 1 exige `pedido_id` nas linhas de log dos *dois*
processos — ou seja, a leitura e forcada pelo requisito de log, antes ainda do span
manual do requisito 2. Registro o que acontecer.

### [12:53] O defeito me atropelou. Cinco segundos.

Abri `src/worker/index.ts`. Sao 100 linhas. O `processarMensagem` inteiro cabe numa tela,
e o defeito esta nele, linhas 47-59:

```ts
let recusado = false;

try {
  const resultado = await processarPagamento(clienteId, valorTotal);
  recusado = !resultado.aprovado;
} catch (erro) {
  registrarFalhaLegado(erro);          // engole a excecao, nao mexe em `recusado`
}

const status = recusado ? 'recusado' : 'confirmado';   // excecao -> 'confirmado'
await atualizarStatusPedido(pedidoId, status);
```

`recusado` comeca `false`. Se `processarPagamento` lanca, o `catch` engole, `recusado`
continua `false`, e o ternario da linha 56 grava **`confirmado`**. Pedido confirmado que
nunca foi cobrado. E exatamente a queixa do financeiro, legivel em tres linhas.

**Nao houve investigacao.** Nao cheguei nele pela telemetria — cheguei nele por ser
obrigado a abrir o arquivo pelo requisito 1 (`pedido_id` na linha de log do worker), que
o proprio README manda fazer primeiro (passo 2 da ordem de execucao). O `catch` nao
resistiu a uma passada de olho: ele nao resistiu nem a meia passada. `let recusado = false`
seguido de `catch` vazio e um dos padroes de bug mais reconheciveis que existem, e o
ternario logo abaixo fecha o raciocinio sozinho.

Isto e o achado numero 1 do FEEDBACK. Tudo que eu fizer daqui pra frente na "investigacao"
sera encenacao: vou construir a telemetria que *provaria* a causa, sabendo a resposta.

Registro tambem que **nao vou corrigir**. O ternario fica como esta.

## [12:55–13:05] Etapa 3 — spans manuais e travessia da fila (~10 min de codigo)

Implementado:

- `src/telemetria/rastro.ts` (novo): tracer da aplicacao + helper que grava excecao no
  span e poe o status em `ERROR`.
- `src/fila/fila.ts`: `propagation.inject(context.active(), portador)` na publicacao,
  guardando o portador na chave `rastro` da mensagem; `contextoDaMensagem()` extraindo
  com `propagation.extract(ROOT_CONTEXT, portador)`.
- `pedido.criar` envolvendo o handler do `POST /pedidos` (precisa envolver a publicacao,
  senao o `inject` captura o span errado).
- `pedido.processar` com `startActiveSpan(nome, opcoes, contextoExtraido, fn)` e
  `SpanKind.CONSUMER`.

**Funcionou na primeira tentativa.** Trace `60ee4dd7bfe766953b6e7dc8d888d6b8`: 20 spans,
`api` e `worker` no mesmo trace, com `pedido.criar` e `pedido.processar` dentro.

E funcionou de primeira **por causa da dica do passo 3**. O enunciado nao so avisa que
existe a armadilha, ele descreve a armadilha, o sintoma dela ("dois traces curtos em vez
de um completo") e a solucao ("usar o contexto ativo do worker em vez de um contexto raiz
e o erro"). Eu escrevi `ROOT_CONTEXT` porque o README mandou, nao porque entendi o
problema. Nunca vi os dois traces curtos. Ponto para o FEEDBACK: **a dica entrega demais.**

Consulta externa: procurei a assinatura de `startActiveSpan` com contexto explicito
(sao 4 overloads e a ordem `nome, opcoes, contexto, fn` nao e obvia). ~5 min.

**Efeito colateral que confirma o desenho:** as mensagens que ja estavam na fila antes do
rebuild nao tinham a chave `rastro`, e vieram como traces soltos de 3 spans so do worker.
Ou seja: eu *vi* o sintoma de "dois traces separados", mas por acidente de migracao, nao
por ter errado a extracao.

## [13:05] Etapa 4 — metricas

Cardinalidade: troquei `requisicao.path` (caminho concreto) por
`requisicao.baseUrl + requisicao.route?.path` (template do Express), com `sem_rota` para
requisicao que nao casa com rota nenhuma. Detalhe que exigiu atencao: `req.route` so
existe depois do roteamento, e a medicao acontece no evento `finish`, entao esta
disponivel. Nao precisou de pesquisa.

Metricas de negocio no `src/telemetria/metricas.ts`, inicializadas em zero na carga do
modulo. Como o modulo e compartilhado, os dois processos expoem os tres contadores; o
`api` fica com `cobrancas_processadas_total` sempre em zero e o `worker` com
`pedidos_criados_total` sempre em zero. O criterio pede as saidas "somadas", entao passa.
Fica a duvida se o avaliador esperava metricas separadas por processo — o enunciado nao
diz. Arbitrei pelo modulo compartilhado.

**Fricao real, e nao ensina nada de observabilidade:** o `Dockerfile` faz `COPY src ./src`
e o `compose.yaml` nao monta volume de codigo. Toda alteracao de uma linha em TypeScript
exige `docker compose up -d --build api worker`. Sao ~15s por ciclo aqui, com cache
quente. Para um aluno iterando span por span, isso vira dezenas de rebuilds.

## [13:12] Etapa 5 — alerta. Aqui travei, e nao foi por observabilidade.

Escrevi `prometheus/regras/cobrancas.yml`, reiniciei o Prometheus, abri `/rules`: **vazio**.

Antes de desconfiar da minha regra, fui olhar o `prometheus.yml`. O arquivo **nao tem
secao `rule_files`**. O `compose.yaml` monta `./prometheus/regras` em
`/etc/prometheus/regras`, mas nada no `prometheus.yml` manda o Prometheus ler aquele
diretorio. A regra existia no disco, dentro do container, no caminho certo, e o Prometheus
simplesmente nunca a carregou.

E o enunciado diz, na estrutura obrigatoria do entregavel:

```
├── prometheus/
│   ├── prometheus.yml            ja configurado
│   └── regras/                   (voce preenche)
```

`prometheus.yml` **nao esta** "ja configurado". Este e o momento em que desconfiei que o
problema era o desafio e nao eu — e estava certo. Achei rapido porque sei onde `rule_files`
mora; um aluno que nunca configurou Prometheus vai atras da sintaxe da regra, do
`promtool`, do reload, do volume do compose. Facil perder 30-60 minutos aqui, sem
aprender nada sobre observabilidade. Vai para o FEEDBACK como problema de starter.

Corrigido com quatro linhas em `prometheus.yml`. `/rules` passou a exibir
`FalhaEmCobrancas`, `health: ok`, `for: 45s`.

**Calibragem do limiar.** Medi antes de escrever, como o passo 6 manda:

- `normal`: 0 falhas em 175 cobrancas = 0,00%
- `cenario-a` (~75s): 62 falhas em 443 cobrancas = 14,0% acumulado; taxa instantanea
  chegou a 44%

Escolhi razao em vez de valor absoluto (`falha / total > 0.02`), porque razao nao depende
do volume de trafego. Limiar 2%, `for: 45s`.

Observacao sobre o enunciado: ele avisa que "o `group_wait` padrao dele soma mais tempo".
O `alertmanager.yml` do starter ja vem com `group_wait: 10s`, que nao e o padrao do
Alertmanager (30s). O aviso aponta para um problema que o starter ja resolveu. Nao
atrapalha, mas manda o aluno procurar algo que nao esta la.

## [13:14] Etapa 6 — dashboard

Quatro paineis, um JSON versionado em `grafana/provisioning/dashboards/`. Cada titulo
comeca com a pergunta que ele responde, para nao restar duvida no criterio. Sem atrito:
o provider `dashboards.yml` ja vinha configurado, entao foi so soltar o arquivo.

O painel que interessa e o quarto: `pedidos_confirmados_total` e
`cobrancas_processadas_total{resultado="aprovada"}` na mesma escala. Quando esta tudo
bem as duas linhas se sobrepoem. A distancia entre elas e literalmente o dinheiro que o
financeiro nao viu entrar.

## [13:20] Etapa 7 — provar os dois comportamentos do alerta

- `docker compose down -v` + `up -d --build`, do zero.
- Antes de qualquer trafego: os tres contadores ja aparecem em zero nos dois processos,
  com os tres valores de `resultado`. Dashboard no ar, 4 paineis, zero cliques.
- `docker compose restart receptor-alertas` + `normal` por 3 minutos: **nenhum alerta**.
  Log do receptor so com a linha de subida. Regra `inactive`.
- `cenario-a`: **alerta no receptor em 72 segundos.**
  `2026-07-31T16:02:32.246Z alerta=FalhaEmCobrancas status=firing`

## [13:25] Atrito inesperado: o entregavel exige uma imagem e a stack nao produz imagem

O criterio pede que `reports/incidente.md` "traz ao menos uma imagem". O Grafana desta
stack nao tem o plugin `grafana-image-renderer`, entao nao existe endpoint de render. Num
desktop isso e resolvido com PrintScreen em 5 segundos; aqui precisei subir um container
`zenika/alpine-chrome:with-puppeteer` avulso, logar no Grafana por script e tirar a
captura. ~20 min entre pull da imagem, `MODULE_NOT_FOUND` por causa do `NODE_PATH` e o
roteiro do puppeteer.

Nao e um problema para o aluno tipico (ele tem tela). E um problema para o **avaliador**,
se ele quiser reproduzir a evidencia, e vale uma linha no enunciado dizendo que a captura
e manual e nao sai da stack. Ficaram `reports/dashboard.png` e `reports/jaeger-trace.png`.

## [13:35] Ambiguidade real no criterio de diagnostico

O criterio diz: "A secao `## Causa raiz` cita arquivo e linha, e ambos coincidem com o
gabarito de correcao".

**Qual numeracao?** A minha instrumentacao empurrou o defeito de
`src/worker/index.ts:53` (base) para `src/worker/index.ts:90` (entregue). O gabarito
aponta para a base; o repositorio entregue tem outra numeracao. Se o corretor conferir
contra o arquivo entregue, quem citar a linha da base erra; se conferir contra o gabarito,
quem citar a linha do proprio arquivo erra. Citei as duas, explicitamente. Isso e um
criterio que pode reprovar entrega correta.

## [13:40] Etapa 8 — relatorio, README e conferencia dos criterios

Escrevi `reports/incidente.md` e substitui o `README.md`. Percorri os 23 criterios um a um
com a stack no ar (resultado no FEEDBACK.md).

Confirmado que **nao corrigi o defeito**: `git diff main..resolucao -- src/worker/index.ts`
mostra o ternario `const status = recusado ? 'recusado' : 'confirmado'` intacto, e
`recusado` continua sem ser tocado no `catch`.

## [14:05] Fechamento

Percorri os 23 criterios do zero, com a stack no ar. 22 atendidos com prova, 1 (o de
"arquivo e linha coincidem com o gabarito") marcado como ambiguo porque a instrumentacao
move a linha.

Escrevi o `FEEDBACK.md`. Os tres achados que eu levaria para quem escreveu o desafio:

1. O defeito e entregue pela leitura de codigo, e e o proprio README que obriga a abrir o
   arquivo (requisito 1 -> `pedido_id` no worker) antes de existir telemetria. O requisito
   6 nao funciona como esta.
2. `prometheus.yml` sem `rule_files` (declarado "ja configurado") e o JSON de dashboard
   sem esqueleto: ~2h perdidas em coisas que nao ensinam observabilidade.
3. Tres criterios eliminatorios podem reprovar entrega correta: o `tail -1 | jq` (sorte de
   timing), o "linha coincide com o gabarito" (a instrumentacao move a linha) e o
   `git diff` de `src/` (reindentacao aparece como alteracao).

Estimativa final: **~13h30** no caminho realista, contra o alvo de 10h. Cabe em ~9h com os
sete cortes listados no FEEDBACK, sem remover nenhum requisito.

Ultima conferencia: `main` intacta, tudo commitado em `resolucao`, defeito da aplicacao
nao corrigido.
