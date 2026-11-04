// O relato legível de um turno, montado só com o que ficou gravado.
//
// É a prova de que a ficha basta: se este texto explica por que o agente agiu
// como agiu, o diagnóstico de 20/09 (horas juntando `messages`, `ai_usage`,
// `erp_chamadas` e o log da Vercel) passa a ser uma consulta. Usado no teste
// de ponta a ponta e no script do relatório.

export interface TurnoGravado {
  id: string;
  created_at?: string | null;
  origem: string;
  status: string;
  roteiro?: string | null;
  mensagem_id?: string | null;
  caminho?: string[] | null;
  ferramentas?: unknown;
  resposta?: string | null;
  erro?: string | null;
  estado_antes?: unknown;
  estado_depois?: unknown;
  sombra_etapa_antes?: string | null;
  sombra_etapa_depois?: string | null;
  divergencias?: string[] | null;
  duracao_ms?: number | null;
  prompt_hash?: string | null;
  prompt_system?: string | null;
}

export interface UsoGravado { input_tokens: number; output_tokens: number; custo_usd?: number | null }
export interface ChamadaGravada { id: string; operacao: string; ok: boolean; status_http?: number | null; codigo?: string | null; duracao_ms?: number | null }

export function reconstruirTurno(entrada: {
  turno: TurnoGravado;
  textoDaMensagem?: string | null;
  usos: UsoGravado[];
  chamadas: ChamadaGravada[];
}): string {
  const { turno, usos, chamadas } = entrada;
  const linhas: string[] = [];
  linhas.push(`Turno ${turno.id} · ${turno.origem} · ${turno.status}${turno.roteiro ? ` · roteiro ${turno.roteiro}` : ''}`);
  if (turno.created_at) linhas.push(`Quando: ${turno.created_at}${turno.duracao_ms != null ? ` (${turno.duracao_ms} ms)` : ''}`);
  linhas.push(`Respondendo: ${entrada.textoDaMensagem ? `"${entrada.textoDaMensagem}"` : (turno.mensagem_id ?? '(sem mensagem)')}`);
  if (turno.prompt_hash) {
    linhas.push(`Prompt: ${turno.prompt_system ? `${turno.prompt_system.length} caracteres` : 'expirado'}, hash ${turno.prompt_hash.slice(0, 12)}`);
  }
  linhas.push(`Estado antes: ${JSON.stringify(turno.estado_antes ?? null)}`);
  linhas.push(`Caminho: ${turno.caminho?.length ? turno.caminho.join(', ') : 'caminho feliz'}`);

  const ferramentas = Array.isArray(turno.ferramentas)
    ? turno.ferramentas as { nome: string; entrada: unknown; ok: boolean; duracao_ms: number; erp_chamadas?: string[] }[]
    : [];
  if (!ferramentas.length) linhas.push('Ferramentas: nenhuma');
  ferramentas.forEach((f, i) => {
    linhas.push(`Ferramenta ${i + 1}: ${f.nome}(${JSON.stringify(f.entrada)}) → ${f.ok ? 'ok' : 'falhou'} em ${f.duracao_ms} ms`);
    for (const id of f.erp_chamadas ?? []) {
      const c = chamadas.find(x => x.id === id);
      linhas.push(c
        ? `   ERP: ${c.operacao} ${c.ok ? 'ok' : 'falhou'}${c.status_http != null ? ` (HTTP ${c.status_http})` : ''}${c.codigo ? ` código ${c.codigo}` : ''}`
        : `   ERP: chamada ${id} (linha não encontrada)`);
    }
  });

  const custo = usos.reduce((s, u) => s + (u.custo_usd ?? 0), 0);
  const entradaTokens = usos.reduce((s, u) => s + u.input_tokens, 0);
  const saidaTokens = usos.reduce((s, u) => s + u.output_tokens, 0);
  linhas.push(`Claude: ${usos.length} chamada(s), ${entradaTokens} tokens de entrada, ${saidaTokens} de saída, US$ ${custo.toFixed(4)}`);
  linhas.push(`Estado depois: ${JSON.stringify(turno.estado_depois ?? null)}`);
  if (turno.sombra_etapa_antes !== undefined || turno.sombra_etapa_depois !== undefined) {
    linhas.push(`Sombra: ${turno.sombra_etapa_antes ?? '(sem orçamento)'} → ${turno.sombra_etapa_depois ?? '(sem orçamento)'}`);
  }
  linhas.push(`Divergências: ${turno.divergencias?.length ? turno.divergencias.join(', ') : 'nenhuma'}`);
  if (turno.erro) linhas.push(`Erro: ${turno.erro}`);
  linhas.push(`Resposta: ${turno.resposta ? `"${turno.resposta}"` : '(nada foi ao cliente)'}`);
  return linhas.join('\n');
}
