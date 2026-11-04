// Avaliação de senha 100% no client, determinística e sem dependência externa.
// Serve só para orientar quem está escolhendo a senha: a regra que vale de
// verdade (tamanho mínimo do projeto e recusa de senhas vazadas) é aplicada pelo
// Supabase Auth no servidor, na chamada de signUp/updateUser.
// Critério no espírito do NIST SP 800-63B: comprimento manda, sem exigir
// maiúscula/número/símbolo — só penalizar o que é fácil de adivinhar.

export const SENHA_MIN = 8;

export type NivelSenha = 'fraca' | 'media' | 'forte';

export type AvaliacaoSenha = {
  nivel: NivelSenha;
  rotulo: string;
  pontos: number;
  dica: string;
};

const ROTULOS: Record<NivelSenha, string> = { fraca: 'Fraca', media: 'Média', forte: 'Forte' };

// Lista curta e proposital: só o que aparece no topo de qualquer vazamento
// brasileiro ou global. Não é substituto do check de senha vazada do servidor.
const SENHAS_COMUNS = [
  '123456', '1234567', '12345678', '123456789', '1234567890', '123123', '111111', '000000',
  'senha', 'senha123', 'minhasenha', 'mudar', 'mudar123', 'teste', 'teste123', 'brasil',
  'brasil123', 'euteamo', 'amoteamo', 'familia', 'deusefiel', 'deusnocomando', 'gabriel',
  'flamengo', 'corinthians', 'palmeiras', 'saopaulo', 'gremio', 'vasco', 'cruzeiro',
  'password', 'password1', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'qwerty', 'qwerty123', 'qwertyui', 'abc123',
  'iloveyou', 'admin', 'admin123', 'letmein', 'welcome', 'monkey', 'dragon', 'sunshine',
  'football', 'princess', 'master', 'shadow', 'superman', 'batman', 'trustno1',
  '1q2w3e4r', 'asdfghjk', 'zxcvbnm',
];

const SEQUENCIAS = [
  'abcdefghijklmnopqrstuvwxyz',
  '01234567890',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
];

function normalizar(senha: string): string {
  return senha.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function temSequencia(senha: string): boolean {
  const texto = normalizar(senha);
  if (texto.length < 4) return false;
  for (const linha of SEQUENCIAS) {
    const invertida = [...linha].reverse().join('');
    for (let i = 0; i + 4 <= texto.length; i++) {
      const trecho = texto.slice(i, i + 4);
      if (linha.includes(trecho) || invertida.includes(trecho)) return true;
    }
  }
  return false;
}

function temRepeticao(senha: string): boolean {
  return /(.)\1{2,}/.test(senha);
}

function ehComum(senha: string): boolean {
  const texto = normalizar(senha);
  const semDigitosNoFim = texto.replace(/\d+$/, '');
  if (SENHAS_COMUNS.includes(texto)) return true;
  return semDigitosNoFim.length >= 4 && SENHAS_COMUNS.includes(semDigitosNoFim);
}

function classesDeCaractere(senha: string): number {
  let classes = 0;
  if (/[a-z\u00e0-\u00f6\u00f8-\u00ff]/.test(senha)) classes++;
  if (/[A-Z\u00c0-\u00d6\u00d8-\u00de]/.test(senha)) classes++;
  if (/\d/.test(senha)) classes++;
  if (/[^\p{L}\p{N}]/u.test(senha)) classes++;
  return classes;
}

function montarDica(opcoes: {
  curta: boolean;
  comum: boolean;
  sequencia: boolean;
  repeticao: boolean;
  soDigitos: boolean;
  nivel: NivelSenha;
}): string {
  if (opcoes.curta) return `Use pelo menos ${SENHA_MIN} caracteres.`;
  if (opcoes.comum) return 'Essa senha é conhecida demais — escolha algo que só você usaria.';
  if (opcoes.sequencia) return 'Evite sequências óbvias como 1234 ou abcd.';
  if (opcoes.repeticao) return 'Evite repetir o mesmo caractere várias vezes seguidas.';
  if (opcoes.soDigitos) return 'Só números é fácil de adivinhar — misture letras.';
  if (opcoes.nivel === 'forte') return 'Boa senha. Guarde num gerenciador de senhas.';
  return 'Uma frase curta e fácil de lembrar deixa a senha bem mais forte.';
}

export function avaliarSenha(senha: string): AvaliacaoSenha {
  if (senha.length === 0) {
    return { nivel: 'fraca', rotulo: ROTULOS.fraca, pontos: 0, dica: `Use pelo menos ${SENHA_MIN} caracteres.` };
  }

  const curta = senha.length < SENHA_MIN;
  const comum = ehComum(senha);
  const sequencia = temSequencia(senha);
  const repeticao = temRepeticao(senha);
  const soDigitos = /^\d+$/.test(senha);

  // Comprimento pesa mais que variedade, de propósito.
  const porComprimento = Math.min(50, Math.max(0, (senha.length - 4) * 5));
  const porVariedade = Math.max(0, (classesDeCaractere(senha) - 1) * 10);
  const bonusFrase = senha.length >= 16 ? 10 : 0;

  let pontos = porComprimento + porVariedade + bonusFrase;
  if (sequencia) pontos -= 25;
  if (repeticao) pontos -= 20;
  if (soDigitos) pontos -= 15;
  if (comum) pontos = Math.min(pontos, 8);
  if (curta) pontos = Math.min(pontos, 20);
  pontos = Math.max(0, Math.min(100, pontos));

  const nivel: NivelSenha = pontos >= 70 ? 'forte' : pontos >= 40 ? 'media' : 'fraca';
  return { nivel, rotulo: ROTULOS[nivel], pontos, dica: montarDica({ curta, comum, sequencia, repeticao, soDigitos, nivel }) };
}

// O Supabase responde em inglês quando a senha bate nas políticas do projeto
// (tamanho mínimo, complexidade exigida, senha encontrada em vazamento).
// Devolve null quando o erro não é sobre senha — aí a tela usa a mensagem
// genérica que já tinha.
export function traduzirErroSenha(mensagem: string): string | null {
  const texto = mensagem.toLowerCase();

  if (texto.includes('pwned') || texto.includes('leaked') || texto.includes('data breach')
    || texto.includes('known to be weak') || texto.includes('easy to guess') || texto.includes('compromised')) {
    return 'Essa senha já apareceu em vazamentos públicos. Escolha outra, que você não use em nenhum outro site.';
  }
  if (texto.includes('should contain') || texto.includes('requirements')) {
    return 'Essa senha não atende às regras exigidas na sua conta. Tente uma senha mais longa, misturando letras e números.';
  }
  if (texto.includes('too short') || (texto.includes('at least') && texto.includes('character'))) {
    return `Essa senha é curta demais. Use pelo menos ${SENHA_MIN} caracteres.`;
  }
  if (texto.includes('weak password') || texto.includes('password is too weak')) {
    return 'Essa senha é fraca demais para as regras da sua conta. Tente uma senha mais longa.';
  }
  return null;
}
