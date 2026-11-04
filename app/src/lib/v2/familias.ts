// As famílias canônicas (v2_familias), o mapa grupo do ERP → família
// (v2_grupo_familia) e o molde de cada uma (v2_molde). Os dados estão em
// dados/familias.json; aqui só o acesso.

import familiasJson from './dados/familias.json' with { type: 'json' };
import { limparDescricao } from './numeros';
import type { Familia } from './tipos';

export const FAMILIAS_VERSAO: string = familiasJson.versao;
export const FAMILIAS: Familia[] = familiasJson.familias as unknown as Familia[];
const POR_ID = new Map(FAMILIAS.map(f => [f.id, f]));

export function familia(id: string): Familia | undefined {
  return POR_ID.get(id);
}

/** As famílias que a IA pode escolher (enum fechado da extração). */
export function familiasDaExtracao(): Familia[] {
  return FAMILIAS.filter(f => !f.fora_da_extracao);
}

/** A família de um produto pelo grupo do ERP e, quando o grupo é dividido, pela descrição. */
export function familiaDoProduto(grupo: string | null, descricao: string): Familia | null {
  if (!grupo) return null;
  const desc = limparDescricao(descricao);
  const doGrupo = FAMILIAS.filter(f => f.grupos.includes(grupo));
  return doGrupo.find(f => !f.filtro_descricao || new RegExp(f.filtro_descricao).test(desc)) ?? null;
}

/** As etiquetas válidas de uma família, com quantas vezes cada uma pode aparecer. */
export function etiquetasDoMolde(f: Familia): Map<string, number> {
  const conta = new Map<string, number>();
  for (const m of f.medidas ?? []) conta.set(m.etiqueta, (conta.get(m.etiqueta) ?? 0) + 1);
  if (f.medidas_da_descricao) conta.set('numero', 6);
  return conta;
}

/** Todas as etiquetas de todas as famílias (enum do schema da extração). */
export function todasAsEtiquetas(): string[] {
  const todas = new Set<string>(['numero']);
  for (const f of FAMILIAS) for (const m of f.medidas ?? []) todas.add(m.etiqueta);
  return [...todas].sort();
}
