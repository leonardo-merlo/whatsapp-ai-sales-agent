// As tabelas de regras da v2 (Fase C), lidas dos arquivos versionados em
// dados/. A versão de cada arquivo vai para o estado do item, para saber com
// que regras ele foi decidido.

import giriasJson from './dados/girias.json' with { type: 'json' };
import padroesJson from './dados/padroes.json' with { type: 'json' };
import naoVendeJson from './dados/nao-vende.json' with { type: 'json' };
import obrigatorioJson from './dados/obrigatorio-perguntar.json' with { type: 'json' };
import liberadasJson from './dados/familias-liberadas.json' with { type: 'json' };
import { CONVERSAO } from './conversao';
import { FAMILIAS_VERSAO } from './familias';
import { CORRECOES } from './saude';
import type { MedidaCanonica } from './tipos';

/** Exemplo de teste de uma regra: um item como a IA devolveria, e o que se espera. */
export interface ExemploDeRegra {
  familia: string;
  texto?: string;
  medidas?: [string, string][];
  qualificadores?: string[];
  espera: {
    codigo?: string; nao_codigo?: string; status?: string; opcoes?: string[];
    descricao?: string; todas_com?: string; nao_regra?: boolean;
  };
}

/** `corrige_familia`: a gíria é tão certa que, se a IA leu outra família, vale a da gíria (ex.: "rolo 250" é farpado). */
export interface GiriaDeFamilia { id: string; termo: string; familias: string[]; ignorar_se?: string; confirmar?: boolean; corrige_familia?: boolean; origem: string; positivo: string; negativo: string }
export interface GiriaDeQualificador { id: string; familia: string; termo: string; atributo: string; valor: string; origem: string; positivo: string; negativo: string }
export interface PalavraIgnorada { id: string; familia: string; termo: string; origem: string; positivo: string; negativo: string }

export interface Padrao {
  id: string;
  escopo: {
    familia?: string; familias?: string[];
    valores?: string[]; medidas_informadas?: number; etiquetas_informadas?: string[];
    atributos_presentes?: Record<string, string>; atributos_ausentes?: string[];
    texto?: string; gemeos_de_descricao?: boolean;
  };
  resultado: { codigo?: string; medidas?: MedidaCanonica[]; atributos?: Record<string, string>; codigo_menor?: boolean };
  status: 'ativa' | 'a_revisar';
  a_validar_vendedor: boolean;
  origem: string;
  texto_original: string;
  exemplo_positivo: string;
  exemplo_negativo: string;
  negativo_criado_pela_v2?: boolean;
  observacao?: string;
  positivo: ExemploDeRegra;
  negativo: ExemploDeRegra;
}

export interface NaoVende {
  id: string; familia: string; termo?: string; condicao?: { etiqueta: string; maior_que: number };
  status: string; a_validar_vendedor: boolean; origem: string; texto_original: string;
  exemplo_positivo: string; exemplo_negativo: string; negativo_criado_pela_v2?: boolean;
  positivo: ExemploDeRegra; negativo: ExemploDeRegra;
}

export interface FiltroDeOpcao { atributos?: Record<string, string>; medidas?: Record<string, string>; familia?: string; codigos?: string[] }

export interface ObrigatorioPerguntar {
  id: string; familia: string;
  condicao: { atributo_nao_informado?: string; etiqueta_nao_informada?: string; texto?: string; qualificador?: string; sem_medidas?: boolean };
  atributo: string; pergunta: string;
  opcoes: { rotulo: string; filtro: FiltroDeOpcao }[];
  status: string; a_validar_vendedor: boolean; origem: string; texto_original: string;
  exemplo_positivo: string; exemplo_negativo: string; negativo_criado_pela_v2?: boolean; observacao?: string;
  positivo: ExemploDeRegra; negativo: ExemploDeRegra;
}

export const GIRIAS = giriasJson as unknown as { versao: string; familias: GiriaDeFamilia[]; qualificadores: GiriaDeQualificador[]; ignorar: PalavraIgnorada[] };
export const PADROES: Padrao[] = (padroesJson as unknown as { padroes: Padrao[] }).padroes.filter(p => p.status === 'ativa');
export const NAO_VENDE: NaoVende[] = (naoVendeJson as unknown as { linhas: NaoVende[] }).linhas.filter(l => l.status === 'ativa');
export const OBRIGATORIO_PERGUNTAR: ObrigatorioPerguntar[] = (obrigatorioJson as unknown as { linhas: ObrigatorioPerguntar[] }).linhas.filter(l => l.status === 'ativa');
/** v2_familias_liberadas: começa vazia (tudo confirma com o cliente até a decisão do Leo). */
export const FAMILIAS_LIBERADAS: string[] = (liberadasJson as unknown as { familias: string[] }).familias;

/** A versão de todas as regras juntas: vai para o estado do item. */
export const VERSAO_DAS_REGRAS = [
  `familias ${FAMILIAS_VERSAO}`,
  `conversao ${CONVERSAO.versao}`,
  `girias ${GIRIAS.versao}`,
  `padroes ${(padroesJson as { versao: string }).versao}`,
  `nao_vende ${(naoVendeJson as { versao: string }).versao}`,
  `obrigatorio ${(obrigatorioJson as { versao: string }).versao}`,
  `correcoes ${CORRECOES.length}`,
  `liberadas ${FAMILIAS_LIBERADAS.join(',') || 'nenhuma'}`,
].join(' · ');
