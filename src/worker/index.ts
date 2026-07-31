import http from 'node:http';
import { atualizarStatusPedido } from '../db/consultas';
import { esperarBanco, fecharPool } from '../db/pool';
import { migrar } from '../db/migracao';
import { consumirPedido, criarConexaoRedis } from '../fila/fila';
import { processarPagamento } from './pagamento';

const porta = Number(process.env.WORKER_PORT ?? process.env.PORT ?? 8081);

let rodando = true;

function iniciarServidorDeSaude(): http.Server {
  const servidor = http.createServer((requisicao, resposta) => {
    if (requisicao.url === '/health') {
      resposta.writeHead(200, { 'content-type': 'application/json' });
      resposta.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    resposta.writeHead(404, { 'content-type': 'application/json' });
    resposta.end(JSON.stringify({ erro: 'rota nao encontrada' }));
  });

  servidor.listen(porta, () => {
    console.log('worker ouvindo na porta ' + porta);
  });

  return servidor;
}

async function processarMensagem(mensagem: Record<string, unknown>): Promise<void> {
  const pedidoId = Number(mensagem.pedido_id);
  const clienteId = String(mensagem.cliente_id);
  const valorTotal = Number(mensagem.valor_total);

  let recusado = false;

  try {
    const resultado = await processarPagamento(clienteId, valorTotal);
    recusado = !resultado.aprovado;
  } catch (erro) {
  }

  const status = recusado ? 'recusado' : 'confirmado';
  await atualizarStatusPedido(pedidoId, status);

  console.log('pedido ' + pedidoId + ' ficou ' + status);
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

  console.log('worker consumindo a fila de pedidos');

  while (rodando) {
    try {
      const mensagem = await consumirPedido(redis);

      if (mensagem) {
        await processarMensagem(mensagem);
      }
    } catch (erro) {
      console.log('falha ao ler a fila: ' + (erro as Error).message);
      await new Promise((resolver) => setTimeout(resolver, 1000));
    }
  }
}

iniciar().catch((erro) => {
  console.log('worker nao conseguiu iniciar: ' + erro.message);
  process.exit(1);
});
