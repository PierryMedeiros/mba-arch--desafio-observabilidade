Projeto: MBA Arquitetura Full Cycle - Observabilidade
Fase do projeto: A instrumentação pela metade

# A instrumentação pela metade

Alguém do time começou a instrumentar a aplicação e parou no meio. O que ficou de pé não responde a pergunta que o negócio está fazendo

## Descrição

Você vai receber uma aplicação em TypeScript com dois processos e uma instrumentação inacabada. Existe tracing automático, existe log em JSON, existe uma rota de métricas, existe Prometheus coletando. E nada disso serve para responder a única pergunta que o negócio fez, porque a instrumentação parou justamente antes das partes que dão sentido a ela.

Seu trabalho é terminar o serviço e depois usá-lo. Terminar significa ligar o log ao trace, fazer o contexto atravessar a fila, consertar um erro de cardinalidade que já está plantado nas métricas, criar as métricas que faltam, montar o dashboard e escrever o alerta. Usar significa pegar a queixa que chegou do financeiro e provar a causa raiz com evidência.

## Cenário

Você entrou no time de plataforma de uma loja online. O sistema roda em produção e alguém, meses atrás, adicionou observabilidade nele e não terminou. O Jaeger mostra spans de rota e de banco, o log sai em JSON, o Prometheus está coletando. Parece que tem tudo.

Aí o financeiro fechou o mês e faltou dinheiro. Cruzaram os pedidos que aparecem confirmados para o cliente com o que efetivamente entrou, e encontraram pedidos confirmados que nunca foram cobrados. Alguém abriu o Grafana, não achou nada, e a resposta que circula pelo Slack é que deve ser problema do banco. Você foi contratado para acabar com o palpite.

## Sobre o foco do desafio

O foco é observabilidade, não desenvolvimento de produto e não performance. A aplicação vem pronta e funcional, e o seu trabalho é completar a instrumentação dela e configurar o que falta na stack.

Você não deve corrigir o defeito da aplicação. Ele é o objeto de estudo: é o que a sua instrumentação precisa revelar. Corrigir faz o cenário de carga parar de reproduzir a queixa, e o alerta que deveria disparar não dispara mais.

## Sobre pesquisar fora do que foi ensinado

O curso ensinou observabilidade em Java, com Actuator, Micrometer e o bridge do OpenTelemetry. Este desafio é em TypeScript, e isso é deliberado. Observabilidade é especificação, não framework: span continua sendo span, propagação continua sendo W3C Trace Context, e cardinalidade alta continua derrubando Prometheus em qualquer stack. O que muda é o nome do pacote e a sintaxe.

Parte do trabalho é descobrir na documentação o equivalente em Node de cada coisa que o professor fez em Java, e por isso o README tem uma tabela de equivalências como entregável. Você não precisa saber TypeScript de antemão: a aplicação vem funcionando e o trabalho é completar código que já existe.

## Repositório base

https://github.com/devfullcycle/REPO-A-DEFINIR

Faça o fork e trabalhe nele. A entrega final fica na branch `main` do seu fork.

```
cp .env.example .env
docker compose up -d
curl -s localhost:8080/health
```

Isso sobe a `api`, o `worker`, o Postgres, o Redis e a stack de observabilidade inteira, já parcialmente configurada.

## Contexto

### A aplicação

Um único projeto TypeScript, dois processos com o mesmo código-fonte e entrypoints diferentes, um Postgres e um Redis.

`api` na porta 8080, com quatro rotas de negócio:

- `GET /produtos` lista produtos e `GET /produtos/:id` devolve um produto, ou 404
- `POST /pedidos` recebe `{cliente_id, itens: [{produto_id, quantidade}]}`, grava o pedido como `pendente`, publica na fila `pedidos` do Redis e devolve 202 com `{pedido_id, status}`
- `GET /pedidos/:id` devolve o pedido, ou 404

Além delas, `GET /health` e `GET /metrics`.

`worker` na porta 8081, que expõe apenas `/health` e `/metrics`. Consome a fila `pedidos`, chama o processador de pagamento simulado e atualiza o pedido para `confirmado` ou `recusado`. O processador é uma função local, sem chamada externa, e o resultado depende do cliente: ele pode aprovar, recusar ou falhar.

O Postgres sobe com produtos já carregados. Use `GET /produtos` para obter identificadores válidos.

### O que já está instrumentado

Este é o ponto de partida. Confira cada item com os próprios olhos antes de começar, porque o desafio inteiro parte daqui.

- **Tracing automático funcionando.** O SDK do OpenTelemetry já sobe nos dois processos, com auto instrumentação de HTTP e de banco, exportando por OTLP para o Jaeger com amostragem em 100%. Uma requisição já vira trace com spans de rota e de consulta
- **Log em JSON.** Os dois processos já escrevem uma linha JSON por evento no stdout, com os campos `timestamp`, `level`, `service` e `msg`. Não existe nenhum campo que ligue a linha a um trace
- **Rota `/metrics` com `prom-client`.** Já existem as métricas padrão do processo e um histograma de latência HTTP chamado `http_request_duration_seconds`. Não existe nenhuma métrica de negócio
- **Prometheus coletando.** Os dois processos já aparecem como `UP` em `http://localhost:9090/targets`
- **Grafana com datasources.** Prometheus e Jaeger já provisionados por arquivo. A pasta de dashboards está vazia
- **Alertmanager ligado ao receptor.** A rota e o receiver já apontam para o `receptor-alertas`. Não existe nenhuma regra de alerta

### O que não está

Sem correlação entre log e trace. Sem span de negócio nenhum. Sem propagação de contexto pela fila, então o que a `api` faz e o que o `worker` faz aparecem como dois traces separados. Sem métrica de negócio. Sem dashboard. Sem regra de alerta.

E tem um problema plantado na instrumentação de métricas que já existe, que o requisito 3 trata.

### O gerador de carga

```
docker compose run --rm carga normal
docker compose run --rm carga cenario-a
```

Cada cenário roda até você interromper com Ctrl+C, e aceita `-d` para ficar em segundo plano. O `normal` é o tráfego saudável, com aprovações e recusas legítimas, e a queixa não se manifesta nele: é contra ele que você calibra o alerta. O `cenario-a` reproduz a queixa, e leva menos de um minuto para isso acontecer.

### O receptor de alertas

`http://localhost:9099`, um serviço mínimo que recebe webhook do Alertmanager e registra no stdout tudo que chega. É a sua prova de que o alerta disparou. Não instrumente esse serviço.

## A queixa

**"Fechamos o mês e faltou dinheiro."** O financeiro cruzou os pedidos que aparecem como confirmados para o cliente com o que efetivamente entrou, e encontrou pedidos confirmados que nunca foram cobrados. Reproduz com `cenario-a`.

Pista: do lado de fora está tudo 2xx, o cliente recebe sucesso e o pedido aparece confirmado. Monitoramento de caixa preta não enxerga isso, e é por isso que o Grafana não mostrou nada. A resposta está no que o código sabe e hoje não conta a ninguém.

## Tecnologias obrigatórias

Todas já estão no projeto e no `compose.yaml`: Node 20 com TypeScript, `prom-client` para métricas, OpenTelemetry SDK for Node para tracing, Prometheus, Grafana, Jaeger e Alertmanager. É proibido substituir qualquer componente por serviço de terceiros, porque a entrega roda inteira na máquina do avaliador.

## Requisitos

### 1. Correlacionar log com trace

Por quê. Log e trace hoje são duas ilhas. Você tem o trace de uma operação e não tem como achar as linhas de log dela, e tem a linha de log de um erro e não tem como achar o trace onde ele aconteceu. Essa ponte é a espinha da observabilidade, e é a primeira coisa que falta aqui.

Tarefa. Acrescente a toda linha de log dos dois processos os campos `trace_id` e `span_id`, com esses nomes exatos, preenchidos a partir do span ativo no momento em que a linha é escrita. Linhas relacionadas a um pedido carregam também `pedido_id`.

O identificador tem que ser o mesmo que aparece no Jaeger. Identificador próprio, gerado pela aplicação e desconectado do trace, não atende.

### 2. Tracing manual e travessia da fila

Por quê. A auto instrumentação entrega os limites técnicos, que são rota e consulta, e não entrega os limites de negócio. E ela não atravessa fila: hoje o que a `api` faz e o que o `worker` faz são dois traces sem relação, então não existe forma de olhar um pedido confirmado e ver o que aconteceu na cobrança dele.

Tarefa. Duas coisas.

- Crie dois spans manuais, com estes nomes exatos: `pedido.criar` no `POST /pedidos` e `pedido.processar` no consumo da mensagem pelo worker. Ambos com atributos úteis para diagnóstico, incluindo o identificador do pedido
- Faça o contexto de trace atravessar a fila, injetando na publicação e extraindo no consumo, de modo que um `POST /pedidos` e o processamento dele formem um único trace com um único `trace_id`

Além disso, toda exceção capturada pelo código passa a ser registrada no span, com o status do span indo para erro, e a produzir uma linha de log de nível `error` com o motivo. O fluxo da aplicação continua exatamente o mesmo: você só passa a contar o que acontece.

### 3. Métricas

Por quê. O histograma que já existe comete o erro de cardinalidade mais clássico que existe, e é por isso que ele está aqui. Métrica com label de valor ilimitado cria uma série nova por valor, e o custo não aparece em teste: aparece em produção, semanas depois, quando o Prometheus começa a consumir memória sem explicação. E métrica de infraestrutura sozinha não conta a história do negócio: o sistema pode estar com 100% de disponibilidade e sangrando dinheiro.

Tarefa. Três coisas.

- Encontre o erro de cardinalidade na instrumentação de métricas existente, corrija, e explique no README em uma frase por que aquilo derrubaria um Prometheus em produção
- Crie três métricas de negócio, com estes nomes e tipos exatos: `pedidos_criados_total` e `pedidos_confirmados_total`, contadores, e `cobrancas_processadas_total`, contador com o label `resultado`, que assume os valores `aprovada`, `recusada` e `falha`. Recusa e falha não são a mesma coisa, e tratar as duas como uma só é o caminho mais curto para não achar a queixa
- Inicialize os três contadores em zero na subida, incluindo cada valor do label `resultado`. Série que só nasce no primeiro evento some do gráfico enquanto está tudo bem e quebra o alerta que dependia dela

A proibição de cardinalidade vale para métrica. Em span e em log o identificador é bem-vindo e necessário, porque lá ele custa barato e é o que permite achar o caso individual.

### 4. Dashboard

Por quê. Dashboard construído na mão dentro do Grafana morre com o container: não é versionado, não é revisado, ninguém sabe quem mudou o quê. E dashboard eficaz não é o que mostra tudo, é o que cabe numa tela e responde as perguntas que alguém vai fazer às três da manhã.

Tarefa. Um dashboard, provisionado por arquivo JSON versionado no repositório, com no máximo quatro painéis, que responda estas três perguntas:

- o sistema está com erro?
- o sistema está lento?
- o dinheiro está entrando?

Quais painéis usar para responder é decisão sua. Todo painel com título que diz o que ele mostra.

### 5. Alerta

Por quê. Regra de alerta que nunca foi vista disparando é YAML de decoração, e alerta mal calibrado é pior que alerta nenhum, porque ensina o time a ignorar notificação. As duas falhas se provam com o mesmo teste: ficar quieto quando o sistema está saudável e gritar quando não está.

Tarefa. Escreva no Prometheus uma regra chamada exatamente `FalhaEmCobrancas`, que detecte a queixa.

- Atenção: nem toda falha aparece como erro HTTP na borda. A regra precisa ser escrita sobre o sinal que de fato revela a queixa, e descobrir qual é esse sinal é parte do trabalho
- `for` entre 30s e 1m. É um limite do desafio, para o disparo ser observável durante a correção
- O Alertmanager já está apontando para o `receptor-alertas`, mas o `group_wait` padrão dele soma mais tempo até o webhook sair. Ajuste se precisar, e saiba que ele existe antes de achar que a sua regra está quebrada
- O limiar é decisão sua. O README traz o valor observado no cenário `normal`, o limiar escolhido e o `for`
- Comportamento exigido: a regra não dispara no cenário `normal` e dispara no `cenario-a`

### 6. Diagnóstico e README

Por quê. Este é o requisito que separa quem instrumentou de quem entendeu. A instrumentação existe para responder pergunta, e a prova de que ela funciona é ela responder a pergunta que o financeiro fez, com evidência que outra pessoa consegue reproduzir.

Tarefa. Investigue a queixa usando a sua instrumentação e escreva `reports/incidente.md` com exatamente estas quatro seções, com estes títulos:

- `## Sintoma`: a queixa em uma frase e como reproduzir
- `## Evidência`: um `trace_id` real observado no Jaeger, a query PromQL usada, o comando de busca no log usado, e ao menos uma imagem de painel ou tela
- `## Causa raiz`: o que causa o comportamento, citando arquivo e número de linha
- `## Correção sugerida`: o que você faria para resolver, sem fazer

E substitua o `README.md` do projeto base por um com estas três seções, com estes títulos:

- `## Como rodar`: do clone à stack no ar
- `## Equivalências com o curso`: tabela com quatro linhas, uma para métricas, uma para tracing, uma para logs estruturados e uma para propagação de contexto, dizendo o que o curso usou em Java e o que você usou em TypeScript
- `## Decisões e limiares`: a explicação do erro de cardinalidade, o que cada métrica de negócio responde, e o valor observado no `normal`, o limiar e o `for` do alerta

## Restrições (não negociáveis)

- Você completa a instrumentação. Não altera comportamento funcional, não muda o contrato das rotas existentes e não corrige o defeito da aplicação
- Escrever dentro de um bloco que hoje não registra nada é instrumentação, não correção, e é esperado que você faça isso
- Não altere a pasta `carga/` nem a pasta `receptor-alertas/`
- Nenhum componente da stack pode ser substituído por serviço de terceiros
- Dashboard entra por arquivo versionado. Você pode montar o painel pela interface do Grafana para experimentar, mas o que conta é o JSON versionado, e o ambiente subindo do zero tem que trazer tudo pronto sem nenhum clique
- Nenhuma credencial nova em arquivo versionado. O que precisar de valor vem do `.env`

## Fora de escopo

- Corrigir o defeito da aplicação
- Agregação centralizada de log. O log fica em JSON no stdout e a correlação se prova por linha de comando
- OpenTelemetry Collector e Pushgateway. A exportação é direta e a coleta é por pull
- Exporters de infraestrutura. O foco é a instrumentação da aplicação
- Instrumentar o `receptor-alertas` ou o gerador de carga
- Integração com Slack, e-mail ou qualquer canal externo. O `receptor-alertas` é o destino

## Critérios de Aceite

Todos os critérios são eliminatórios: qualquer item não atendido reprova a entrega. Cada um traz o comando ou a tela que dá o check, a partir de um clone limpo do seu fork, com a stack no ar e com o cenário de carga que o próprio critério indicar.

Logs

☐ `docker compose logs api | grep '"msg"' | tail -1 | jq .` devolve JSON com `timestamp`, `level`, `service`, `msg`, `trace_id` e `span_id`, e o mesmo vale para `worker`
☐ Linhas relacionadas a um pedido trazem `pedido_id`
☐ Rodando `cenario-a`, aparecem linhas de nível `error` com o motivo da falha

Tracing

☐ Um `POST /pedidos` aparece no Jaeger como um trace único que contém spans da `api` e do `worker`
☐ Esse mesmo trace contém os spans `pedido.criar` e `pedido.processar`
☐ Rodando `cenario-a`, existe no Jaeger ao menos um trace com span marcado como erro
☐ O `trace_id` de um trace do Jaeger, buscado com `docker compose logs api worker`, devolve linhas dos dois processos

Métricas

☐ Nenhuma série de `http_request_duration_seconds` usa caminho concreto no lugar do template. `/produtos/:id` está correto, `/produtos/42` reprova
☐ Nenhuma série usa identificador de pedido ou de cliente como label
☐ As saídas de `/metrics` dos dois processos, somadas, contêm `pedidos_criados_total`, `pedidos_confirmados_total` e `cobrancas_processadas_total`, esta última com o label `resultado` nos valores `aprovada`, `recusada` e `falha`
☐ Os três contadores existem já na subida, antes de qualquer tráfego

Dashboard

☐ Existe exatamente um dashboard provisionado por arquivo JSON versionado, e ele abre no Grafana logo após a subida, sem nenhum clique de configuração
☐ Tem no máximo quatro painéis, nenhum com título vazio ou igual a `Panel Title`
☐ Os painéis respondem às três perguntas do requisito 4

Alerta

☐ `http://localhost:9090/rules` exibe `FalhaEmCobrancas`, carregada sem erro e com `for` entre 30s e 1m
☐ Com o cenário `normal` rodando por 3 minutos após `docker compose restart receptor-alertas`, nenhum alerta aparece em `docker compose logs receptor-alertas`
☐ Rodando `cenario-a`, `FalhaEmCobrancas` aparece no log do `receptor-alertas` em até 3 minutos

Diagnóstico e README

☐ Existe `reports/incidente.md` com as quatro seções exigidas, com os títulos exatos
☐ O relatório cita um `trace_id`, uma query PromQL, um comando de busca no log e traz ao menos uma imagem
☐ A seção `## Causa raiz` cita arquivo e linha, e ambos coincidem com o gabarito de correção
☐ O `README.md` tem as três seções exigidas, com os títulos exatos, e a tabela de equivalências está preenchida com o que foi usado de fato no código

Integridade

☐ `git diff` contra o repositório base não mostra alteração em `carga/` nem em `receptor-alertas/`
☐ `git diff` contra o repositório base em `src/` mostra apenas linhas de instrumentação, sem alteração no fluxo da aplicação

## Estrutura obrigatória do entregável

```
.
├── README.md                     (substituído por você)
├── compose.yaml
├── .env.example
├── src/
│   ├── api/                      você completa a instrumentação
│   ├── worker/                   você completa a instrumentação
│   ├── telemetria/               bootstrap do OTel, logger e métricas
│   └── ...
├── carga/                        (não alterar)
├── receptor-alertas/             (não alterar)
├── prometheus/
│   ├── prometheus.yml            já configurado
│   └── regras/                   (você preenche)
├── alertmanager/
│   └── alertmanager.yml          já configurado
├── grafana/
│   └── provisioning/
│       ├── datasources/          já configurado
│       └── dashboards/           (você preenche)
└── reports/
    └── incidente.md              (você escreve)
```

## Entrega

- Link do fork público no GitHub, com tudo consolidado na branch `main`
- README com as três seções obrigatórias, verificado do zero
- O relatório em `reports/`, com a imagem de evidência versionada no repositório
- A base é obrigatória. Entregas que reescrevem a aplicação, trocam a stack ou corrigem o defeito não serão aceitas

## Ordem de execução sugerida

**1.** Suba o ambiente e explore o que já existe antes de escrever qualquer linha. Faça um pedido, abra o trace no Jaeger, leia uma linha de log, olhe a saída de `/metrics` e os alvos no Prometheus. Metade do desafio é entender onde a instrumentação atual para.

**2.** Comece pela correlação de log com trace. É a peça mais barata e a que mais muda o seu dia dali em diante: sem ela, você vai depurar o resto no escuro. Só considere pronto quando conseguir pegar um `trace_id` no Jaeger e achar as linhas dos dois processos por aquele identificador.

**3.** Faça os spans manuais e depois a travessia da fila. Este é o ponto mais difícil do desafio. O contexto de trace não é mágica do framework, é dado que precisa viajar junto com a mensagem, e o OpenTelemetry tem uma API própria de propagação para isso. Se ao consumir a mensagem você começar um trace novo em vez de continuar o que existia, o sintoma é claro: dois traces curtos no Jaeger em vez de um completo. E preste atenção em qual contexto você usa como base ao extrair, porque usar o contexto ativo do worker em vez de um contexto raiz é o erro que faz o span nascer no lugar errado.

**4.** Ataque as métricas: conserte a cardinalidade primeiro, porque ela suja tudo que vem depois, e só então crie as de negócio.

**5.** Monte o dashboard por arquivo. Derrube tudo com `docker compose down -v`, suba de novo e confirme que os painéis voltaram sozinhos.

**6.** Colete o baseline com o cenário `normal` e anote os números, porque é ele que justifica o limiar. Só então escreva a regra e prove os dois comportamentos: silêncio no normal e disparo no `cenario-a`.

**7.** Investigue a queixa e escreva o relatório, capturando as evidências enquanto investiga. Resista ao impulso de procurar a resposta lendo o código: se ela vier do código e não da telemetria, você não provou nada, só confirmou um palpite, que é o que a empresa já fazia antes de você chegar.

**8.** Percorra os critérios de aceite item a item, do zero, seguindo só o seu README, antes do push final.