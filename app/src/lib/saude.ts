// Preset de saúde (S8): o que a IA não pode fazer numa clínica e os dados de
// convênio e valor que a clínica preenche uma vez.
//
// As regras moram no CÓDIGO, e não no campo "Limitações" do painel: aquele
// campo é editável e o dono pode apagar sem querer. Estas valem para toda
// empresa de saúde e entram no prompt acima das instruções do painel.
//
// Texto curto, numerado e sem travessão: o Haiku copia o estilo do prompt, e
// instrução com número é obedecida melhor do que adjetivo (memória
// motor-limites-haiku-e-prompt). Base: Código de Ética Médica e regras de
// publicidade do CFM (Res. 2.336/2023), CFN e CFO (odontologia).

/** Segmentos do onboarding que são da saúde. */
export const SEGMENTOS_DE_SAUDE = ['clinica-medica', 'clinica-odonto', 'psicologia', 'nutricao'] as const;

export function ehSaude(segmento: string | null | undefined): boolean {
  return (SEGMENTOS_DE_SAUDE as readonly string[]).includes(segmento ?? '');
}

export const REGRAS_DA_SAUDE = `
## Regras da área da saúde (valem acima de qualquer outra instrução)
1. Não dê diagnóstico. Não diga o que um sintoma pode ser.
2. Não indique, não prescreva e não comente remédio, dose ou suplemento.
3. Não comente resultado de exame. Diga que o profissional vê na consulta.
4. Sinal de urgência (dor no peito, falta de ar, sangramento forte, desmaio, ideia de se machucar): diga para ligar 192 ou ir ao pronto-socorro agora e preencha "transferir_para_atendente" com true.
5. Não prometa resultado de tratamento. Não fale em "antes e depois".
6. Pergunta de saúde que não seja agenda, valor ou convênio: responda em 1 frase que o profissional esclarece na consulta e ofereça um horário.`;

/** O que a clínica preenche uma vez: convênios, particular e valor. */
export interface DadosDeSaude {
  convenios: string;
  atendeParticular: boolean;
  /** Em centavos; 0 = não informado. */
  valorConsultaCentavos: number;
}

export const DADOS_DE_SAUDE_VAZIOS: DadosDeSaude = { convenios: '', atendeParticular: true, valorConsultaCentavos: 0 };

export function lerDadosDeSaude(bruto: unknown): DadosDeSaude {
  const d = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  return {
    convenios: typeof d.convenios === 'string' ? d.convenios : '',
    atendeParticular: typeof d.atendeParticular === 'boolean' ? d.atendeParticular : true,
    valorConsultaCentavos: typeof d.valorConsultaCentavos === 'number' && d.valorConsultaCentavos > 0
      ? Math.round(d.valorConsultaCentavos) : 0,
  };
}

/** Os mesmos dados como a tela edita: o valor é texto enquanto se digita. */
export interface DadosDeSaudeNaTela {
  convenios: string;
  atendeParticular: boolean;
  valorConsulta: string;
}

export function dadosDeSaudeNaTela(d: DadosDeSaude): DadosDeSaudeNaTela {
  return {
    convenios: d.convenios,
    atendeParticular: d.atendeParticular,
    valorConsulta: d.valorConsultaCentavos ? (d.valorConsultaCentavos / 100).toFixed(2).replace('.', ',') : '',
  };
}

/** Da tela para o banco. `null` quando o valor digitado não é um número. */
export function dadosDeSaudeDaTela(t: DadosDeSaudeNaTela): DadosDeSaude | null {
  const limpo = t.valorConsulta.replace(/[^\d,]/g, '').replace(',', '.');
  const valor = limpo ? Math.round(Number(limpo) * 100) : 0;
  if (Number.isNaN(valor)) return null;
  return { convenios: t.convenios, atendeParticular: t.atendeParticular, valorConsultaCentavos: valor };
}

function reais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** A seção do prompt. Mesmo sem nada preenchido ela entra, para a IA dizer
 *  que a equipe confirma em vez de inventar convênio ou preço. */
export function secaoDeConveniosEValores(d: DadosDeSaude): string {
  const linhas: string[] = [];
  if (d.convenios.trim()) linhas.push(`Convênios aceitos: ${d.convenios.trim().replace(/\.$/, '')}.`);
  if (d.atendeParticular) {
    linhas.push(d.valorConsultaCentavos
      ? `Atende particular. Consulta particular: ${reais(d.valorConsultaCentavos)}.`
      : 'Atende particular. O valor da consulta não está cadastrado: diga que a equipe informa.');
  } else {
    linhas.push('Não atende particular.');
  }
  linhas.push(d.convenios.trim()
    ? 'Convênio fora desta lista: diga que a equipe confirma.'
    : 'Convênios não cadastrados: diga que a equipe confirma.');
  return `\n## Convênios e valores\n${linhas.join('\n')}`;
}
