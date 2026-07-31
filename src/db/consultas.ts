import { pool } from './pool';

export type Produto = {
  id: number;
  nome: string;
  preco: number;
};

export type ItemPedido = {
  produto_id: number;
  quantidade: number;
  preco_unitario: number;
};

export type Pedido = {
  id: number;
  cliente_id: string;
  status: string;
  valor_total: number;
  criado_em: string;
  itens: ItemPedido[];
};

export type ItemNovoPedido = {
  produto_id: number;
  quantidade: number;
};

export type LinhaRelatorio = {
  produto_id: number;
  nome: string;
  quantidade_vendida: number;
  valor_total: number;
};

export async function listarProdutos(): Promise<Produto[]> {
  const resultado = await pool.query(
    'SELECT id, nome, preco FROM produtos ORDER BY id'
  );

  return resultado.rows.map((linha) => ({
    id: linha.id,
    nome: linha.nome,
    preco: Number(linha.preco),
  }));
}

export async function buscarProduto(id: number): Promise<Produto | null> {
  const resultado = await pool.query(
    'SELECT id, nome, preco FROM produtos WHERE id = $1',
    [id]
  );

  if (resultado.rows.length === 0) {
    return null;
  }

  const linha = resultado.rows[0];
  return { id: linha.id, nome: linha.nome, preco: Number(linha.preco) };
}

export async function buscarProdutosPorIds(ids: number[]): Promise<Produto[]> {
  const resultado = await pool.query(
    'SELECT id, nome, preco FROM produtos WHERE id = ANY($1::int[])',
    [ids]
  );

  return resultado.rows.map((linha) => ({
    id: linha.id,
    nome: linha.nome,
    preco: Number(linha.preco),
  }));
}

export async function criarPedido(
  clienteId: string,
  itens: ItemNovoPedido[],
  precoPorProduto: Map<number, number>
): Promise<{ id: number; valor_total: number }> {
  const cliente = await pool.connect();

  try {
    await cliente.query('BEGIN');

    let valorTotal = 0;
    for (const item of itens) {
      valorTotal += (precoPorProduto.get(item.produto_id) ?? 0) * item.quantidade;
    }
    valorTotal = Math.round(valorTotal * 100) / 100;

    const pedidoInserido = await cliente.query(
      `INSERT INTO pedidos (cliente_id, status, valor_total)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [clienteId, 'pendente', valorTotal]
    );

    const pedidoId: number = pedidoInserido.rows[0].id;

    for (const item of itens) {
      await cliente.query(
        `INSERT INTO pedido_itens (pedido_id, produto_id, quantidade, preco_unitario)
         VALUES ($1, $2, $3, $4)`,
        [
          pedidoId,
          item.produto_id,
          item.quantidade,
          precoPorProduto.get(item.produto_id) ?? 0,
        ]
      );
    }

    await cliente.query('COMMIT');

    return { id: pedidoId, valor_total: valorTotal };
  } catch (erro) {
    await cliente.query('ROLLBACK');
    throw erro;
  } finally {
    cliente.release();
  }
}

export async function buscarPedido(id: number): Promise<Pedido | null> {
  const pedidoResultado = await pool.query(
    `SELECT id, cliente_id, status, valor_total, criado_em
       FROM pedidos
      WHERE id = $1`,
    [id]
  );

  if (pedidoResultado.rows.length === 0) {
    return null;
  }

  const itensResultado = await pool.query(
    `SELECT produto_id, quantidade, preco_unitario
       FROM pedido_itens
      WHERE pedido_id = $1
      ORDER BY id`,
    [id]
  );

  const linha = pedidoResultado.rows[0];

  return {
    id: linha.id,
    cliente_id: linha.cliente_id,
    status: linha.status,
    valor_total: Number(linha.valor_total),
    criado_em: linha.criado_em.toISOString(),
    itens: itensResultado.rows.map((item) => ({
      produto_id: item.produto_id,
      quantidade: item.quantidade,
      preco_unitario: Number(item.preco_unitario),
    })),
  };
}

export async function atualizarStatusPedido(
  id: number,
  status: string
): Promise<void> {
  await pool.query('UPDATE pedidos SET status = $1 WHERE id = $2', [status, id]);
}

export async function consolidarVendas(): Promise<LinhaRelatorio[]> {
  const itensResultado = await pool.query(
    `SELECT i.produto_id, i.quantidade
       FROM pedido_itens i
       JOIN pedidos p ON p.id = i.pedido_id
      WHERE p.status = 'confirmado'
        AND p.criado_em >= NOW() - INTERVAL '30 days'
      ORDER BY i.produto_id`
  );

  const consolidado = new Map<number, LinhaRelatorio>();

  for (const item of itensResultado.rows) {
    const produtoResultado = await pool.query(
      'SELECT nome, preco FROM produtos WHERE id = $1',
      [item.produto_id]
    );

    const produto = produtoResultado.rows[0];
    if (!produto) {
      continue;
    }

    const linha = consolidado.get(item.produto_id) ?? {
      produto_id: item.produto_id,
      nome: produto.nome,
      quantidade_vendida: 0,
      valor_total: 0,
    };

    linha.quantidade_vendida += item.quantidade;
    linha.valor_total += item.quantidade * Number(produto.preco);

    consolidado.set(item.produto_id, linha);
  }

  return [...consolidado.values()].map((linha) => ({
    ...linha,
    valor_total: Math.round(linha.valor_total * 100) / 100,
  }));
}
