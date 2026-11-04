-- =============================================================
-- Business token do cliente, guardado no Supabase Vault
-- =============================================================
-- O Embedded Signup entrega, uma única vez, o **business token** do cliente: é
-- com ele que a Meta autoriza mandar mensagem pelo número dele. Até aqui
-- `api/whatsapp/connect` usava esse token durante a conexão e o descartava, e o
-- envio do dia a dia saía com o `WHATSAPP_ACCESS_TOKEN` — que é o token da
-- Wappia. Isso funciona no número da própria Wappia e não há garantia nenhuma
-- de que funcione no número de um cliente. A doc da Meta é explícita: o Solution
-- Partner usa o system token só para compartilhar a linha de crédito, e
-- "business tokens for everything else".
--
-- **O token nunca fica em coluna.** Vai para o Vault (cifrado em repouso, fora
-- de qualquer dump de tabela e fora do alcance do PostgREST), e `wa_numbers`
-- guarda só o id do segredo. As duas funções abaixo são a única porta: não há
-- caminho por onde uma sessão de usuário leia o segredo, porque o schema `vault`
-- não é exposto pela API e o EXECUTE é só do `service_role`.
--
-- Por número e não por organização: o token vem por conexão, e na Distribuidora Exemplo cada
-- vendedor conecta o número dele separado. Um token por linha de `wa_numbers` é
-- o que permite reconectar um número sem tocar nos outros.
--
-- Migration ADITIVA e de comportamento antigo por padrão: número sem token
-- guardado continua enviando pelo `WHATSAPP_ACCESS_TOKEN`, exatamente como hoje.

ALTER TABLE public.wa_numbers
  ADD COLUMN IF NOT EXISTS token_secret_id     uuid,
  ADD COLUMN IF NOT EXISTS token_atualizado_em timestamptz;

COMMENT ON COLUMN public.wa_numbers.token_secret_id IS
  'Id do segredo no Vault com o business token do cliente. Nulo = envia com o token da Wappia (comportamento antigo).';
COMMENT ON COLUMN public.wa_numbers.token_atualizado_em IS
  'Quando o token foi guardado pela última vez. Serve para saber qual número já refez a conexão.';

-- ── Guardar ────────────────────────────────────────────────
-- Cria o segredo na primeira conexão e atualiza na reconexão, sempre com o
-- mesmo nome: token velho não fica sobrando no Vault.
CREATE OR REPLACE FUNCTION public.guardar_token_do_numero(
  p_phone_number_id text,
  p_token           text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_nome      text := 'wa_token_' || p_phone_number_id;
  v_secret_id uuid;
BEGIN
  IF p_phone_number_id IS NULL OR btrim(p_phone_number_id) = '' THEN
    RAISE EXCEPTION 'phone_number_id obrigatório';
  END IF;
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RAISE EXCEPTION 'token vazio';
  END IF;

  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_nome;

  IF v_secret_id IS NULL THEN
    v_secret_id := vault.create_secret(
      p_token, v_nome,
      'Business token do cliente (Embedded Signup) para o número ' || p_phone_number_id
    );
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_token);
  END IF;

  UPDATE public.wa_numbers
     SET token_secret_id = v_secret_id, token_atualizado_em = now()
   WHERE phone_number_id = p_phone_number_id;

  -- O número tem que existir antes: sem a linha, o segredo ficaria no Vault sem
  -- ninguém que soubesse achá-lo.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'número % não está em wa_numbers', p_phone_number_id;
  END IF;

  RETURN v_secret_id;
END;
$$;

-- ── Ler ────────────────────────────────────────────────────
-- Devolve NULL (não erro) quando o número não tem token guardado: quem chama
-- entende isso como "envia como antes".
CREATE OR REPLACE FUNCTION public.token_do_numero(
  p_phone_number_id text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret_id uuid;
  v_token     text;
BEGIN
  SELECT token_secret_id INTO v_secret_id
    FROM public.wa_numbers
   WHERE phone_number_id = p_phone_number_id;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_token
    FROM vault.decrypted_secrets
   WHERE id = v_secret_id;

  RETURN v_token;
END;
$$;

COMMENT ON FUNCTION public.guardar_token_do_numero(text, text) IS
  'Guarda no Vault o business token do cliente e liga o segredo ao número. Só service_role.';
COMMENT ON FUNCTION public.token_do_numero(text) IS
  'Business token do cliente para enviar por este número, ou NULL. Só service_role.';

-- ── Quem pode chamar ───────────────────────────────────────
-- A porta é estreita de propósito: `authenticated` chamando `token_do_numero`
-- leria o token do cliente pela API pública. Só a service_role (rotas do
-- servidor, sem sessão de usuário) executa.
REVOKE ALL ON FUNCTION public.guardar_token_do_numero(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.token_do_numero(text)               FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_token_do_numero(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.token_do_numero(text)               TO service_role;
