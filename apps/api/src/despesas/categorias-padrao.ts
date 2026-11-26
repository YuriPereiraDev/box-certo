import type { TransacaoSistema } from '../prisma/banco.service.js';

/** Categorias criadas com toda oficina (seção 7.6). */
export const CATEGORIAS_PADRAO = [
  { nome: 'Aluguel', ehSalario: false },
  { nome: 'Energia', ehSalario: false },
  { nome: 'Água', ehSalario: false },
  { nome: 'Internet', ehSalario: false },
  { nome: 'Salários e funcionários', ehSalario: true },
  { nome: 'Peças', ehSalario: false },
  { nome: 'Ferramentas', ehSalario: false },
  { nome: 'Impostos', ehSalario: false },
  { nome: 'Manutenção', ehSalario: false },
  { nome: 'Outros', ehSalario: false },
] as const;

export const CATEGORIA_PECAS = 'Peças';

type ComCategorias = Pick<TransacaoSistema, 'categoriaDespesa'>;

export async function criarCategoriasPadrao(db: ComCategorias, oficinaId: string): Promise<void> {
  await db.categoriaDespesa.createMany({
    data: CATEGORIAS_PADRAO.map((c) => ({ ...c, oficinaId, padrao: true })),
    skipDuplicates: true,
  });
}

/** Id da categoria "Peças" da oficina (cria as padrão se faltarem). */
export async function categoriaPecas(db: ComCategorias, oficinaId: string): Promise<string> {
  const buscar = () =>
    db.categoriaDespesa.findUnique({
      where: { oficinaId_nome: { oficinaId, nome: CATEGORIA_PECAS } },
      select: { id: true },
    });
  const existente = await buscar();
  if (existente) return existente.id;
  await criarCategoriasPadrao(db, oficinaId);
  return (await buscar())!.id;
}
