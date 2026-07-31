import http from 'node:http';
import { SpanKind } from '@opentelemetry/api';
import { atualizarStatusPedido } from '../db/consultas';
import { esperarBanco, fecharPool } from '../db/pool';
import { migrar } from '../db/migracao';
import { consumirPedido, contextoDaMensagem, criarConexaoRedis } from '../fila/fila';
import { log } from '../telemetria/log';
import {
  TIPO_DE_CONTEUDO,
  coletar,
  cobrancasProcessadas,
  pedidosConfirmados,
} from '../telemetria/metricas';
import { registrarExcecaoNoSpan, tracer } from '../telemetria/rastro';
import { processarPagamento } from './pagamento';
import { registrarFalhaLegado } from './registro-legado';

const porta = Number(process.env.WORKER_PORT ?? process.env.PORT ?? 8081);

let rodando = true;

function iniciarServidorDeSaude(): http.Server {
  const servidor = http.createServer(async (requisicao, resposta) => {
    if (requisicao.url === '/health') {
      resposta.writeHead(200, { 'content-type': 'application/json' });
      resposta.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (requisicao.url === '/metrics') {
      resposta.writeHead(200, { 'content-type': TIPO_DE_CONTEUDO });
      resposta.end(await coletar());
      return;
    }

    resposta.writeHead(404, { 'content-type': 'application/json' });
    resposta.end(JSON.stringify({ erro: 'rota nao encontrada' }));
  });

  servidor.listen(porta, () => {
    log.info('worker ouvindo na porta ' + porta);
  });

  return servidor;
}

async function processarMensagem(mensagem: Record<string, unknown>): Promise<void> {
  const pedidoId = Number(mensagem.pedido_id);
  const clienteId = String(mensagem.cliente_id);
  const valorTotal = Number(mensagem.valor_total);

  // O contexto veio dentro da mensagem: este span continua o trace aberto pelo
  // `POST /pedidos`, em vez de comecar um trace novo no worker (requisito 2).
  const contextoDoPedido = contextoDaMensagem(mensagem);

  await tracer.startActiveSpan(
    'pedido.processar',
    {
      kind: SpanKind.CONSUMER,
      attributes: {
        'pedido.id': pedidoId,
        'pedido.cliente_id': clienteId,
        'pedido.valor_total': valorTotal,
        'fila.nome': 'pedidos',
      },
    },
    contextoDoPedido,
    async (span) => {
      try {
        log.info('mensagem do pedido ' + pedidoId + ' recebida da fila', {
          pedido_id: pedidoId,
        });

        let recusado = false;

        try {
          const resultado = await processarPagamento(clienteId, valorTotal);
          recusado = !resultado.aprovado;

          const desfecho = recusado ? 'recusada' : 'aprovada';
          cobrancasProcessadas.labels(desfecho).inc();
          span.setAttribute('cobranca.resultado', desfecho);

          if (recusado) {
            log.warn('cobranca do pedido ' + pedidoId + ' foi recusada', {
              pedido_id: pedidoId,
            });
          }
        } catch (erro) {
          registrarFalhaLegado(erro);

          // Bloco que hoje nao registra nada. Instrumentar aqui e o que revela a
          // queixa: a excecao morre neste catch e o pedido segue para confirmado.
          const motivo = registrarExcecaoNoSpan(span, erro);
          cobrancasProcessadas.labels('falha').inc();
          span.setAttribute('cobranca.resultado', 'falha');

          log.error('cobranca do pedido ' + pedidoId + ' falhou: ' + motivo, {
            pedido_id: pedidoId,
          });
        }

        const status = recusado ? 'recusado' : 'confirmado';
        await atualizarStatusPedido(pedidoId, status);

        if (status === 'confirmado') {
          pedidosConfirmados.inc();
        }

        span.setAttribute('pedido.status', status);

        log.info('pedido ' + pedidoId + ' ficou ' + status, { pedido_id: pedidoId });
      } catch (erro) {
        const motivo = registrarExcecaoNoSpan(span, erro);
        log.error('falha ao processar o pedido ' + pedidoId + ': ' + motivo, {
          pedido_id: pedidoId,
        });
        throw erro;
      } finally {
        span.end();
      }
    }
  );
}

async function iniciar(): Promise<void> {
  await esperarBanco();
  await migrar();

  const redis = criarConexaoRedis();
  const servidor = iniciarServidorDeSaude();

  const encerrar = () => {
    rodando = false;
    servidor.close(async () => {
      redis.disconnect();
      await fecharPool();
      process.exit(0);
    });
  };

  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);

  log.info('worker consumindo a fila de pedidos');

  while (rodando) {
    try {
      const mensagem = await consumirPedido(redis);

      if (mensagem) {
        await processarMensagem(mensagem);
      }
    } catch (erro) {
      log.error('erro ao ler a fila: ' + (erro as Error).message);
      await new Promise((resolver) => setTimeout(resolver, 1000));
    }
  }
}

iniciar().catch((erro) => {
  log.error('worker nao conseguiu iniciar: ' + erro.message);
  process.exit(1);
});
