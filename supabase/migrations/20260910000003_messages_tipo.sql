-- Tipo da mensagem: texto, imagem, audio, e o que mais a Meta mandar.
--
-- A foto e o audio chegam como texto (descricao e transcricao), entao sem esta
-- coluna nao da para saber depois o que era o que: nem para a tela Conversas
-- mostrar "foto" / "audio", nem para analise.
--
-- Aditiva. Default 'texto', que e o que todas as mensagens existentes sao
-- (conferido em 2026-09-10: nenhuma mensagem gravada como "tipo nao suportado").
--
-- SEM check de valores, de proposito: o tipo vem da Meta, e um valor novo que
-- ela passe a mandar faria o insert falhar -- ou seja, a mensagem do cliente
-- sumir. Os tipos conhecidos sao gravados em portugues pelo webhook; um tipo
-- desconhecido e gravado como a Meta mandou.

alter table public.messages
  add column if not exists tipo text not null default 'texto';

comment on column public.messages.tipo is
  'texto | imagem | audio | video | documento | figurinha | localizacao | contato | ... (tipo desconhecido da Meta fica como veio)';
