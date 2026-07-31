import express, { type NextFunction, type Request, type Response } from 'express';
import { esperarBanco, fecharPool } from '../db/pool';
import { migrar } from '../db/migracao';
import { criarConexaoRedis } from '../fila/fila';
import { criarRotas } from './rotas';

const porta = Number(process.env.API_PORT ?? process.env.PORT ?? 8080);

async function iniciar(): Promise<void> {
  await esperarBanco();
  await migrar();

  const redis = criarConexaoRedis();

  const aplicacao = express();
  aplicacao.use(express.json());
  aplicacao.use(criarRotas(redis));

  aplicacao.use(
    (erro: Error, _requisicao: Request, resposta: Response, _proximo: NextFunction) => {
      console.log('erro ao atender requisicao: ' + erro.message);
      resposta.status(500).json({ erro: 'erro interno' });
    }
  );

  const servidor = aplicacao.listen(porta, () => {
    console.log('api ouvindo na porta ' + porta);
  });

  const encerrar = () => {
    servidor.close(async () => {
      redis.disconnect();
      await fecharPool();
      process.exit(0);
    });
  };

  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

iniciar().catch((erro) => {
  console.log('api nao conseguiu iniciar: ' + erro.message);
  process.exit(1);
});
