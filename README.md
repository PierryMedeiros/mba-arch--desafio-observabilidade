Projeto: MBA Arquitetura Full Cycle - Observabilidade
Fase do projeto: Sala de Guerra: instrumentar para diagnosticar

# Sala de Guerra: instrumentar para diagnosticar

Duas queixas do negócio, nenhuma evidência, e uma aplicação que não conta nada sobre si mesma

## Descrição

Você vai receber uma aplicação em TypeScript com dois processos, funcional e completamente cega, e vai construir sobre ela a camada de observabilidade: logs estruturados e correlacionados, métricas, tracing distribuído, dashboard e alertas.

Construir a instrumentação é metade do trabalho. A outra metade é usá-la. A aplicação tem dois defeitos plantados que produzem duas queixas reais do negócio, e nenhum dos dois é diagnosticável olhando o código de fora ou lendo o log de texto solto que existe hoje. No fim, você entrega a instrumentação funcionando e um relatório por incidente provando a causa raiz com evidência: o trace, a query, o painel, a linha de log. O desafio inteiro cabe em uma frase: instrumentar uma aplicação cega até que ela responda, sozinha, duas perguntas que hoje ninguém sabe responder.

## Cenário

Você entrou no time de plataforma de uma loja online. O sistema roda em produção, dá dinheiro, e ninguém enxerga nada dele. O que existe é `console.log` cuspindo texto solto no stdout dos dois processos, sem formato e sem nada que ligue uma linha da API à linha correspondente do worker. Não existe rota de métricas, tracing, dashboard nem alerta: quando alguém reclama, o time roda `docker compose logs`, dá `grep` e adivinha. Nas últimas semanas chegaram duas queixas de áreas diferentes da empresa, ninguém consegue provar a causa de nenhuma delas, e você foi contratado para acabar com o palpite.

## Sobre o foco do desafio

O foco é observabilidade, não desenvolvimento de produto e não performance. A aplicação vem pronta e funcional, e o seu trabalho é adicionar instrumentação a ela e configurar a stack de coleta e visualização, que já sobe no `compose.yaml` e vem inteiramente desconfigurada.

Você não deve corrigir os defeitos. Eles são o objeto de estudo: são o que a sua instrumentação precisa revelar. Corrigir um defeito faz o cenário de carga correspondente parar de reproduzir a queixa, e o alerta que deveria disparar não dispara mais.

## Sobre pesquisar fora do que foi ensinado

O curso ensinou observabilidade em Java, com Actuator, Micrometer e o bridge do OpenTelemetry. Este desafio é em TypeScript, e isso é deliberado.

Observabilidade é especificação, não framework. OpenTelemetry é um padrão com a mesma semântica em qualquer linguagem: span continua sendo span, propagação continua sendo W3C Trace Context, histograma continua precisando de bucket para render percentil, e cardinalidade alta continua derrubando Prometheus em qualquer stack. O que muda entre Java e TypeScript é o nome do pacote e a sintaxe do bootstrap.

Parte do trabalho aqui é pesquisar: você vai descobrir na documentação qual é o equivalente em Node de cada coisa que o professor fez em Java. Isso é um dos objetivos do desafio, porque ninguém trabalha a vida inteira na linguagem em que aprendeu, e quem entendeu o conceito atravessa a troca de stack lendo documentação. Por isso o README tem um entregável específico, que é a tabela de equivalências entre as duas linguagens. Você não precisa saber TypeScript de antemão: a aplicação vem funcionando, e o trabalho é instrumentar código que já existe, não escrever features.

## Repositório base

https://github.com/devfullcycle/REPO-A-DEFINIR

Faça o fork e trabalhe nele. A entrega final fica na branch `main` do seu fork.

```
cp .env.example .env
docker compose up -d
curl -s localhost:8080/health
```

Isso sobe a `api`, o `worker`, o Postgres, o Redis e a stack de observabilidade inteira. Nesse estado a aplicação funciona e a stack está no ar sem coletar nada.

## Contexto

### A aplicação existente

Um único projeto TypeScript, dois processos com o mesmo código-fonte e entrypoints diferentes, um Postgres e um Redis.

`api` na porta 8080, com cinco rotas de negócio:

- `GET /produtos` lista produtos e `GET /produtos/:id` devolve um produto
- `POST /pedidos` recebe `{cliente_id, itens: [{produto_id, quantidade}]}`, grava o pedido como `pendente`, publica na fila `pedidos` do Redis e devolve 202 com `{pedido_id, status}`
- `GET /pedidos/:id` devolve o pedido
- `GET /relatorios/vendas` devolve o consolidado de vendas do período

Além delas, `GET /health` devolve 200 quando o processo está de pé.

`worker` na porta 8081, exposta apenas para `/health` e para a rota de métricas que você vai criar. Consome a fila `pedidos`, chama o processador de pagamento simulado e atualiza o pedido para `confirmado` ou `recusado`.

Outros fatos do ambiente:

- Observabilidade hoje: `console.log` com texto livre, sem formato e sem identificador que atravesse os processos. Nenhuma rota de métricas, nenhuma biblioteca de tracing, nenhuma variável de ambiente de telemetria
- O Postgres sobe com produtos já carregados. Use `GET /produtos` para obter identificadores válidos
- O processador de pagamento é simulado dentro do worker e o resultado depende do cliente: ele pode aprovar, recusar ou falhar. Não existe chamada para fora do ambiente

### O gerador de carga

O repositório traz o gerador de carga como serviço do compose. Ele é a fonte de verdade para reproduzir comportamento, e é o que o avaliador vai executar.

```
docker compose run --rm carga normal
docker compose run --rm carga cenario-a
docker compose run --rm carga cenario-b
```

Cada cenário roda até você interromper com Ctrl+C, e aceita `-d` para ficar em segundo plano. O cenário `normal` é o tráfego saudável: pedidos pequenos, sem consulta ao relatório de vendas, com aprovações e recusas legítimas. Nenhuma das duas queixas se manifesta nele, e é contra ele que você calibra os alertas. Os cenários `cenario-a` e `cenario-b` reproduzem, cada um, uma das duas queixas abaixo, na ordem em que elas aparecem, e manifestam o problema em menos de um minuto.

### A stack de observabilidade

Já declarada no `compose.yaml`, subindo, e desconfigurada:

- Prometheus em `http://localhost:9090`, com `prometheus/prometheus.yml` sem `scrape_configs`, sem `rule_files` e sem seção `alerting`
- Grafana em `http://localhost:3000`, credenciais no `.env.example`, com a pasta de provisionamento montada e vazia
- Jaeger em `http://localhost:16686`, recebendo OTLP em 4317 e 4318
- Alertmanager em `http://localhost:9093`, com `alertmanager/alertmanager.yml` numa configuração mínima que não entrega em lugar nenhum
- `receptor-alertas` em `http://localhost:9099`, serviço mínimo que recebe webhook e registra no stdout tudo que chega. É a sua prova de que o alerta disparou. Não instrumente esse serviço

## As duas queixas

Cada queixa tem uma pista, porque o objetivo é você descobrir a causa com instrumentação, não sofrer no escuro. Nenhuma pista entrega a causa raiz.

### Queixa 1: "o relatório de vendas demora uma eternidade"

O time comercial reclama que abrir o relatório de vendas leva muitos segundos. Reproduz com `cenario-a`.

Pista: o banco não está sobrecarregado e cada consulta isolada responde rápido. O problema não está na duração de uma coisa, está na quantidade de coisas, e nenhuma métrica agregada mostra quantidade dentro de uma requisição. Você precisa de uma requisição individual aberta em fatias.

### Queixa 2: "fechamos o mês e faltou dinheiro"

O financeiro cruzou os pedidos que aparecem como confirmados para o cliente com o que efetivamente entrou, e encontrou pedidos confirmados que nunca foram cobrados. Reproduz com `cenario-b`.

Pista: do lado de fora está tudo 2xx, o cliente recebe sucesso e o pedido aparece confirmado. Monitoramento de caixa preta não enxerga isso. A resposta está no que o código sabe e hoje não conta a ninguém.

## Tecnologias obrigatórias

- Docker e Docker Compose v2
- Node 20 ou superior e TypeScript, que são os do projeto base
- `prom-client` para métricas. É o análogo direto do Micrometer que o curso usou, e é obrigatório porque os critérios de aceite dependem das métricas padrão que ele expõe
- OpenTelemetry SDK for Node para tracing, exportando por OTLP
- Prometheus, Grafana, Jaeger e Alertmanager, que são os que já estão no `compose.yaml`

É proibido substituir qualquer componente da stack por serviço de terceiros. A entrega roda inteira na máquina do avaliador.

## Requisitos

### 1. Logs estruturados e correlacionados

Por quê. Log em texto livre é legível por humano e inútil para máquina: não filtra, não agrega e não liga o que aconteceu na API ao que aconteceu no worker na mesma operação.

Tarefa. Substitua a escrita de log dos dois processos por log estruturado em JSON, uma linha por evento, no stdout.

- Campos obrigatórios em toda linha, com estes nomes exatos: `timestamp`, `level`, `service`, `trace_id`, `span_id`, `msg`. O campo `service` vale exatamente `api` ou `worker`
- Linhas relacionadas a um pedido carregam também `pedido_id`
- O `trace_id` da linha é o mesmo identificador que aparece no Jaeger para aquela operação. Log com identificador próprio, desconectado do trace, não atende
- Toda exceção capturada pelo código produz uma linha de nível `error` com o motivo. Nenhuma falha pode passar em silêncio
- Nada de dado sensível na linha

### 2. Métricas

Por quê. Trace responde sobre uma operação e log responde sobre um evento. Nenhum dos dois responde como o sistema está agora comparado a vinte minutos atrás. E métrica de infraestrutura sozinha não conta a história do negócio: o sistema pode estar com 100% de disponibilidade e sangrando dinheiro.

Tarefa. Exponha métricas em formato Prometheus nos dois processos usando `prom-client`.

- Rota `/metrics` na `api` e no `worker`, com as métricas padrão do processo habilitadas nos dois
- Um histograma de latência HTTP na `api` com o nome exato `http_request_duration_seconds` e os labels `route`, `method` e `status`
- Proibido usar identificador de pedido, de cliente ou qualquer outro valor de alta cardinalidade como label de métrica
- Pela mesma razão, o label `route` recebe o template da rota, não o caminho concreto. `/produtos/:id` está correto, `/produtos/42` não. Esse é o erro clássico que derruba um Prometheus, e aqui ele reprova a entrega
- Três métricas de negócio, com estes nomes e tipos exatos: `pedidos_criados_total` e `pedidos_confirmados_total`, contadores, e `cobrancas_processadas_total`, contador com o label `resultado`, que assume os valores `aprovada`, `recusada` e `falha`
- Recusa e falha não são a mesma coisa, e tratar as duas como uma só é o caminho mais curto para não achar a queixa 2
- Os três contadores são inicializados em zero na subida, incluindo cada valor do label `resultado`. Série que só nasce no primeiro evento some do gráfico enquanto está tudo bem e quebra o alerta que dependia dela
- A restrição de cardinalidade vale para métrica. Em span e em log o identificador é bem-vindo e necessário, porque lá ele custa barato e é o que permite achar o caso individual

### 3. Tracing distribuído

Por quê. Uma operação que atravessa dois processos e uma fila é hoje uma caixa preta com três compartimentos. Sem trace você consegue afirmar que demorou, e não consegue afirmar onde. A pergunta da queixa 1 é literalmente "onde".

Tarefa. Instrumente os dois processos com OpenTelemetry, exportando por OTLP para o Jaeger, com amostragem em 100%.

- Auto instrumentação habilitada para HTTP e banco de dados. É ela que dá os spans de rota e de consulta sem você escrever um por um
- Instrumentação manual obrigatória em quatro pontos, e apenas estes quatro são exigidos: um span com o nome exato `pedido.criar` no `POST /pedidos`, um span com o nome exato `relatorio.vendas.montar` na montagem do `GET /relatorios/vendas`, um span com o nome exato `pedido.processar` no consumo da mensagem pelo worker, e a propagação do contexto pela fila, que é a injeção no publish e a extração no consumo
- Um `POST /pedidos` e o processamento dele pelo worker formam um único trace, com um único `trace_id`, atravessando a fila. Dois traces separados não atendem
- Toda exceção capturada é registrada no span, e o status do span vai para erro. O pedido continua seguindo o caminho que o código manda, você só passa a contar o que aconteceu
- Spans manuais com atributos úteis para diagnóstico, incluindo o identificador do pedido

### 4. Coleta e dashboard

Por quê. Instrumentação sem coleta é um endpoint que ninguém lê. E dashboard construído na mão dentro do Grafana morre com o container: não é versionado, não é revisado, ninguém sabe quem mudou o quê.

Tarefa. Configure a coleta e provisione o Grafana pelo repositório.

- `prometheus/prometheus.yml` com `api` e `worker` como alvos, os dois `UP`
- Datasources de Prometheus e Jaeger provisionados por arquivo versionado
- Um dashboard, provisionado por arquivo JSON versionado, com no máximo oito painéis. O limite é parte do exercício: dashboard eficaz é o que cabe em uma tela e responde as perguntas certas
- O dashboard cobre os quatro sinais de ouro e o negócio: latência p95 por rota, taxa de requisições, taxa de erro, saturação de memória dos dois processos, e as três métricas de negócio
- Todo painel com título que diz o que ele mostra

### 5. Alertas

Por quê. Regra de alerta que nunca foi vista disparando é YAML de decoração, e alerta mal calibrado é pior que alerta nenhum, porque ensina o time a ignorar notificação. As duas falhas se provam com o mesmo teste: ficar quieto quando o sistema está saudável e gritar quando não está.

Tarefa. Escreva as regras no Prometheus e configure o Alertmanager para entregá-las ao `receptor-alertas`.

- Duas regras, com estes nomes exatos: `AltaLatenciaRelatorio`, para a queixa 1, e `FalhaEmCobrancas`, para a queixa 2
- Atenção ao escrever a segunda: nem toda falha aparece como erro HTTP na borda. A regra precisa ser escrita sobre o sinal que de fato revela a queixa, e descobrir qual é esse sinal é parte do trabalho
- `for` entre 30s e 2m nas duas regras. É um limite do desafio, para o disparo poder ser observado durante a correção
- Prometheus com `rule_files` e seção `alerting` apontando para o Alertmanager, e `alertmanager/alertmanager.yml` com rota e receiver apontando para o webhook do `receptor-alertas`
- Os limiares são decisão sua. Para cada regra, o README traz três valores: o observado no cenário `normal`, o limiar escolhido e o `for`
- Comportamento exigido: nenhuma regra dispara no cenário `normal`, e cada regra dispara no cenário da sua queixa

### 6. Diagnóstico das duas queixas

Por quê. Este é o requisito que separa quem construiu observabilidade de quem construiu um painel bonito. A instrumentação existe para responder pergunta, e a prova de que ela funciona é ela responder as duas perguntas que o negócio fez, com evidência que outra pessoa consegue reproduzir.

Tarefa. Investigue as duas queixas usando exclusivamente a sua instrumentação e escreva `reports/incidente-1.md` para a queixa 1 e `reports/incidente-2.md` para a queixa 2. Cada relatório tem exatamente estas cinco seções, com estes títulos:

- `## Sintoma`: a queixa em uma frase e como reproduzir
- `## Investigação`: o caminho percorrido, incluindo as hipóteses descartadas e o que descartou cada uma
- `## Evidência`: um `trace_id` real observado no Jaeger, a query PromQL usada, o comando de busca no log usado, e as imagens dos painéis ou telas que sustentam a conclusão
- `## Causa raiz`: o que causa o comportamento, citando arquivo e número de linha
- `## Correção sugerida`: o que você faria para resolver, sem fazer

As duas causas são diferentes e se revelam por caminhos diferentes. Se as suas duas investigações usarem a mesma evidência, uma delas está errada.

### 7. README

Por quê. A entrega é lida por alguém que nunca viu o seu repositório e que vai executar exatamente o que estiver escrito. Se o roteiro não funcionar do zero, a entrega não existe.

Tarefa. Substitua o `README.md` do projeto base, com estas seções obrigatórias:

- `## Como rodar`: do clone à stack no ar, incluindo qualquer pré-requisito da sua solução
- `## Decisões técnicas`: bibliotecas escolhidas e por quê
- `## Equivalências com o curso`: tabela com quatro linhas, uma para métricas, uma para tracing, uma para logs estruturados e uma para propagação de contexto. Cada linha diz o que o curso usou em Java e o que você usou em TypeScript
- `## Métricas de negócio`: a pergunta que cada uma das três responde
- `## Alertas`: para cada regra, o valor observado no cenário `normal`, o limiar escolhido e o `for`

## Restrições (não negociáveis)

- Você adiciona instrumentação. Não altera comportamento funcional, não muda o contrato das rotas existentes e não corrige os defeitos plantados
- Não altere a pasta `carga/` nem a pasta `receptor-alertas/`
- Nenhum componente da stack pode ser substituído por serviço de terceiros
- Datasource e dashboard entram por arquivo versionado. Você pode montar o painel pela interface do Grafana para experimentar, mas o que conta é o JSON versionado, e o ambiente subindo do zero tem que trazer tudo pronto sem nenhum clique
- Nenhuma credencial em arquivo versionado, exceto o `.env.example`
- Se encontrar limitação real em alguma biblioteca, documente no README em vez de contornar mudando o comportamento da aplicação

## Fora de escopo

- Corrigir os dois defeitos
- Agregação centralizada de log. O log fica em JSON no stdout e a correlação se prova por linha de comando
- OpenTelemetry Collector e Pushgateway. A exportação é direta e a coleta é por pull
- Exporters de infraestrutura, como `node_exporter` ou `postgres_exporter`. O foco é a instrumentação da aplicação
- Autenticação, autorização e qualquer preocupação de segurança da aplicação
- Alta disponibilidade, retenção de longo prazo ou dimensionamento da stack
- Instrumentar o `receptor-alertas` ou o gerador de carga
- Testes automatizados
- Integração com Slack, e-mail ou qualquer canal externo. O `receptor-alertas` é o destino

## Critérios de Aceite

Todos os critérios são eliminatórios: qualquer item não atendido reprova a entrega. Cada um traz o comando ou a tela que dá o check, a partir de um clone limpo do seu fork, com a stack no ar e com o cenário de carga que o próprio critério indicar.

Logs

☐ `docker compose logs api --tail 1` e `docker compose logs worker --tail 1` devolvem JSON válido com `timestamp`, `level`, `service`, `trace_id`, `span_id` e `msg`, e o campo `service` vale `api` ou `worker`
☐ Rodando `cenario-b`, aparecem linhas de nível `error` com o motivo da falha

Métricas

☐ `curl -s localhost:8080/metrics` e `curl -s localhost:8081/metrics` devolvem métricas em formato Prometheus, com `process_resident_memory_bytes` nas duas saídas
☐ A saída da `api` contém séries `http_request_duration_seconds_bucket` com os labels `route`, `method` e `status`
☐ Nenhuma série tem `route` com caminho concreto no lugar do template. `route="/produtos/:id"` está correto, `route="/produtos/42"` reprova
☐ Nenhuma série usa identificador de pedido ou de cliente como label
☐ As duas saídas somadas contêm `pedidos_criados_total`, `pedidos_confirmados_total` e `cobrancas_processadas_total`, esta última com o label `resultado` nos valores `aprovada`, `recusada` e `falha`

Tracing

☐ Um `POST /pedidos` aparece no Jaeger como um trace único que contém spans da `api` e do `worker`
☐ Esse mesmo trace contém spans de consulta ao banco e os spans `pedido.criar` e `pedido.processar`
☐ Uma chamada a `GET /relatorios/vendas` aparece no Jaeger com o span `relatorio.vendas.montar`
☐ O `trace_id` desse trace, buscado com `docker compose logs api worker`, devolve linhas dos dois processos
☐ Rodando `cenario-b`, existe no Jaeger ao menos um trace com span marcado como erro

Coleta e dashboard

☐ `api` e `worker` aparecem como `UP` em `http://localhost:9090/targets`
☐ Os datasources de Prometheus e Jaeger vêm de arquivo versionado e aparecem no Grafana sem nenhum clique de configuração
☐ Existe exatamente um dashboard provisionado por arquivo JSON versionado, e ele abre no Grafana logo após a subida
☐ O dashboard tem no máximo oito painéis, nenhum com título vazio ou igual a `Panel Title`
☐ O dashboard tem painéis de latência p95 por rota, taxa de requisições, taxa de erro, saturação de memória dos dois processos e as três métricas de negócio

Alertas

☐ `http://localhost:9090/rules` exibe `AltaLatenciaRelatorio` e `FalhaEmCobrancas`, ambas carregadas sem erro e com `for` entre 30s e 2m
☐ `alertmanager/alertmanager.yml` tem rota e receiver apontando para o `receptor-alertas`
☐ Com o cenário `normal` rodando por 5 minutos após `docker compose restart receptor-alertas`, nenhum alerta aparece em `docker compose logs receptor-alertas`
☐ Rodando `cenario-a`, `AltaLatenciaRelatorio` aparece no log do `receptor-alertas`
☐ Rodando `cenario-b`, `FalhaEmCobrancas` aparece no log do `receptor-alertas`

Diagnóstico

☐ Existem `reports/incidente-1.md` e `reports/incidente-2.md`, cada um com as cinco seções exigidas, com os títulos exatos
☐ Cada relatório cita um `trace_id`, uma query PromQL e um comando de busca no log, e traz ao menos uma imagem
☐ A seção `## Causa raiz` de cada relatório cita arquivo e linha, e ambos coincidem com o gabarito de correção

README

☐ O `README.md` tem as cinco seções obrigatórias do requisito 7, com os títulos exatos
☐ A tabela de equivalências tem as quatro linhas exigidas, preenchidas com o que foi usado de fato no `package.json` e no código
☐ Para cada regra de alerta, o README traz o valor observado no cenário `normal`, o limiar e o `for`

Integridade

☐ `git diff` contra o repositório base não mostra alteração em `carga/` nem em `receptor-alertas/`
☐ Os dois defeitos continuam reproduzindo, o que os disparos dos dois alertas comprovam
☐ Nenhuma credencial em arquivo versionado, exceto o `.env.example`

## Estrutura obrigatória do entregável

```
.
├── README.md                     (substituído por você)
├── compose.yaml                  (você ajusta o que a instrumentação exigir)
├── .env.example
├── src/
│   ├── api/                      você instrumenta, não altera comportamento
│   ├── worker/                   você instrumenta, não altera comportamento
│   └── ...                       demais módulos compartilhados
├── carga/                        (não alterar)
├── receptor-alertas/             (não alterar)
├── prometheus/
│   ├── prometheus.yml            (você preenche)
│   └── regras/                   (você preenche)
├── alertmanager/
│   └── alertmanager.yml          (você preenche)
├── grafana/
│   └── provisioning/             (você preenche)
└── reports/
    ├── incidente-1.md            (você escreve)
    └── incidente-2.md            (você escreve)
```

## Entrega

- Link do fork público no GitHub, com tudo consolidado na branch `main`
- README com as cinco seções obrigatórias, verificado do zero
- Dois relatórios em `reports/`, com as imagens de evidência versionadas no repositório
- A base é obrigatória. Entregas que reescrevem a aplicação, trocam a stack ou corrigem os defeitos plantados não serão aceitas

## Ordem de execução sugerida

**1.** Suba o ambiente e use a aplicação na mão. Crie um pedido, abra o relatório de vendas e leia o log de texto que existe hoje para sentir a falta que ele faz.

**2.** Faça a pesquisa antes de codar. Levante os equivalentes em Node do que o curso mostrou em Java e já escreva a tabela de equivalências do README. Uma hora aqui economiza cinco depois.

**3.** Comece pelo tracing com auto instrumentação e confirme spans no Jaeger antes de qualquer outra coisa. Em seguida estruture os logs e amarre o `trace_id` real na linha: só considere pronto quando conseguir pegar um trace no Jaeger e achar as linhas dos dois processos por aquele identificador.

**4.** Feche o tracing manual, incluindo a travessia da fila. Este é o ponto mais difícil do desafio e o que mais vale.

**5.** Faça as métricas com `prom-client`, configure o scrape e confirme os dois alvos `UP` antes de desenhar painel. Monte o dashboard por arquivo, derrube tudo com `docker compose down -v`, suba de novo e confirme que os painéis voltaram sozinhos.

**6.** Colete o baseline com o cenário `normal` e anote os números, porque é ele que justifica os limiares. Só então escreva as regras e prove os três comportamentos: silêncio no normal e disparo em cada cenário.

**7.** Investigue as duas queixas e escreva os relatórios, capturando as evidências enquanto investiga. Reconstruir evidência depois é mais caro do que salvar na hora.

**8.** Percorra os critérios de aceite item a item, do zero, seguindo só o seu README, antes do push final.

## Dicas finais

O identificador é a espinha do desafio. Log, métrica e trace só viram observabilidade quando você consegue pular de um para o outro sem adivinhar. Se em algum momento você tiver um `trace_id` no Jaeger que não existe em nenhuma linha de log, pare e resolva isso antes de seguir, porque quase todo o valor do que vem depois depende dessa ponte.

A travessia da fila é onde a maioria vai travar, e é onde está a lição do módulo de tracing distribuído. O contexto de trace não é mágica do framework, é dado que precisa viajar junto com a mensagem. Procure na documentação do OpenTelemetry a API de propagação, com as operações de injetar e extrair, e pense em onde no formato da sua mensagem esse dado vai caber. Se ao consumir a mensagem você começar um trace novo em vez de continuar o que existia, o sintoma é claro: dois traces curtos no Jaeger em vez de um trace completo.

Nas duas investigações, resista ao impulso de abrir o código antes da telemetria. O código está aí e você pode ler, mas se a resposta vier do código e não da instrumentação, você não provou nada: só confirmou um palpite, que é o que a empresa já fazia antes de você chegar.