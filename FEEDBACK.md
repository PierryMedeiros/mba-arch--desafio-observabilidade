# Relatório crítico — Desafio de Observabilidade, versão "A instrumentação pela metade"

Resolvido do início ao fim na branch `resolucao`, trabalhando só a partir do `README.md`
do repositório base. Diário de execução em [`DIARIO.md`](DIARIO.md).

**Resumo em três frases.** O starter é bom, sobe de primeira e a seção "O que já está
instrumentado" descreve a realidade com precisão. Mas o desafio tem um furo estrutural:
**o defeito é descoberto lendo código, não telemetria, e o próprio README obriga o aluno
a abrir o arquivo onde ele está antes de qualquer investigação ser possível** — o
requisito 7, que é o coração do exercício, está quebrado por construção. E o alvo de 10
horas não se sustenta: medi ~13h30 no caminho realista, com o dashboard e o relatório
final estourando.

---

## 1. Autoavaliação contra os critérios

Os 23 critérios, um a um, com a prova. Stack no ar, clone limpo, `docker compose up -d`.

### Logs

| # | Critério | Atende | Prova |
|---|---|---|---|
| 1 | `logs api \| grep '"msg"' \| tail -1 \| jq .` traz `timestamp`, `level`, `service`, `msg`, `trace_id`, `span_id`; idem `worker` | ✅ | Saída abaixo |
| 2 | Linhas de pedido trazem `pedido_id` | ✅ | Mesma saída |
| 3 | `cenario-a` produz linhas `error` com o motivo | ✅ | 310 linhas `error` |

```json
// api
{"timestamp":"2026-07-31T16:08:11.403Z","level":"info","service":"api",
 "msg":"pedido 1248 criado para cli-0257",
 "trace_id":"852111946cd38deb08e9abc2b6350fa4","span_id":"b9787ad7f5396ff0","pedido_id":1248}
// worker
{"timestamp":"2026-07-31T16:08:11.453Z","level":"info","service":"worker",
 "msg":"pedido 1248 ficou confirmado",
 "trace_id":"852111946cd38deb08e9abc2b6350fa4","span_id":"a9f86f4c003b22fc","pedido_id":1248}
// error, no cenario-a
{"timestamp":"2026-07-31T16:08:11.250Z","level":"error","service":"worker",
 "msg":"cobranca do pedido 1247 falhou: gateway respondeu de forma inesperada",
 "trace_id":"7ff4446c61b3561d5f907083db3577ca","span_id":"71dd1a0975dfa80e","pedido_id":1247}
```

**Ressalva no critério 1, e ela é séria.** `tail -1` pega a *última* linha do log, e nem
toda linha nasce dentro de um span — `"api ouvindo na porta 8080"` roda na subida, fora de
qualquer trace. Numa stack recém-subida e sem tráfego, esse comando pega justamente essa
linha. Eu passo porque **decidi emitir `trace_id: ""` sempre**, inclusive fora de span.
Quem tomar a decisão defensável oposta — omitir o campo quando não há trace, que é o que
a maioria das bibliotecas faz — **reprova num critério eliminatório por sorte de timing**.
O enunciado não diz qual das duas é a esperada.

### Tracing

| # | Critério | Atende | Prova |
|---|---|---|---|
| 4 | `POST /pedidos` vira trace único com spans de `api` e `worker` | ✅ | trace `13ecc7965486924c4ccfec17fdde17cb`, 19 spans, serviços: api, worker |
| 5 | O mesmo trace contém `pedido.criar` e `pedido.processar` | ✅ | `pedido.criar presente: true` / `pedido.processar presente: true` |
| 6 | `cenario-a` produz ao menos um trace com span de erro | ✅ | 20 traces com `error=true`, span `pedido.processar`, `otel.status_description = gateway respondeu de forma inesperada` |
| 7 | `trace_id` do Jaeger buscado em `docker compose logs api worker` devolve linhas dos dois processos | ✅ | 3 linhas: 1 da `api`, 2 do `worker` |

### Métricas

| # | Critério | Atende | Prova |
|---|---|---|---|
| 8 | Nenhuma série de `http_request_duration_seconds` usa caminho concreto | ✅ | Valores de `route`: `/health`, `/metrics`, `/pedidos`, `/pedidos/:id`, `/produtos`, `/produtos/:id` — 6, fechados |
| 9 | Nenhuma série usa id de pedido ou cliente como label | ✅ | Inventário completo de labels dos dois `/metrics`: `kind`, `le`, `major`, `method`, `minor`, `patch`, `resultado`, `route`, `space`, `status`, `type`, `version`. Nenhum id |
| 10 | Saídas somadas contêm as três métricas, com `resultado` em `aprovada`/`recusada`/`falha` | ✅ | Saída abaixo |
| 11 | Os três contadores existem já na subida, antes de qualquer tráfego | ✅ | Medido logo após `down -v` + `up -d`: os cinco em `0` nos dois processos |

```
# porta 8080 (api)          # porta 8081 (worker)
pedidos_criados_total 1224                             0
pedidos_confirmados_total 0                         1138
cobrancas_processadas_total{resultado="aprovada"} 0  828
cobrancas_processadas_total{resultado="recusada"} 0   86
cobrancas_processadas_total{resultado="falha"}    0  310
```

### Dashboard

| # | Critério | Atende | Prova |
|---|---|---|---|
| 12 | Exatamente um dashboard provisionado, abre sem clique | ✅ | `GET /api/search?type=dash-db` → 1 |
| 13 | No máximo 4 painéis, nenhum título vazio ou `Panel Title` | ✅ | 4 painéis, títulos abaixo |
| 14 | Os painéis respondem às três perguntas | ✅ | Cada título *começa* com a pergunta |

```
1. O sistema esta com erro? Cobrancas que falharam (% do ultimo minuto)
2. O sistema esta com erro? Cobrancas por resultado (por minuto)
3. O sistema esta lento? Latencia HTTP p95 por rota (segundos)
4. O dinheiro esta entrando? Pedidos confirmados x cobrancas aprovadas (por minuto)
```

O critério 14 é **subjetivo e não tem comando que dê o check**. Eu resolvi colando a
pergunta literal no título, o que é meio grosseiro mas torna o critério verificável. Um
aluno que titule "Taxa de erro" e "p95" responde as mesmas perguntas e fica na mão do
humor do corretor. Num conjunto de critérios que se declara eliminatório, isso é um
problema.

### Alerta

| # | Critério | Atende | Prova |
|---|---|---|---|
| 15 | `/rules` exibe `FalhaEmCobrancas`, sem erro, `for` entre 30s e 1m | ✅ | `health: ok`, `lastError: nenhum`, `for: 45s` |
| 16 | 3 min de `normal` após `restart receptor-alertas` → nenhum alerta | ✅ | Log do receptor com só a linha de subida; regra `inactive` |
| 17 | `cenario-a` → alerta no receptor em até 3 min | ✅ | **72 segundos** |

```
# depois de 3 min de cenario normal:
receptor de alertas ouvindo na porta 9099
[fim do log]

# depois do cenario-a:
2026-07-31T16:02:32.246Z alerta=FalhaEmCobrancas status=firing
```

### Diagnóstico e README

| # | Critério | Atende | Prova |
|---|---|---|---|
| 18 | `reports/incidente.md` com as 4 seções e títulos exatos | ✅ | `## Sintoma`, `## Evidência`, `## Causa raiz`, `## Correção sugerida` |
| 19 | Cita `trace_id`, PromQL, comando de busca no log e traz imagem | ✅ | `7fe86883f325cd77c0fb26989cceeb5e`; query de razão de falhas; `docker compose logs api worker \| grep <trace_id>`; `dashboard.png` e `jaeger-trace.png` |
| 20 | `## Causa raiz` cita arquivo e linha, coincidindo com o gabarito | ⚠️ | `src/worker/index.ts`, base **linha 53**, entregue **linha 90** — citei as duas |
| 21 | README com as 3 seções exatas e tabela de equivalências preenchida | ✅ | `## Como rodar`, `## Equivalências com o curso` (4 linhas), `## Decisões e limiares` |

**O critério 20 é ambíguo e pode reprovar entrega correta.** A instrumentação
obrigatória empurra o defeito de `src/worker/index.ts:53` para `:90`. Se o corretor
confere contra o gabarito (base), quem citar a linha do próprio arquivo entregue erra; se
confere contra o arquivo entregue, quem citar a do gabarito erra. O enunciado não diz qual
numeração vale. **Precisa dizer, ou trocar "linha" por "função/bloco".**

### Integridade

| # | Critério | Atende | Prova |
|---|---|---|---|
| 22 | `git diff` sem alteração em `carga/` e `receptor-alertas/` | ✅ | `git diff main --stat -- carga/ receptor-alertas/` → vazio |
| 23 | `git diff` em `src/` mostra só instrumentação | ✅ | Ternário e `recusado` intactos; só mudou indentação |

### Se eu fosse o avaliador, eu me aprovaria?

**Sim** — 22 de 23 com prova reproduzível, e o único ⚠️ é ambiguidade do critério, não
falha da entrega. Mas com uma ressalva desconfortável: **eu passei no critério 1 por uma
decisão de projeto que tomei porque desconfiei do critério, não porque era a mais
correta.** Um aluno melhor que eu, que omitisse o campo fora de span, reprovaria. Isso não
é medir competência, é medir sorte.

---

## 2. O ponto de partida

**Ficou claro o que já existia?** Sim, e essa é a maior vitória da reestruturação. A seção
"O que já está instrumentado" tem seis bullets e **os seis conferem**. Percorri item por
item em ~12 minutos e não precisei explorar às cegas. O contraste com "O que não está" é
explícito e correto. Não perdi tempo nenhum descobrindo o terreno.

Um único desencontro, e ele favorece o aluno: o texto diz *"A pasta de dashboards está
vazia"*, mas ela contém `dashboards.yml`, o provider já configurado. Melhor do que o
prometido — só que quem lê "vazia" pode achar que precisa escrever o provider também.

**A seção bate com o código?** Bate. Confirmei os seis:

- Auto instrumentação HTTP + banco, OTLP para o Jaeger, `AlwaysOnSampler` — ✅ um
  `POST /pedidos` já virava trace de 15 spans antes de eu tocar em nada
- Log JSON com os 4 campos e nada de trace — ✅
- `/metrics` com `prom-client` e o histograma — ✅
- Dois alvos `UP` no Prometheus — ✅
- Datasources provisionados — ✅
- Alertmanager → receptor, sem regra — ✅

**Herdar instrumentação pronta ajudou ou atrapalhou?** Ajudou, e bastante. O código é
pequeno (≈550 linhas de `src/`), em português, sem abstração desnecessária. Li o conjunto
todo em ~10 minutos e o custo de entender antes de estender foi baixo. Mais importante: o
starter é *bem desenhado para ser estendido*. Três exemplos concretos que economizaram
tempo real:

- `consumirPedido` devolve `Record<string, unknown>`, não um tipo fechado. Isso deixa a
  chave extra do trace context passar sem briga de tipo — decisão consciente de quem
  montou o starter, e boa.
- `medirRequisicoes` já está isolado num arquivo próprio, então o conserto de cardinalidade
  é cirúrgico.
- `log.ts` é minúsculo, então acrescentar `trace_id`/`span_id` é uma função de 5 linhas.

**O bootstrap do OTel pronto tirou friction ou tirou aprendizado?** Tirou os dois, e o
saldo é positivo. O `NodeSDK` em `otel.ts` está resolvido: exporter, resource, sampler,
`--require` no `package.json`. Isso elimina a categoria de erro mais frustrante e menos
didática que existe em OTel Node — "instrumentei tudo certo e não aparece nada no Jaeger
porque o SDK carregou depois do `require` do Express".

O que se perde é real, mas menor: o aluno não aprende que **a ordem de carregamento
importa**, que é o conceito mais transferível do bootstrap. Sugestão barata: manter o
`otel.ts` pronto, mas com um comentário de 3 linhas explicando por que ele é carregado por
`--require` e não por `import` no topo do `servidor.ts`. Custa nada e devolve o
aprendizado.

---

## 3. O defeito

### Em que momento entendi, e o que entregou

**12:53, dez minutos depois de começar a escrever código, e quem entregou foi o código —
não a telemetria.** E não foi por indisciplina minha: **foi o próprio README que me
mandou abrir o arquivo.**

A sequência é inescapável:

1. Passo 2 da ordem de execução: *"Comece pela correlação de log com trace."*
2. Requisito 1: *"Acrescente a toda linha de log **dos dois processos** [...] Linhas
   relacionadas a um pedido carregam também `pedido_id`."*
3. Para pôr `pedido_id` nas linhas do worker eu **tenho** que abrir `src/worker/index.ts`.
4. O arquivo tem 100 linhas. `processarMensagem` cabe inteiro numa tela. O defeito está
   nele.

Ou seja: o desafio manda o aluno abrir o arquivo do defeito **no primeiro requisito**,
antes de existir qualquer telemetria capaz de investigar coisa alguma.

### O catch resistiu a uma passada de olho?

**Não resistiu nem a meia.** Este é o bloco, como estava:

```ts
let recusado = false;                                  // linha 47

try {
  const resultado = await processarPagamento(clienteId, valorTotal);
  recusado = !resultado.aprovado;
} catch (erro) {
  registrarFalhaLegado(erro);                          // linha 53 — engole
}

const status = recusado ? 'recusado' : 'confirmado';   // linha 56 — vira confirmado
```

`let x = false` + `catch` que não mexe em `x` + ternário logo abaixo é um dos padrões de
bug mais reconhecíveis que existem. Está tudo em oito linhas consecutivas, sem nenhuma
indireção. Não há como um dev pleno abrir esse arquivo e *não* ver.

Quatro coisas conspiram para entregar a resposta:

1. **Distância zero.** As três linhas que formam o bug são consecutivas e visíveis juntas.
2. **O nome do arquivo.** `registro-legado.ts` no `import`, ao lado de `pagamento.ts`,
   grita "aqui tem coisa errada" antes de você ler uma linha.
3. **O README já disse o formato da resposta.** Requisito 3 exige `resultado` com os
   valores `aprovada`, `recusada` e `falha`, e explica: *"Recusa e falha não são a mesma
   coisa, e tratar as duas como uma só é o caminho mais curto para não achar a queixa."*
   Isso **é** o defeito, escrito por extenso, no requisito 3. O aluno sabe que existe uma
   falha tratada como não-falha antes de olhar qualquer código.
4. **O requisito 5 elimina o resto.** *"nem toda falha aparece como erro HTTP na borda"*
   remove a única hipótese concorrente.

### Foi investigação de verdade?

**Não. Foi encenação, e eu registrei isso no diário no minuto em que aconteceu.**

Construí a instrumentação sabendo o que ela ia mostrar. O passo 7 diz: *"Resista ao
impulso de procurar a resposta lendo o código: se ela vier do código e não da telemetria,
você não provou nada."* O problema é que o passo 7 pede algo que os passos 2 e 3 já
tornaram impossível.

**Isto é o achado número um deste relatório.** O requisito 6 é o que "separa quem
instrumentou de quem entendeu", e hoje ele não separa nada: todo mundo chega no requisito
6 já sabendo a resposta desde o requisito 1.

E o mais frustrante é que **a telemetria funciona lindamente**. Depois de pronta, ela
conta a história inteira num span só:

```
otel.status_code   = ERROR
cobranca.resultado = falha
pedido.status      = confirmado    <-- a contradição, num span só
```

O desafio construiu um instrumento excelente e depois entregou a resposta antes de deixar
usá-lo.

### Como consertar (as três opções, da mais barata para a melhor)

1. **Mover o defeito para longe do que o requisito 1 obriga a abrir.** Tirar o bloco
   `try/catch` de `worker/index.ts` e enfiá-lo dentro de `pagamento.ts` ou de um
   `conciliacao.ts` novo, deixando em `index.ts` apenas
   `const status = await decidirStatus(...)`. O aluno instrumenta `index.ts` sem topar com
   nada. **Custo: 20 minutos de refactor no starter. É o melhor retorno deste relatório
   inteiro.**
2. **Tirar o spoiler do requisito 3.** Pedir `cobrancas_processadas_total{resultado}` sem
   explicar que recusa e falha são diferentes — ou, melhor ainda, pedir só
   `aprovada`/`recusada` e deixar o aluno **descobrir que falta um terceiro valor** quando
   os números não fecharem. Essa descoberta é o exercício inteiro, e hoje ela vem de graça.
3. **Inverter a ordem de execução.** Colocar métricas de negócio e o cenário de carga
   *antes* dos spans manuais, para o aluno ver a discrepância numérica
   (`confirmados > aprovadas`) antes de abrir o worker. Aí sim ele abre o arquivo já com a
   pergunta na mão.

Com a opção 1 sozinha, o requisito 6 volta a valer.

---

## 4. O erro de cardinalidade

**Achei em ~2 minutos, na exploração do passo 1, sem ler código.** Bati em `/produtos/1`,
`/produtos/2`, `/produtos/42` e olhei a saída de `/metrics`:

```
http_request_duration_seconds_count{route="/produtos/1",method="GET",status="200"} 1
http_request_duration_seconds_count{route="/produtos/42",method="GET",status="200"} 1
http_request_duration_seconds_count{route="/pedidos/25",method="GET",status="200"} 1
```

**Fácil demais.** Não pelo caminho — achar pela saída de `/metrics` é exatamente o método
certo — mas porque **o enunciado entrega a resposta três vezes antes de o aluno procurar**:

- Linha 79: *"tem um problema plantado na instrumentação de métricas que já existe"*
- Requisito 3: *"O histograma que já existe comete o erro de cardinalidade mais clássico
  que existe"* — nomeia a métrica e a classe do erro
- Critério de aceite: *"`/produtos/:id` está correto, `/produtos/42` reprova"* — o
  exemplo literal, com a correção junto

Depois do terceiro, não sobrou nada para descobrir. Isso não é procurar agulha no palheiro,
é conferir se a agulha que te mostraram continua onde disseram.

**O ajuste é fácil e barato:** manter o requisito 3 pedindo "audite a instrumentação de
métricas existente e conserte o que estiver errado", **sem** dizer que é cardinalidade,
sem nomear a métrica, e tirar o exemplo do critério de aceite (ou movê-lo para uma seção
de gabarito que o aluno não lê). O sinal continua visível em `/metrics` para quem souber
olhar. Quem não souber, aprende procurando — que é o ponto.

**Consertar exigiu pesquisa?** Quase nenhuma, e essa parte está certa. Sei que `req.path` é
concreto e que o template do Express está em `req.route.path`. O único detalhe que exigiu
atenção foi que `req.route` só existe **depois** do roteamento — e como a medição acontece
no evento `finish`, está disponível. Um aluno que não conhece Express gastaria 15-20
minutos na documentação do `Request`. Tempo razoável e bem gasto.

**Nota positiva:** o requisito 3 pede que o aluno *explique em uma frase por que aquilo
derrubaria um Prometheus em produção*. Esse é o melhor micro-requisito do desafio inteiro
— separa quem trocou uma linha de quem entendeu o custo. Manter.

---

## 5. Problemas do enunciado

### 5.1 Onde permite mais de uma leitura razoável

**a) "Linhas relacionadas a um pedido carregam também `pedido_id`"** (requisito 1).
Quais linhas são "relacionadas a um pedido"? Só as que citam o pedido na `msg`? As do
`GET /pedidos/:id` também? A do erro de leitura da fila, que não sabe qual pedido era?
Arbitrei: todas as linhas dentro do fluxo de criação e de processamento. Nunca fica claro
se `GET /pedidos/:id` deveria entrar.

**b) A assinatura do logger.** Para pôr `pedido_id` na linha eu tive que mudar
`log.info(msg: string)` para `log.info(msg, extras?)`. Isso é instrumentação ou alteração
de código? A restrição diz *"Você completa a instrumentação. Não altera comportamento
funcional"* — mudar a assinatura não altera comportamento, mas o enunciado não autoriza
explicitamente mexer na forma do logger. Segui em frente, mas um aluno cauteloso vai
travar aqui ou fazer gambiarra (extrair o id da `msg` com regex).

**c) "Ambos com atributos úteis para diagnóstico"** (requisito 2). "Útil" não é
verificável. Não há critério de aceite conferindo atributo nenhum além, implicitamente, do
id. Ou vira exigência concreta (liste os atributos), ou some do texto.

**d) Métricas por processo ou compartilhadas?** O critério 10 diz *"As saídas de
`/metrics` dos dois processos, **somadas**"*. Isso permite duas leituras: (i) cada processo
expõe as métricas que lhe dizem respeito e a soma cobre as três; (ii) ambos expõem as três,
zeradas onde não se aplica. Fui na (ii), por causa do critério 11 ("existem já na subida").
As duas passam, mas o aluno não sabe disso e vai gastar tempo decidindo.

**e) "aceita `-d` para ficar em segundo plano"** (seção do gerador de carga). O `-d` é
flag do `docker compose run`, não do script. O exemplo do README é
`docker compose run --rm carga cenario-a`, então a leitura natural é acrescentar `-d` no
fim. **Testei: `docker compose run --rm carga cenario-a -d` roda em primeiro plano e
bloqueia o terminal** — o `-d` vira `process.argv[3]` e é ignorado. O correto é
`docker compose run -d --rm carga cenario-a`. Papercut pequeno, mas garantido, e no
começo do trabalho, quando o aluno ainda não tem confiança no ambiente. **Corrigir o
exemplo resolve.**

### 5.2 Onde se contradiz ou descreve o starter de forma imprecisa

**a) `prometheus.yml` "já configurado" — não está. Este é o pior problema do starter.**
A estrutura obrigatória diz:

```
├── prometheus/
│   ├── prometheus.yml            já configurado
│   └── regras/                   (você preenche)
```

O `prometheus.yml` **não tem seção `rule_files`**. O `compose.yaml` monta
`./prometheus/regras` em `/etc/prometheus/regras`, mas nada manda o Prometheus ler aquele
diretório. Escrevi a regra, reiniciei, `/rules` **vazio**. A regra estava no disco, no
container, no caminho certo, e o Prometheus nunca a carregou. Detalhes na seção 6.

**b) "A pasta de dashboards está vazia"** — tem o `dashboards.yml`. Imprecisão a favor do
aluno, mas imprecisão.

**c) O aviso sobre `group_wait` aponta para um problema que o starter já resolveu.** O
requisito 5 diz: *"o `group_wait` padrão dele soma mais tempo até o webhook sair. Ajuste
se precisar"*. O padrão do Alertmanager é 30s; o `alertmanager.yml` do starter **já vem
com `group_wait: 10s`**. O aviso manda o aluno procurar e ajustar algo que já está
ajustado.

**d) Linha 34: `https://github.com/devfullcycle/REPO-A-DEFINIR`.** Placeholder não
substituído, na instrução de onde clonar. Bloqueia o aluno no minuto zero.

**e) Linha 36: "A entrega final fica na branch `main` do seu fork"**, e a seção Entrega
repete *"com tudo consolidado na branch `main`"*. Está correto para o aluno; registro só
porque diverge da instrução deste exercício (branch `resolucao`).

**f) `.gitignore` e `.dockerignore` listam `GABARITO-NAO-PUBLICAR.md`.** O arquivo não
existe no repositório — mas os dois ignores anunciam que ele existe e como se chama.
Não vaza conteúdo, mas convida a procurar. Tirar as duas linhas.

**g) O critério 1 usa `jq`, que não é dependência declarada.** Não tenho `jq` nesta
máquina e não tenho sudo. O README exige Docker e Compose; `jq` aparece só dentro de um
critério eliminatório. Ou entra nos pré-requisitos, ou o critério vira
`... | python3 -m json.tool`.

### 5.3 Critérios impossíveis, verificáveis por sorte, ou que dependem do não pedido

| Critério | Problema |
|---|---|
| **1** (`tail -1 \| jq .`) | **Verificável por sorte.** Depende de a última linha ter nascido dentro de um span. Sem tráfego recente, a última linha é a de subida e reprova entrega correta. O enunciado não diz se o campo deve existir vazio fora de span |
| **14** (painéis respondem às 3 perguntas) | **Subjetivo, sem comando que dê o check.** Num conjunto declaradamente eliminatório, isso é decidido pelo humor do corretor |
| **20** (arquivo e linha coincidem com o gabarito) | **Ambíguo.** A instrumentação obrigatória move o defeito da linha 53 para a 90. Nenhuma das duas respostas é errada e o enunciado não diz qual vale |
| **19** (traz ao menos uma imagem) | **Depende de algo que o enunciado não pediu e a stack não fornece.** Ver 6.3 |
| **23** (`src/` só com linhas de instrumentação) | **Impossível de verificar mecanicamente.** Envolver um bloco num `startActiveSpan` reindenta o código inteiro e o `git diff` marca as linhas originais como removidas e readicionadas. Meu diff mostra `- const status = recusado ? ...` / `+ const status = recusado ? ...`. Um corretor rodando `git diff` e vendo o ternário do defeito como linha alterada pode concluir que o aluno mexeu no fluxo. **Sugestão: pedir `git diff -w` no critério** |

### 5.4 O que o enunciado presume e não diz em lugar nenhum

- **Que `req.route.path` existe e é o template.** O requisito 3 diz o que está errado, não
  dá pista do que é certo em Express. É pesquisa legítima, mas vale um link.
- **Que `rule_files` precisa existir no `prometheus.yml`.** Presumido, e o enunciado ainda
  afirma o contrário ("já configurado").
- **O formato do JSON de dashboard do Grafana.** Ver 6.2 — é a maior presunção não dita do
  desafio inteiro.
- **Que o SDK do OTel registra o propagador W3C globalmente por padrão**, e por isso
  `propagation.inject` funciona sem configuração. Quem não sabe vai procurar como registrar
  um `W3CTraceContextPropagator` na mão e perder tempo.
- **Que a imagem do relatório é captura manual de tela.** Ver 6.3.
- **Que `docker compose run -d` quer o `-d` antes do nome do serviço.**

### 5.5 Que informação faltou e tive que inventar

- **A URL do repositório base** (`REPO-A-DEFINIR`).
- **Onde guardar o trace context na mensagem.** O requisito diz "injetando na publicação e
  extraindo no consumo", sem dizer se o portador vai numa chave dedicada, no topo do
  objeto, ou num envelope `{cabecalhos, corpo}`. Inventei a chave `rastro`. Escolha sem
  consequência, mas é decisão que 30 alunos vão tomar de 30 jeitos, e isso complica a
  correção.
- **O limiar do alerta.** Aqui a liberdade é deliberada e correta — o enunciado pede o
  valor observado, o limiar e o `for` no README, o que é a pedagogia certa.
- **Se o dashboard pode ter linhas/anotações extras** além dos 4 painéis (row headers,
  por exemplo, contam como painel?).

### 5.6 O que é longo, repetido ou desnecessário

O README tem ~300 linhas e é **denso demais para o que entrega**. ~40 minutos entre
primeira leitura e releituras. Onde cortar:

- **A seção "Por quê" de cada requisito.** São seis, com 3-5 linhas cada, ~30 linhas no
  total. Bem escritas, e o argumento pedagógico é bom — mas o requisito 3 usa o "por quê"
  para **entregar o defeito** ("recusa e falha não são a mesma coisa..."). Encurtar para
  uma frase por requisito.
- **Repetição de que não se deve corrigir o defeito.** Aparece **quatro vezes**: "Sobre o
  foco do desafio", Restrições, Fora de escopo e Entrega. Uma vez, em Restrições, basta.
- **"Sobre pesquisar fora do que foi ensinado"** (7 linhas) diz o mesmo que o parágrafo
  seguinte sobre a tabela de equivalências. Fundir.
- **"Tecnologias obrigatórias"** repete a lista que o `compose.yaml` já mostra e que a
  seção "O que já está instrumentado" já descreve.
- **A "Estrutura obrigatória do entregável"** repete o que os requisitos já disseram, e é
  justamente onde mora o erro do `prometheus.yml "já configurado"`.

Dá para tirar ~80 linhas sem perder informação. E vale inverter a ordem de duas seções: a
**pista** ("do lado de fora está tudo 2xx...") aparece antes dos requisitos, o que faz o
aluno chegar no requisito 1 já sabendo que o problema é interno e silencioso.

---

## 6. Problemas do starter

### 6.1 Alguma coisa quebrada ou que não subiu de primeira?

**A stack subiu de primeira, sem nenhum ajuste**, em ~90s de build + subida. Nove
serviços, `api` e `worker` `healthy`, Postgres com produtos carregados, Prometheus com os
dois alvos `up`, datasources provisionados. Isso é raro e merece registro. Os
healthchecks, o `depends_on: service_completed_successfully` no seed e os limites de
memória mostram cuidado real.

**O que está quebrado é um só, e é grave: `prometheus.yml` sem `rule_files`.** O sintoma
é cruel — regra escrita, arquivo no lugar certo, `docker compose restart prometheus`,
`/rules` **vazio**, sem nenhuma mensagem de erro. Não há log dizendo "ignorei seu
arquivo", porque do ponto de vista do Prometheus não há arquivo nenhum para ignorar.

Achei em ~10 minutos porque sei onde `rule_files` mora. **Um aluno que nunca configurou
Prometheus vai investigar na ordem errada:** sintaxe do YAML da regra, `promtool check
rules`, o mount do compose, o endpoint de reload, indentação do `groups`. Estimo **30 a 60
minutos**, e é o pior tipo de tempo perdido — não ensina nada sobre observabilidade e o
enunciado afirma que aquele arquivo já está pronto, então o aluno passa o tempo todo
convencido de que o erro é dele. Foi o único momento em que desconfiei do desafio em vez
de mim, e eu estava certo.

**Correção: quatro linhas no `prometheus.yml` do starter**, e o problema deixa de existir.

```yaml
rule_files:
  - /etc/prometheus/regras/*.yml
```

Se a intenção era que o aluno descobrisse isso, então o `prometheus.yml` não pode estar
marcado como "já configurado" na estrutura do entregável — precisa dizer
"(você completa)".

### 6.2 Os dois cenários reproduzem o prometido? Em quanto tempo?

**Sim, os dois, e com precisão.** É a melhor peça do starter.

| | `normal` (3 min) | `cenario-a` (75 s) |
|---|---|---|
| Cobranças aprovadas | 410 | 327 |
| Recusadas | 35 | 54 |
| **Falhas** | **0** | **62** |
| Pedidos confirmados | 410 | 389 |
| Confirmados sem cobrança | **0** | **62** |
| Taxa de falha instantânea | 0,00% | até 43% |

- O `normal` é **limpo de verdade**: 0 falhas em 445 cobranças, e
  `pedidos_confirmados_total` (410) igual a `cobrancas aprovadas` (410), na casa da
  unidade. Isso torna a calibragem do alerta trivial e confiável.
- O `cenario-a` cumpre o "menos de um minuto": as primeiras falhas aparecem em ~15s e o
  alerta saiu em **72s**.
- A separação entre recusa legítima (cliente terminado em `3`) e exceção (terminado em
  `7`) é o coração pedagógico do desafio e está bem construída.

Elogio específico: o `normal` produzir **exatamente zero** falhas é a decisão certa. Um
baseline ruidoso transformaria a calibragem em adivinhação.

### 6.3 Fricção que consumiu tempo sem ensinar nada

**a) Rebuild a cada alteração de uma linha.** O `Dockerfile` faz `COPY src ./src` e o
`compose.yaml` **não monta volume de código**. Toda mudança em TypeScript exige
`docker compose up -d --build api worker`. São ~15s por ciclo aqui, com cache quente, mas
o desafio é *iterativo por natureza*: você põe um span, olha o Jaeger, ajusta, olha de
novo. São dezenas de ciclos. **Custo estimado para o aluno: 45-60 minutos de espera pura,
e zero aprendizado.** O projeto já usa `tsx`, que faz watch nativamente.

**Correção barata**, dois blocos no `compose.yaml`:

```yaml
    volumes:
      - ./src:/app/src:ro
```

Isso sozinho pode devolver quase uma hora ao orçamento de 10h.

**b) O JSON do dashboard do Grafana.** Esta é a fricção mais cara do desafio e vou
detalhar na seção 8, porque é ela que estoura o prazo.

**c) O relatório exige uma imagem e a stack não produz imagem.** O critério 19 pede *"ao
menos uma imagem de painel ou tela"*. O Grafana desta stack **não tem o plugin
`grafana-image-renderer`**, então não existe endpoint de render. Num desktop isso é
PrintScreen em 5 segundos e não é problema nenhum para o aluno típico. Mas:

- O enunciado nunca diz que a captura é manual, o que faz o aluno procurar por 10 minutos
  como exportar do Grafana.
- **Para o avaliador reproduzir a evidência não existe caminho automatizado.**
- No meu caso (ambiente sem navegador), custou ~20 minutos: subir
  `zenika/alpine-chrome:with-puppeteer`, resolver `MODULE_NOT_FOUND` por `NODE_PATH`, e
  escrever um roteiro de login + captura.

Vale uma linha no enunciado — ou, melhor, adicionar o `grafana-image-renderer` ao compose,
que resolve para todo mundo.

**d) Sem `.env` o compose não sobe, e a mensagem de erro é ruim.** O `.env.example` avisa
no comentário, e o README manda copiar. Funcionou. Só registro que quem pular a linha
recebe erro de variável não resolvida, não uma mensagem útil.

---

## 7. Dificuldade

### O ponto mais difícil

**Objetivamente: escrever o JSON do dashboard do Grafana à mão.** Não a travessia da fila.

E isso é um problema, porque **é difícil pelo motivo errado**.

O requisito 4 é o único que exige conhecimento de um **formato proprietário e não
documentado no enunciado**: `schemaVersion`, `gridPos`, `fieldConfig.defaults.custom`,
`overrides` com `matcher`/`properties`, `reduceOptions`, e — a armadilha de verdade — o
`datasource: {type, uid}` em dois níveis (painel e target), que precisa bater com o `uid`
declarado no `datasources.yml`.

O caminho que quase todo aluno vai tentar é: montar na interface e exportar. E aí bate na
armadilha clássica: **o "Export for sharing externally" do Grafana troca o datasource por
`${DS_PROMETHEUS}` e adiciona um bloco `__inputs`, que quebra o provisionamento por
arquivo.** O dashboard aparece com "Datasource not found" e o aluno não faz ideia do
porquê. Diagnosticar isso sem conhecer o formato leva facilmente 1-2 horas.

No meu caso escrevi o JSON direto, com os `uid` corretos desde o começo, e funcionou de
primeira. Mas eu já conhecia o formato. **Esse conhecimento não é observabilidade — é
trivia de ferramenta.**

### Difícil pelo motivo certo ou errado?

| Etapa | Dificuldade | Motivo |
|---|---|---|
| Correlação log↔trace | Baixa | ✅ **Certo.** `getActiveSpan()` + contexto é conceito, não sintaxe |
| Travessia da fila | Média (seria alta sem a dica) | ✅ **Certo.** É o conceito mais transferível do desafio |
| Cardinalidade | Baixa | ⚠️ Certo, mas entregue de graça |
| Métricas de negócio | Baixa | ✅ Certo — modelar `resultado` é decisão de negócio |
| **Dashboard JSON** | **Alta** | ❌ **Errado.** Formato proprietário, não ensina observabilidade |
| `rule_files` faltando | Média | ❌ **Errado.** Bug do starter disfarçado de dificuldade |
| PromQL do alerta | Média | ✅ **Certo.** `rate`, razão, `for`, calibrar contra baseline — é o miolo |
| Investigação | **Nula** | ❌ **Errado.** Respondida antes de começar |
| Relatório + README | Média | ⚠️ Certo em conteúdo, mas longo demais para o valor |

Ou seja: **das duas dificuldades mais altas do desafio, uma é formato de arquivo do
Grafana e a outra é um bug do starter.** As dificuldades certas (fila, PromQL) estão
mitigadas por dicas, e a que deveria ser o clímax (investigação) foi eliminada.

### Qual parte foi fácil demais e não ensinou nada

1. **A investigação (requisito 6).** Deveria ser o clímax. É a parte mais fácil do desafio
   porque a resposta chega no requisito 1.
2. **Achar a cardinalidade.** Anunciada três vezes, com exemplo literal no critério.
3. **A tabela de equivalências.** É pesquisa de nomes de pacote — "Micrometer ↔
   prom-client". Preenchi em ~10 minutos consultando o que eu mesmo tinha acabado de
   escrever. Não produz nem verifica entendimento; um aluno pode preenchê-la sem ter
   entendido nada, e ela custa tempo de redação.
4. **Inicializar contadores em zero.** O requisito 3 explica *por que* ("Série que só nasce
   no primeiro evento some do gráfico...") **e** o que fazer. Sobra `.inc(0)`. A explicação
   é ótima e deve ficar; poderia virar descoberta se o critério só exigisse o
   comportamento.

### A pista da queixa ajudou, atrapalhou ou apontou pro lugar errado?

**Apontou para o lugar exatamente certo — e esse é o problema.**

> *"do lado de fora está tudo 2xx, o cliente recebe sucesso e o pedido aparece confirmado.
> Monitoramento de caixa preta não enxerga isso [...] A resposta está no que o código sabe
> e hoje não conta a ninguém."*

As duas primeiras frases estão ótimas: dizem o **sintoma** e por que o Grafana não mostrava
nada. Isso é contexto de negócio legítimo, é o que um chamado real traria.

A terceira frase — *"o que o código sabe e hoje não conta a ninguém"* — é de outra
natureza. Ela não descreve o sintoma, descreve a **causa**: existe um ponto no código que
captura informação e não a propaga. É a definição de `catch { registrarFalhaLegado(erro) }`.
Combinada com o `import { registrarFalhaLegado }` no topo do worker, o aluno tem nome e
endereço.

**Sugestão: cortar a terceira frase.** As duas primeiras bastam para orientar sem entregar.

### A travessia de contexto pela fila

**Tempo real: ~25 minutos de código, funcionou na primeira tentativa.** ~5 minutos disso
foram pesquisa da assinatura de `startActiveSpan` com contexto explícito (são 4 overloads
e a ordem `nome, opções, contexto, callback` não é óbvia).

**Nunca vi os dois traces curtos.** E isso é o diagnóstico do problema com a dica.

O passo 3 diz:

> *"Se ao consumir a mensagem você começar um trace novo em vez de continuar o que existia,
> o sintoma é claro: dois traces curtos no Jaeger em vez de um completo. E preste atenção
> em qual contexto você usa como base ao extrair, porque **usar o contexto ativo do worker
> em vez de um contexto raiz é o erro que faz o span nascer no lugar errado**."*

Isso entrega quatro coisas de uma vez: que existe uma armadilha; qual é o sintoma dela;
onde ela está (na base da extração); e qual é a resposta (contexto raiz, não ativo).
**Escrevi `ROOT_CONTEXT` porque o README mandou, não porque entendi o problema.** Passei
pela parte mais difícil do desafio sem exercer nenhum julgamento.

Ironia útil: **eu acabei vendo o sintoma, mas por acidente.** As mensagens que já estavam
na fila antes do rebuild não tinham a chave `rastro` e viraram traces soltos de 3 spans só
do worker. Foi a única vez que a mecânica ficou visível — e foi por acaso, não pelo
desafio.

**Sugestão: cortar a última frase da dica.** Manter "o sintoma é claro: dois traces curtos
em vez de um completo" — que ensina a **diagnosticar** — e remover "usar o contexto ativo
em vez de um contexto raiz é o erro", que entrega a **solução**. O aluno vê dois traces
curtos, entende que precisa corrigir, e vai atrás. Ele tem o sintoma; a causa é o
exercício.

---

## 8. Números medidos

Todos medidos nesta execução. Nada estimado.

### 8.1 Séries de `http_request_duration_seconds`, antes e depois

Medido no Prometheus, após **2 minutos** do gerador `normal`:

```
# ANTES (label route = requisicao.path, caminho concreto)
count({__name__=~"http_request_duration_seconds.*"})              → 1963
count(count by (route) (http_request_duration_seconds_count))     →  151

/api/v1/label/route/values →
  "/health","/metrics","/pedidos","/pedidos/102","/pedidos/108","/pedidos/110",
  "/pedidos/116","/pedidos/124","/pedidos/128","/pedidos/132","/pedidos/133", ...
```

```
# DEPOIS (label route = template do Express), após 3 minutos de normal
count({__name__=~"http_request_duration_seconds.*"})              →   78
count(count by (route) (http_request_duration_seconds_count))     →    6

/api/v1/label/route/values →
  "/health","/metrics","/pedidos","/pedidos/:id","/produtos","/produtos/:id"
```

**1963 → 78 séries. 151 → 6 valores de label.** E o número "antes" é o de **dois minutos**
de carga: ele não converge, cresce linearmente com o número de pedidos criados. Depois, é
constante para sempre.

### 8.2 Tempo entre subir o `cenario-a` e o alerta chegar no receptor

```
cenario-a INICIADO em 13:01:20
>>> ALERTA NO RECEPTOR em 72s apos o inicio do cenario-a (13:02:32)

$ docker compose logs receptor-alertas
receptor de alertas ouvindo na porta 9099
2026-07-31T16:02:32.246Z alerta=FalhaEmCobrancas status=firing
```

**72 segundos**, contra o limite de 3 minutos do critério. Decomposição: ~15s até a
primeira raspagem com falhas, 45s de `for`, ~10s de `group_wait`.

### 8.3 Algum alerta durante os 3 minutos de cenário normal?

**Nenhum.**

```
$ docker compose restart receptor-alertas    # 12:57:27
$ docker compose run -d --rm carga normal    # 12:57:29
# ... 3 minutos ...                          # 13:00:44

$ docker compose logs receptor-alertas
receptor de alertas ouvindo na porta 9099
receptor de alertas ouvindo na porta 9099
[fim do log]

# estado da regra
FalhaEmCobrancas | health: ok | estado: inactive | alertas ativos: 0
```

Motivo estrutural: `cobrancas_processadas_total{resultado="falha"}` ficou em **0** durante
os 3 minutos inteiros (445 cobranças). O numerador é zero, a expressão nunca chega perto de
2%.

### 8.4 Latência das rotas no cenário normal

`histogram_quantile` sobre 3 minutos de `normal`:

| Rota | p50 | p95 | p99 |
|---|---|---|---|
| `/health` | 2,5 ms | 4,8 ms | 5,0 ms |
| `/metrics` | 2,5 ms | 4,7 ms | 5,0 ms |
| `/produtos` | 2,5 ms | 4,8 ms | 5,0 ms |
| `/produtos/:id` | 2,5 ms | 4,8 ms | 5,0 ms |
| `/pedidos/:id` | 2,5 ms | 4,8 ms | 5,7 ms |
| **`POST /pedidos`** | **7,4 ms** | **13,2 ms** | **24,6 ms** |

Tudo abaixo de 25 ms. `POST /pedidos` é a mais lenta, como esperado — é a única com
transação, múltiplos `INSERT` e publicação no Redis.

**Observação relevante para o desafio:** a latência **não muda** entre `normal` e
`cenario-a`, porque o caminho da exceção é mais *rápido* que o do sucesso. Reforça a pista:
nem latência nem status HTTP revelam a queixa. Só métrica de negócio.

### 8.5 Quantos spans tem o trace de um pedido depois da travessia da fila

**Entre 18 e 21 spans**, variando com o número de itens do pedido (cada item gera um
`INSERT`). Três traces medidos:

```
13ecc7965486924c4ccfec17fdde17cb → 19 spans | api, worker  (1 item)
60ee4dd7bfe766953b6e7dc8d888d6b8 → 20 spans | api, worker  (2 itens)
7fe86883f325cd77c0fb26989cceeb5e → 21 spans | api, worker  (3 itens)
```

Composição do trace de 21 spans:

```
api     POST /pedidos                    <- raiz
api       middleware - query / expressInit / jsonParser / medirRequisicoes
api       request handler - /pedidos
api         pedido.criar                 <- span manual
api           pg-pool.connect, pg.query:SELECT
api           pg.query:BEGIN, 4x pg.query:INSERT, pg.query:COMMIT
api           lpush                      <- publicação (contexto injetado aqui)
worker        pedido.processar           <- span manual, atravessou a fila
worker          pg-pool.connect
worker          pg.query:UPDATE
api     router - /health                 <- ruído da auto instrumentação do Express
```

Antes da travessia eram **dois traces separados**: ~17 spans na `api` e ~3 no `worker`.

Nota: o span `router - /health` aparecendo dentro de um trace de `POST /pedidos` é ruído
da auto instrumentação do Express (o Router é o mesmo objeto). Não atrapalha, mas pode
confundir um aluno lendo o Jaeger pela primeira vez.

### 8.6 Bônus: o rombo em números

Ao fim da execução, com `normal` e `cenario-a` acumulados:

```
pedidos_confirmados_total                          1138
cobrancas_processadas_total{resultado="aprovada"}   828
                                                   ----
diferença                                           310
cobrancas_processadas_total{resultado="falha"}      310   <- bate exatamente
```

**310 pedidos confirmados para o cliente sem uma única cobrança aprovada por trás.** Uma
subtração de dois contadores. É a queixa do financeiro em uma linha — e nenhuma métrica
técnica do sistema piscou.

---

## 9. Estimativa de esforço contra o alvo de 10 horas

Perfil-alvo: dev pleno/sênior, sabe backend, conhece Docker, **nunca instrumentou nada com
OpenTelemetry**. Não conta pelo meu relógio; conta pelo que a pessoa faria e onde
travaria.

| # | Etapa | Otimista | Realista | Onde trava |
|---|---|---|---|---|
| 1 | Ler o README (300 linhas, denso) + subir + explorar Jaeger/Prometheus/Grafana pela primeira vez | 1,0 h | **1,5 h** | Primeira leitura + releituras; primeira vez lendo um trace no Jaeger |
| 2 | Correlação log↔trace | 1,0 h | **1,5 h** | Descobrir `trace.getActiveSpan()?.spanContext()`; decidir a assinatura do logger; ciclos de rebuild |
| 3 | Spans manuais + travessia da fila | 2,0 h | **3,0 h** | Overloads de `startActiveSpan`; onde guardar o portador; **com a dica atual, ~2 h; sem ela, 4 h+** |
| 4 | Métricas: cardinalidade + 3 de negócio + init em zero | 1,0 h | **1,25 h** | `req.route.path` na doc do Express. Rápido porque o README entrega o problema |
| 5 | **Dashboard por arquivo JSON** | 1,5 h | **3,0 h** | ⚠️ **Estoura.** Montar na UI, exportar, descobrir que `__inputs`/`${DS_PROMETHEUS}` quebram o provisionamento, aprender `gridPos`/`fieldConfig`/`uid` do datasource na tentativa e erro |
| 6 | Alerta: baseline + regra + provar os dois comportamentos | 1,5 h | **2,25 h** | ⚠️ **`rule_files` ausente: +0,5 a 1 h.** Mais ~10 min de espera por rodada de teste (3 min de normal + cenario-a), repetidos a cada recalibragem |
| 7 | Investigação + `incidente.md` + reescrever o README (3 seções + tabela) | 2,0 h | **3,0 h** | ⚠️ **Estoura.** É redação técnica longa. A captura de tela e a tabela de equivalências entram aqui |
| 8 | Percorrer os 23 critérios do zero, seguindo só o próprio README | 0,75 h | **1,0 h** | `down -v`, subir, rodar os dois cenários de novo, conferir um a um |
| | **Total** | **10,75 h** | **~16,5 h** | |

Descontando o overhead de rebuild que aparece diluído nas etapas 2-4 (~0,75 h) e assumindo
que a pessoa não trave feio em nenhum ponto, o **caminho realista fica em ~13h30 a 14h**;
o pessimista, com o aluno preso no `rule_files` e no export do Grafana, passa de 16h.

### Cabe em 10 horas?

**Não.** Nem no cenário otimista, que já bate 10h45 **assumindo que nada dê errado** — e
esse cenário pressupõe que a pessoa não caia no `rule_files` ausente nem no export do
Grafana, que são as duas armadilhas mais prováveis do desafio.

**Ficou em ~13h30 no caminho realista.** É uma melhora enorme sobre as 21-25h da primeira
versão — a instrumentação pela metade funcionou —, mas ainda é **35% acima do alvo**.

**Quais etapas estouram:** a 5 (dashboard, 3h para algo que não ensina observabilidade),
a 7 (relatório + README, 3h de redação) e a 6 (alerta, inflada por um bug do starter).

### O que cortar para caber, em ordem de menor perda de aprendizado

Em ordem: os primeiros cortam tempo sem tocar em aprendizado nenhum; os últimos já doem.

| # | Corte | Economia | Perda de aprendizado |
|---|---|---|---|
| 1 | **Corrigir o `rule_files` no `prometheus.yml` do starter** | **0,5-1,0 h** | **Zero.** É bug, não conteúdo |
| 2 | **Montar `./src:/app/src` como volume no `compose.yaml`** | **0,75 h** | **Zero.** É espera |
| 3 | **Entregar um esqueleto de dashboard JSON com 1 painel pronto**, cabeado no `uid` do datasource, e pedir os outros 3 | **1,5-2,0 h** | **Quase zero.** O aprendizado do requisito 4 é *quais* painéis respondem *quais* perguntas — isso fica intacto. O que some é arqueologia de schema do Grafana |
| 4 | **Cortar a tabela de equivalências do README** | **0,5 h** | **Baixa.** É pesquisa de nome de pacote. Se quiser manter o espírito, vire uma frase: "diga qual biblioteca você usou para cada pilar" |
| 5 | **Reduzir o README entregável de 3 seções para 2** (`## Como rodar` + `## Decisões e limiares`) | **0,5 h** | **Baixa.** `## Decisões e limiares` é onde o entendimento aparece e deve ficar |
| 6 | **Tornar a imagem opcional** no `incidente.md` (ou adicionar o `grafana-image-renderer`) | **0,25 h** | **Baixa.** A evidência forte é o `trace_id` e a PromQL, não o PNG |
| 7 | **Enxugar o enunciado em ~80 linhas** (os seis "Por quê", as 4 repetições de "não corrija o defeito", "Tecnologias obrigatórias") | **0,4 h** | **Baixa** — desde que o "por quê" do requisito 3 seja reescrito, não só encurtado (hoje ele entrega o defeito) |

**Soma dos cortes 1 a 7: ~4h a 5h.** Isso leva o realista de ~13h30 para **~9h**, dentro
do alvo, **sem tirar um único requisito**. Os cortes 1, 2 e 3 sozinhos já valem ~3h.

Se ainda assim precisar cortar mais, o próximo seria reduzir os 23 critérios eliminatórios
— não porque sejam ruins, mas porque a etapa 8 (conferir tudo do zero) custa 1h e é
integralmente burocracia.

**O que eu não cortaria de jeito nenhum:** a travessia da fila (requisito 2), a calibragem
do alerta contra o baseline medido (requisito 5) e a explicação do custo da cardinalidade
em produção. São os três pontos onde o desafio ensina algo que o aluno leva embora.

---

## 10. As três coisas

Se eu pudesse mudar só três coisas antes de isto ir para os alunos:

### 1. Mover o defeito para fora do arquivo que o requisito 1 obriga a abrir

**Porque hoje o requisito 6 não funciona.** O README manda o aluno começar pela correlação
de log (passo 2), a correlação exige `pedido_id` nas linhas do worker, isso exige abrir
`src/worker/index.ts`, e o defeito está lá — oito linhas consecutivas, visíveis numa tela,
no padrão mais reconhecível que existe (`let x = false` + `catch` mudo + ternário). Eu
entendi o defeito **dez minutos depois de começar a escrever código**, sem telemetria
nenhuma no ar.

Isso não é falta de disciplina do aluno: é o caminho que o próprio enunciado prescreve. E
faz o requisito 6 — "o requisito que separa quem instrumentou de quem entendeu" — virar
redação sobre uma resposta já conhecida. O passo 7 pede para não procurar a resposta no
código; os passos 2 e 3 tornam isso impossível.

**Como:** extrair o `try/catch` de `processarMensagem` para um módulo que o requisito 1 não
obrigue a tocar (`pagamento.ts`, ou um `conciliacao.ts` novo), deixando em `index.ts`
apenas `const status = await decidirStatus(mensagem)`. **20 minutos de refactor no
starter.** É o melhor retorno deste relatório inteiro.

**Complemento no mesmo espírito, custo zero:** tirar do requisito 3 a frase *"Recusa e
falha não são a mesma coisa, e tratar as duas como uma só é o caminho mais curto para não
achar a queixa"* — que é o defeito escrito por extenso —, e cortar da pista a frase *"A
resposta está no que o código sabe e hoje não conta a ninguém"*, que descreve a causa em
vez do sintoma. As duas primeiras frases da pista bastam e são ótimas.

### 2. Consertar as duas armadilhas que custam ~2h e não ensinam nada sobre observabilidade

Duas linhas de configuração e um arquivo de exemplo devolvem ~2 horas ao orçamento de 10h.

**a) `rule_files` no `prometheus.yml`.** O arquivo é declarado "já configurado" na
estrutura do entregável e **não tem a seção que faz o Prometheus ler `prometheus/regras/`**.
O sintoma é silencioso: regra escrita, arquivo no lugar, `/rules` vazio, nenhum erro em
lugar nenhum. Achei em 10 minutos porque sei onde procurar; um aluno perde **30-60 min**
investigando a sintaxe da própria regra, convencido de que o erro é dele — porque o
enunciado garantiu que aquele arquivo estava pronto.

**b) O esqueleto do dashboard.** Escrever JSON de dashboard do Grafana à mão é a
dificuldade **mais alta** do desafio, e é 100% trivia de ferramenta. Pior: o caminho
natural (montar na UI e exportar) produz `__inputs` e `${DS_PROMETHEUS}`, que **quebram o
provisionamento por arquivo** com um "Datasource not found" indecifrável. **1,5-2h**
perdidas em arqueologia de schema.

**Como:** acrescentar as 2 linhas de `rule_files` ao starter (ou marcar o `prometheus.yml`
como "(você completa)" na estrutura, se a intenção for didática) e entregar um
`dashboard-exemplo.json` com **um** painel funcionando, com `uid` de datasource correto,
pedindo que o aluno acrescente os outros três. O aprendizado do requisito 4 — *quais*
painéis respondem *quais* perguntas — fica intacto.

**Enquanto isso, de graça:** montar `./src:/app/src` como volume no `compose.yaml` (o
projeto já usa `tsx`) elimina ~45 min de rebuild puro.

### 3. Consertar os três critérios eliminatórios que podem reprovar entrega correta

O enunciado abre com *"Todos os critérios são eliminatórios: qualquer item não atendido
reprova a entrega."* Com essa regra, **três dos 23 não podem ficar como estão** — cada um
reprova, por motivo alheio à competência do aluno:

- **Critério 1** (`logs api | grep '"msg"' | tail -1 | jq .` traz `trace_id`): depende de a
  **última linha** do log ter nascido dentro de um span. Sem tráfego recente, é a linha de
  subida, que não tem trace. Eu passo porque decidi emitir `trace_id: ""` sempre; quem
  tomar a decisão oposta e igualmente defensável — omitir o campo fora de span, que é o que
  a maioria das bibliotecas faz — **reprova por sorte de timing**. *Correção: dizer no
  requisito 1 que os campos devem estar presentes mesmo fora de span, ou trocar o comando
  por um que filtre uma linha de pedido.*

- **Critério 20** (`## Causa raiz` cita arquivo e linha "coincidindo com o gabarito"): a
  instrumentação obrigatória empurra o defeito de `src/worker/index.ts:53` para `:90`.
  Nenhuma das duas respostas é errada e o enunciado não diz qual vale. *Correção: dizer
  "linha do repositório base", ou trocar "linha" por "função/bloco".*

- **Critério 23** (`git diff` em `src/` mostra "apenas linhas de instrumentação"):
  envolver um bloco num `startActiveSpan` **reindenta o código inteiro**, e o `git diff`
  marca as linhas originais como removidas e readicionadas — inclusive o próprio ternário
  do defeito. Um corretor olhando o diff cru pode concluir que o aluno mexeu no fluxo.
  *Correção: especificar `git diff -w` no critério.*

Somo aqui, por ser da mesma família: o **critério 14** ("os painéis respondem às três
perguntas") é subjetivo e não tem comando que dê o check — eu me protegi colando a
pergunta literal no título, o que é uma resposta ao critério, não ao problema. E o
**critério 1 usa `jq`**, que não está nos pré-requisitos do README (não existe na minha
máquina).

---

## Apêndice: o que funcionou sem atrito

Curto de propósito, como pedido — mas real, e não deve ser mexido:

- A stack sobe de primeira com `cp .env.example .env && docker compose up -d`. Nove
  serviços, healthchecks corretos, seed ordenado, ~90s. Raro.
- A seção "O que já está instrumentado" bate item por item com a realidade.
- O `normal` produz **zero** falhas e `confirmados == aprovadas` na unidade; o `cenario-a`
  reproduz a queixa em ~15s. Cenários de carga excelentes.
- O starter foi desenhado para ser estendido: `consumirPedido` devolve
  `Record<string, unknown>`, `medirRequisicoes` está isolado, `log.ts` é minúsculo.
- O bootstrap do OTel pronto elimina a classe de erro mais frustrante e menos didática de
  OTel em Node.
- Exigir que o aluno **explique em uma frase** por que a cardinalidade derrubaria um
  Prometheus é o melhor micro-requisito do desafio.
- Exigir baseline medido antes do limiar, e provar silêncio **e** disparo, é a forma certa
  de ensinar alerta.
- O `receptor-alertas` como prova objetiva de disparo, em vez de "abra o Alertmanager e
  veja", elimina ambiguidade na correção.
