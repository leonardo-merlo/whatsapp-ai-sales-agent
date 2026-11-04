// Wrapper fino da API do Asaas — sem SDK externo, só fetch. Server-only:
// a ASAAS_API_KEY nunca deve chegar ao browser. Usado pelas rotas de
// assinar/cancelar plano e pelo webhook de confirmação de pagamento.

interface AsaasErrorBody { errors?: { description?: string }[] }

function baseUrl(): string {
  const url = process.env.ASAAS_API_URL;
  if (!url) throw new Error('ASAAS_API_URL não configurada.');
  return url;
}

async function asaasFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) throw new Error('ASAAS_API_KEY não configurada.');

  const resp = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      access_token: apiKey,
      ...init?.headers,
    },
  });

  if (!resp.ok) {
    const body: AsaasErrorBody = await resp.json().catch(() => ({}));
    const msg = body.errors?.[0]?.description ?? `Erro na API do Asaas (HTTP ${resp.status})`;
    throw new Error(msg);
  }

  return resp.json() as Promise<T>;
}

export async function criarClienteAsaas(nome: string, cpfCnpj: string): Promise<{ id: string }> {
  return asaasFetch('/customers', {
    method: 'POST',
    body: JSON.stringify({ name: nome, cpfCnpj: cpfCnpj.replace(/\D/g, '') }),
  });
}

// Assinatura recorrente no cartão — o Asaas cobra sozinho a cada ciclo
// (MONTHLY ou YEARLY). Pix não entra aqui: no Pix o pagamento é avulso
// (criarCobrancaPix), porque não existe débito automático em Pix comum.
export async function criarAssinaturaAsaas(
  customerId: string, valorCentavos: number, nextDueDate: string,
  cycle: 'MONTHLY' | 'YEARLY', description: string,
): Promise<{ id: string }> {
  return asaasFetch('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      customer: customerId,
      billingType: 'CREDIT_CARD',
      cycle,
      value: valorCentavos / 100,
      nextDueDate,
      description,
    }),
  });
}

// Cobrança avulsa em Pix (não recorrente) — o cliente paga o período
// (mensal/anual) de uma vez; a renovação é manual.
export async function criarCobrancaPix(
  customerId: string, valorCentavos: number, dueDate: string, description: string,
): Promise<{ id: string; dueDate: string; invoiceUrl: string }> {
  return asaasFetch('/payments', {
    method: 'POST',
    body: JSON.stringify({
      customer: customerId,
      billingType: 'PIX',
      value: valorCentavos / 100,
      dueDate,
      description,
    }),
  });
}

export async function buscarPrimeiraCobranca(subscriptionId: string): Promise<{ id: string; dueDate: string; invoiceUrl: string }> {
  const { data } = await asaasFetch<{ data: { id: string; dueDate: string; invoiceUrl: string }[] }>(
    `/payments?subscription=${subscriptionId}`,
  );
  if (data.length === 0) throw new Error('Nenhuma cobrança gerada para a assinatura.');
  return data[0];
}

export async function buscarQrCodePix(paymentId: string): Promise<{ encodedImage: string; payload: string }> {
  return asaasFetch(`/payments/${paymentId}/pixQrCode`);
}

export async function cancelarAssinaturaAsaas(subscriptionId: string): Promise<void> {
  await asaasFetch(`/subscriptions/${subscriptionId}`, { method: 'DELETE' });
}

// Atualiza o valor de uma cobrança ainda pendente — usado para abater o crédito
// proporcional na primeira cobrança de quem troca de plano no meio do período.
export async function atualizarValorCobranca(paymentId: string, valorCentavos: number): Promise<void> {
  await asaasFetch(`/payments/${paymentId}`, {
    method: 'PUT',
    body: JSON.stringify({ value: valorCentavos / 100 }),
  });
}
