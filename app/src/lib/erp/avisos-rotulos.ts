// Os tipos de aviso de formato do ERP e como o painel os mostra. Separado de
// `avisos.ts` para o cartão do painel não levar o detector ao navegador.

export type TipoDeAviso =
  | 'forma_desconhecida'
  | 'boleto_sem_prazo'
  | 'forma_sem_codigo'
  | 'formas_fora_do_formato'
  | 'situacao_desconhecida'
  | 'tipo_pessoa_desconhecido'
  | 'produto_sem_medida'
  | 'produto_incompleto'
  | 'regiao_incompleta'
  | 'lista_fora_do_formato'
  | 'parte_do_erp_falhou';

/** Como cada tipo aparece no painel: título e o que acontece com o dado. */
export const ROTULO_DO_AVISO: Record<TipoDeAviso, { titulo: string; efeito: string }> = {
  forma_desconhecida: { titulo: 'Forma de pagamento de tipo desconhecido', efeito: 'Não aparece no menu do cliente.' },
  boleto_sem_prazo: { titulo: 'Boleto sem prazo na descrição', efeito: 'O cliente não consegue escolher esse prazo.' },
  forma_sem_codigo: { titulo: 'Forma de pagamento sem código', efeito: 'Ignorada.' },
  formas_fora_do_formato: { titulo: 'Lista de formas de pagamento fora do formato', efeito: 'O cliente fica sem menu de pagamento.' },
  situacao_desconhecida: { titulo: 'Situação do cadastro desconhecida', efeito: 'Tratado como ativo.' },
  tipo_pessoa_desconhecido: { titulo: 'Tipo de pessoa desconhecido', efeito: 'Pode ser lido como PF ou PJ errado.' },
  produto_sem_medida: { titulo: 'Produto sem medida lida', efeito: 'Funciona só pela descrição, sem conferir medida.' },
  produto_incompleto: { titulo: 'Produto com campo faltando', efeito: 'Não foi atualizado no sync.' },
  regiao_incompleta: { titulo: 'Região com campo faltando', efeito: 'Não foi atualizada no sync.' },
  lista_fora_do_formato: { titulo: 'Lista do sync fora do formato', efeito: 'O sync não foi aplicado.' },
  parte_do_erp_falhou: { titulo: 'Parte do ERP não respondeu no sync', efeito: 'Lista parcial; nada foi desativado.' },
};
