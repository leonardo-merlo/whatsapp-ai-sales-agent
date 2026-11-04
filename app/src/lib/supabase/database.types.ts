export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_business_hours: {
        Row: {
          agent_id: string
          cor: string | null
          created_at: string
          dia: string
          hora: string
          id: string
          ordem: number
          organization_id: string
        }
        Insert: {
          agent_id: string
          cor?: string | null
          created_at?: string
          dia: string
          hora: string
          id?: string
          ordem?: number
          organization_id: string
        }
        Update: {
          agent_id?: string
          cor?: string | null
          created_at?: string
          dia?: string
          hora?: string
          id?: string
          ordem?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_business_hours_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_business_hours_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_faqs: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          ordem: number
          organization_id: string
          pergunta: string
          resposta: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          ordem?: number
          organization_id: string
          pergunta: string
          resposta: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          ordem?: number
          organization_id?: string
          pergunta?: string
          resposta?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_faqs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_faqs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_knowledge: {
        Row: {
          agent_id: string
          conhecimento: string
          id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          conhecimento?: string
          id?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          conhecimento?: string
          id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_knowledge_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_knowledge_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_prices: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          ordem: number
          organization_id: string
          procedimento: string
          valor: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          ordem?: number
          organization_id: string
          procedimento: string
          valor: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          ordem?: number
          organization_id?: string
          procedimento?: string
          valor?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_prices_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_prices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agente_turnos: {
        Row: {
          caminho: string[]
          conversation_id: string | null
          created_at: string
          divergencias: string[]
          duracao_ms: number | null
          erro: string | null
          estado_antes: Json | null
          estado_depois: Json | null
          ferramentas: Json
          id: string
          mensagem_id: string | null
          modelo: string | null
          organization_id: string
          origem: string
          prompt_hash: string | null
          prompt_mensagens: Json | null
          prompt_system: string | null
          resposta: string | null
          roteiro: string | null
          sombra_etapa_antes: string | null
          sombra_etapa_depois: string | null
          status: string
          terminou_em: string | null
          wa_number_id: string | null
        }
        Insert: {
          caminho?: string[]
          conversation_id?: string | null
          created_at?: string
          divergencias?: string[]
          duracao_ms?: number | null
          erro?: string | null
          estado_antes?: Json | null
          estado_depois?: Json | null
          ferramentas?: Json
          id?: string
          mensagem_id?: string | null
          modelo?: string | null
          organization_id: string
          origem: string
          prompt_hash?: string | null
          prompt_mensagens?: Json | null
          prompt_system?: string | null
          resposta?: string | null
          roteiro?: string | null
          sombra_etapa_antes?: string | null
          sombra_etapa_depois?: string | null
          status?: string
          terminou_em?: string | null
          wa_number_id?: string | null
        }
        Update: {
          caminho?: string[]
          conversation_id?: string | null
          created_at?: string
          divergencias?: string[]
          duracao_ms?: number | null
          erro?: string | null
          estado_antes?: Json | null
          estado_depois?: Json | null
          ferramentas?: Json
          id?: string
          mensagem_id?: string | null
          modelo?: string | null
          organization_id?: string
          origem?: string
          prompt_hash?: string | null
          prompt_mensagens?: Json | null
          prompt_system?: string | null
          resposta?: string | null
          roteiro?: string | null
          sombra_etapa_antes?: string | null
          sombra_etapa_depois?: string | null
          status?: string
          terminou_em?: string | null
          wa_number_id?: string | null
        }
        Relationships: []
      }
      agente_versoes: {
        Row: {
          autor: string
          conteudo: Json
          created_at: string
          criada_por: string | null
          id: string
          organization_id: string
        }
        Insert: {
          autor?: string
          conteudo: Json
          created_at?: string
          criada_por?: string | null
          id?: string
          organization_id: string
        }
        Update: {
          autor?: string
          conteudo?: Json
          created_at?: string
          criada_por?: string | null
          id?: string
          organization_id?: string
        }
        Relationships: []
      }
      ai_agent_config: {
        Row: {
          ativo: boolean
          created_at: string
          fallback_atendente_id: string | null
          fallback_mode: Database["public"]["Enums"]["fallback_mode"]
          fallback_msg: string
          horario_vincula_agenda: boolean
          id: string
          info_adicional: string
          limitacoes: string
          notif_excedido: boolean
          notif_nova_conversa: boolean
          notif_resumo: boolean
          organization_id: string
          prompt: string
          published_at: string | null
          published_snapshot: Json | null
          roteiro: string
          sucessos: Json
          tom: Database["public"]["Enums"]["agente_tom"] | null
          updated_at: string
          wa_number_id: string | null
          welcome_msg: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          fallback_atendente_id?: string | null
          fallback_mode?: Database["public"]["Enums"]["fallback_mode"]
          fallback_msg?: string
          horario_vincula_agenda?: boolean
          id?: string
          info_adicional?: string
          limitacoes?: string
          notif_excedido?: boolean
          notif_nova_conversa?: boolean
          notif_resumo?: boolean
          organization_id: string
          prompt?: string
          published_at?: string | null
          published_snapshot?: Json | null
          roteiro?: string
          sucessos?: Json
          tom?: Database["public"]["Enums"]["agente_tom"] | null
          updated_at?: string
          wa_number_id?: string | null
          welcome_msg?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          fallback_atendente_id?: string | null
          fallback_mode?: Database["public"]["Enums"]["fallback_mode"]
          fallback_msg?: string
          horario_vincula_agenda?: boolean
          id?: string
          info_adicional?: string
          limitacoes?: string
          notif_excedido?: boolean
          notif_nova_conversa?: boolean
          notif_resumo?: boolean
          organization_id?: string
          prompt?: string
          published_at?: string | null
          published_snapshot?: Json | null
          roteiro?: string
          sucessos?: Json
          tom?: Database["public"]["Enums"]["agente_tom"] | null
          updated_at?: string
          wa_number_id?: string | null
          welcome_msg?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_config_fallback_atendente_id_fkey"
            columns: ["fallback_atendente_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_config_wa_number_id_fkey"
            columns: ["wa_number_id"]
            isOneToOne: false
            referencedRelation: "wa_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage: {
        Row: {
          cache_creation_input_tokens: number
          cache_read_input_tokens: number
          conversation_id: string | null
          created_at: string
          custo_usd: number
          id: string
          input_tokens: number
          model: string
          organization_id: string
          origem: string
          output_tokens: number
          turno_id: string | null
        }
        Insert: {
          cache_creation_input_tokens?: number
          cache_read_input_tokens?: number
          conversation_id?: string | null
          created_at?: string
          custo_usd?: number
          id?: string
          input_tokens?: number
          model: string
          organization_id: string
          origem: string
          output_tokens?: number
          turno_id?: string | null
        }
        Update: {
          cache_creation_input_tokens?: number
          cache_read_input_tokens?: number
          conversation_id?: string | null
          created_at?: string
          custo_usd?: number
          id?: string
          input_tokens?: number
          model?: string
          organization_id?: string
          origem?: string
          output_tokens?: number
          turno_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          confirmado_em: string | null
          lembrete_enviado_em: string | null
          lembrete_resposta: string | null
          lembrete_tentativas: number
          atendente_id: string | null
          contact_id: string | null
          created_at: string
          data: string
          duracao_min: number | null
          hora: string
          id: string
          organization_id: string
          paciente_nome: string
          servico: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        Insert: {
          confirmado_em?: string | null
          lembrete_enviado_em?: string | null
          lembrete_resposta?: string | null
          lembrete_tentativas?: number
          atendente_id?: string | null
          contact_id?: string | null
          created_at?: string
          data: string
          duracao_min?: number | null
          hora: string
          id?: string
          organization_id: string
          paciente_nome: string
          servico: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Update: {
          confirmado_em?: string | null
          lembrete_enviado_em?: string | null
          lembrete_resposta?: string | null
          lembrete_tentativas?: number
          atendente_id?: string | null
          contact_id?: string | null
          created_at?: string
          data?: string
          duracao_min?: number | null
          hora?: string
          id?: string
          organization_id?: string
          paciente_nome?: string
          servico?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_atendente_id_fkey"
            columns: ["atendente_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      availability: {
        Row: {
          atendente_id: string | null
          cancelado: boolean
          capacidade: number | null
          created_at: string
          data: string | null
          dia_semana: number | null
          duracao_min: number | null
          hora_fim: string
          hora_inicio: string
          id: string
          organization_id: string
          parent_id: string | null
          tipo: string
        }
        Insert: {
          atendente_id?: string | null
          cancelado?: boolean
          capacidade?: number | null
          created_at?: string
          data?: string | null
          dia_semana?: number | null
          duracao_min?: number | null
          hora_fim: string
          hora_inicio: string
          id?: string
          organization_id: string
          parent_id?: string | null
          tipo: string
        }
        Update: {
          atendente_id?: string | null
          cancelado?: boolean
          capacidade?: number | null
          created_at?: string
          data?: string | null
          dia_semana?: number | null
          duracao_min?: number | null
          hora_fim?: string
          hora_inicio?: string
          id?: string
          organization_id?: string
          parent_id?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_atendente_id_fkey"
            columns: ["atendente_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "availability"
            referencedColumns: ["id"]
          },
        ]
      }
      business_faqs: {
        Row: {
          created_at: string
          id: string
          ordem: number
          organization_id: string
          pergunta: string
          resposta: string
        }
        Insert: {
          created_at?: string
          id?: string
          ordem?: number
          organization_id: string
          pergunta: string
          resposta: string
        }
        Update: {
          created_at?: string
          id?: string
          ordem?: number
          organization_id?: string
          pergunta?: string
          resposta?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_faqs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      business_hours: {
        Row: {
          cor: string | null
          created_at: string
          dia: string
          hora: string
          id: string
          ordem: number
          organization_id: string
        }
        Insert: {
          cor?: string | null
          created_at?: string
          dia: string
          hora: string
          id?: string
          ordem?: number
          organization_id: string
        }
        Update: {
          cor?: string | null
          created_at?: string
          dia?: string
          hora?: string
          id?: string
          ordem?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_business_hours_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      business_prices: {
        Row: {
          controla_estoque: boolean
          created_at: string
          descricao: string
          estoque: string
          estoque_minimo: number | null
          estoque_qtd: number | null
          id: string
          observacoes: string
          ordem: number
          organization_id: string
          procedimento: string
          valor: string
        }
        Insert: {
          controla_estoque?: boolean
          created_at?: string
          descricao?: string
          estoque?: string
          estoque_minimo?: number | null
          estoque_qtd?: number | null
          id?: string
          observacoes?: string
          ordem?: number
          organization_id: string
          procedimento: string
          valor: string
        }
        Update: {
          controla_estoque?: boolean
          created_at?: string
          descricao?: string
          estoque?: string
          estoque_minimo?: number | null
          estoque_qtd?: number | null
          id?: string
          observacoes?: string
          ordem?: number
          organization_id?: string
          procedimento?: string
          valor?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_prices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      business_qualification_questions: {
        Row: {
          campo: string
          created_at: string
          id: string
          objetivo: string
          obrigatoria: boolean
          ordem: number
          organization_id: string
          pergunta: string
        }
        Insert: {
          campo: string
          created_at?: string
          id?: string
          objetivo?: string
          obrigatoria?: boolean
          ordem?: number
          organization_id: string
          pergunta: string
        }
        Update: {
          campo?: string
          created_at?: string
          id?: string
          objetivo?: string
          obrigatoria?: boolean
          ordem?: number
          organization_id?: string
          pergunta?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_qualification_questions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      business_triggers: {
        Row: {
          acao: string
          ativo: boolean
          created_at: string
          gatilho: string
          id: string
          mensagem: string
          ordem: number
          organization_id: string
        }
        Insert: {
          acao?: string
          ativo?: boolean
          created_at?: string
          gatilho: string
          id?: string
          mensagem?: string
          ordem?: number
          organization_id: string
        }
        Update: {
          acao?: string
          ativo?: boolean
          created_at?: string
          gatilho?: string
          id?: string
          mensagem?: string
          ordem?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_triggers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_categories: {
        Row: {
          created_at: string
          id: string
          nome: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          nome: string
          organization_id: string
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          categoria_id: string | null
          created_at: string
          data_agendamento: string | null
          disparos_count: number
          falhas_count: number
          filtro_bairro: string | null
          filtro_convenio: string | null
          filtro_status: string | null
          id: string
          nome: string
          organization_id: string
          remetente: string
          status: Database["public"]["Enums"]["campaign_status"]
          taxa_abertura: number | null
          template_id: string | null
          tipo: Database["public"]["Enums"]["campaign_tipo"]
          updated_at: string
          wa_number_id: string | null
          wa_template_id: string | null
        }
        Insert: {
          categoria_id?: string | null
          created_at?: string
          data_agendamento?: string | null
          disparos_count?: number
          falhas_count?: number
          filtro_bairro?: string | null
          filtro_convenio?: string | null
          filtro_status?: string | null
          id?: string
          nome: string
          organization_id: string
          remetente?: string
          status?: Database["public"]["Enums"]["campaign_status"]
          taxa_abertura?: number | null
          template_id?: string | null
          tipo?: Database["public"]["Enums"]["campaign_tipo"]
          updated_at?: string
          wa_number_id?: string | null
          wa_template_id?: string | null
        }
        Update: {
          categoria_id?: string | null
          created_at?: string
          data_agendamento?: string | null
          disparos_count?: number
          falhas_count?: number
          filtro_bairro?: string | null
          filtro_convenio?: string | null
          filtro_status?: string | null
          id?: string
          nome?: string
          organization_id?: string
          remetente?: string
          status?: Database["public"]["Enums"]["campaign_status"]
          taxa_abertura?: number | null
          template_id?: string | null
          tipo?: Database["public"]["Enums"]["campaign_tipo"]
          updated_at?: string
          wa_number_id?: string | null
          wa_template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "campaign_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      catalogo_config: {
        Row: {
          created_at: string
          dicionario: string
          importado_em: string | null
          importado_nome: string | null
          organization_id: string
          regras: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dicionario?: string
          importado_em?: string | null
          importado_nome?: string | null
          organization_id: string
          regras?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dicionario?: string
          importado_em?: string | null
          importado_nome?: string | null
          organization_id?: string
          regras?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalogo_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      catalogo_grupos: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          id: string
          nome: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          id?: string
          nome: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          id?: string
          nome?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalogo_grupos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      catalogo_produtos: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          dados: Json
          descricao: string
          grupo_id: string
          id: string
          medidas: Json | null
          molde: string | null
          organization_id: string
          preco: number | null
          unidade: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          dados?: Json
          descricao: string
          grupo_id: string
          id?: string
          medidas?: Json | null
          molde?: string | null
          organization_id: string
          preco?: number | null
          unidade?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          dados?: Json
          descricao?: string
          grupo_id?: string
          id?: string
          medidas?: Json | null
          molde?: string | null
          organization_id?: string
          preco?: number | null
          unidade?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalogo_produtos_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "catalogo_grupos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalogo_produtos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_history: {
        Row: {
          canal: string
          contact_id: string
          created_at: string
          data: string
          id: string
          organization_id: string
          resumo: string
          wa_number_id: string | null
        }
        Insert: {
          canal: string
          contact_id: string
          created_at?: string
          data?: string
          id?: string
          organization_id: string
          resumo: string
          wa_number_id?: string | null
        }
        Update: {
          canal?: string
          contact_id?: string
          created_at?: string
          data?: string
          id?: string
          organization_id?: string
          resumo?: string
          wa_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_history_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_history_wa_number_id_fkey"
            columns: ["wa_number_id"]
            isOneToOne: false
            referencedRelation: "wa_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_labels: {
        Row: {
          contact_id: string
          created_at: string
          label_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          label_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          label_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_labels_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          bairro: string
          cpf: string | null
          created_at: string
          custom_fields: Json
          documento: string | null
          email: string | null
          erp_cadastro: Json | null
          erp_cadastros: Json
          erp_cliente_id: string | null
          id: string
          nascimento: string | null
          nome: string
          organization_id: string
          origem: Database["public"]["Enums"]["contact_origem"]
          perfil: Json
          responsavel_id: string | null
          status: Database["public"]["Enums"]["contact_status"]
          telefone: string | null
          updated_at: string
          wa_user_id: string | null
          wa_username: string | null
        }
        Insert: {
          bairro?: string
          cpf?: string | null
          created_at?: string
          custom_fields?: Json
          documento?: string | null
          email?: string | null
          erp_cadastro?: Json | null
          erp_cadastros?: Json
          erp_cliente_id?: string | null
          id?: string
          nascimento?: string | null
          nome: string
          organization_id: string
          origem?: Database["public"]["Enums"]["contact_origem"]
          perfil?: Json
          responsavel_id?: string | null
          status?: Database["public"]["Enums"]["contact_status"]
          telefone?: string | null
          updated_at?: string
          wa_user_id?: string | null
          wa_username?: string | null
        }
        Update: {
          bairro?: string
          cpf?: string | null
          created_at?: string
          custom_fields?: Json
          documento?: string | null
          email?: string | null
          erp_cadastro?: Json | null
          erp_cadastros?: Json
          erp_cliente_id?: string | null
          id?: string
          nascimento?: string | null
          nome?: string
          organization_id?: string
          origem?: Database["public"]["Enums"]["contact_origem"]
          perfil?: Json
          responsavel_id?: string | null
          status?: Database["public"]["Enums"]["contact_status"]
          telefone?: string | null
          updated_at?: string
          wa_user_id?: string | null
          wa_username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_labels: {
        Row: {
          conversation_id: string
          created_at: string
          label_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          label_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          label_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_labels_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_tags: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          organization_id: string
          tag: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          organization_id: string
          tag: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_tags_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          assunto: string
          atendente_id: string | null
          contact_id: string
          created_at: string
          erp_cliente_desde_mensagem: string | null
          erp_cliente_id: string | null
          erp_cliente_nome: string | null
          id: string
          modo: Database["public"]["Enums"]["conversation_modo"]
          organization_id: string
          resumida_em: string | null
          status: Database["public"]["Enums"]["conversation_status"]
          updated_at: string
          wa_number_id: string | null
        }
        Insert: {
          assunto?: string
          atendente_id?: string | null
          contact_id: string
          created_at?: string
          erp_cliente_desde_mensagem?: string | null
          erp_cliente_id?: string | null
          erp_cliente_nome?: string | null
          id?: string
          modo?: Database["public"]["Enums"]["conversation_modo"]
          organization_id: string
          resumida_em?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          updated_at?: string
          wa_number_id?: string | null
        }
        Update: {
          assunto?: string
          atendente_id?: string | null
          contact_id?: string
          created_at?: string
          erp_cliente_desde_mensagem?: string | null
          erp_cliente_id?: string | null
          erp_cliente_nome?: string | null
          id?: string
          modo?: Database["public"]["Enums"]["conversation_modo"]
          organization_id?: string
          resumida_em?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          updated_at?: string
          wa_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_atendente_id_fkey"
            columns: ["atendente_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_wa_number_id_fkey"
            columns: ["wa_number_id"]
            isOneToOne: false
            referencedRelation: "wa_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_field_definitions: {
        Row: {
          created_at: string
          id: string
          key: string
          label: string
          ordem: number
          organization_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          label: string
          ordem?: number
          organization_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          label?: string
          ordem?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_field_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_avisos: {
        Row: {
          chave: string
          descricao: string
          id: string
          ocorrencias: number
          organization_id: string
          origem: string
          primeira_em: string
          referencia: string | null
          tipo: string
          ultima_em: string
        }
        Insert: {
          chave: string
          descricao: string
          id?: string
          ocorrencias?: number
          organization_id: string
          origem: string
          primeira_em?: string
          referencia?: string | null
          tipo: string
          ultima_em?: string
        }
        Update: {
          chave?: string
          descricao?: string
          id?: string
          ocorrencias?: number
          organization_id?: string
          origem?: string
          primeira_em?: string
          referencia?: string | null
          tipo?: string
          ultima_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_avisos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_chamadas: {
        Row: {
          caminho: string
          chave_idempotencia: string | null
          codigo: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          duracao_ms: number | null
          id: string
          mensagem: string | null
          metodo: string
          motivo: string | null
          ok: boolean
          operacao: string
          organization_id: string
          requisicao: Json | null
          resposta: Json | null
          status_http: number | null
          tentativas: number
          turno_id: string | null
          wa_number_id: string | null
        }
        Insert: {
          caminho: string
          chave_idempotencia?: string | null
          codigo?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          duracao_ms?: number | null
          id?: string
          mensagem?: string | null
          metodo: string
          motivo?: string | null
          ok: boolean
          operacao: string
          organization_id: string
          requisicao?: Json | null
          resposta?: Json | null
          status_http?: number | null
          tentativas?: number
          turno_id?: string | null
          wa_number_id?: string | null
        }
        Update: {
          caminho?: string
          chave_idempotencia?: string | null
          codigo?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          duracao_ms?: number | null
          id?: string
          mensagem?: string | null
          metodo?: string
          motivo?: string | null
          ok?: boolean
          operacao?: string
          organization_id?: string
          requisicao?: Json | null
          resposta?: Json | null
          status_http?: number | null
          tentativas?: number
          turno_id?: string | null
          wa_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "erp_chamadas_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_chamadas_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_chamadas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_chamadas_wa_number_id_fkey"
            columns: ["wa_number_id"]
            isOneToOne: false
            referencedRelation: "wa_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_eventos: {
        Row: {
          aplicado_em: string | null
          cliente_id: string | null
          dados: Json
          evento_id: string
          id: string
          ocorrido_em: string | null
          orcamento_id: string | null
          organization_id: string
          payload: Json
          pedido_id: string | null
          pedido_uuid: string | null
          recebido_em: string
          status: string | null
          tipo_evento: string | null
        }
        Insert: {
          aplicado_em?: string | null
          cliente_id?: string | null
          dados?: Json
          evento_id: string
          id?: string
          ocorrido_em?: string | null
          orcamento_id?: string | null
          organization_id: string
          payload: Json
          pedido_id?: string | null
          pedido_uuid?: string | null
          recebido_em?: string
          status?: string | null
          tipo_evento?: string | null
        }
        Update: {
          aplicado_em?: string | null
          cliente_id?: string | null
          dados?: Json
          evento_id?: string
          id?: string
          ocorrido_em?: string | null
          orcamento_id?: string | null
          organization_id?: string
          payload?: Json
          pedido_id?: string | null
          pedido_uuid?: string | null
          recebido_em?: string
          status?: string | null
          tipo_evento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "erp_eventos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_eventos_pedido_uuid_fkey"
            columns: ["pedido_uuid"]
            isOneToOne: false
            referencedRelation: "erp_pedidos"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_idempotencia: {
        Row: {
          assinatura: string
          chave: string
          concluida_em: string | null
          conversation_id: string | null
          created_at: string
          id: string
          operacao: string
          organization_id: string
          resposta: Json | null
          updated_at: string
        }
        Insert: {
          assinatura: string
          chave: string
          concluida_em?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          operacao: string
          organization_id: string
          resposta?: Json | null
          updated_at?: string
        }
        Update: {
          assinatura?: string
          chave?: string
          concluida_em?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          operacao?: string
          organization_id?: string
          resposta?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_idempotencia_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_idempotencia_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_orcamento_itens: {
        Row: {
          descricao: string | null
          descricao_livre: string | null
          estoque_disponivel: boolean | null
          id: string
          orcamento_id: string
          organization_id: string
          peso_kg: number | null
          preco_unitario: number | null
          produto_id: string | null
          quantidade: number | null
          total_item: number | null
        }
        Insert: {
          descricao?: string | null
          descricao_livre?: string | null
          estoque_disponivel?: boolean | null
          id?: string
          orcamento_id: string
          organization_id: string
          peso_kg?: number | null
          preco_unitario?: number | null
          produto_id?: string | null
          quantidade?: number | null
          total_item?: number | null
        }
        Update: {
          descricao?: string | null
          descricao_livre?: string | null
          estoque_disponivel?: boolean | null
          id?: string
          orcamento_id?: string
          organization_id?: string
          peso_kg?: number | null
          preco_unitario?: number | null
          produto_id?: string | null
          quantidade?: number | null
          total_item?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "erp_orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "erp_orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_orcamento_itens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_orcamentos: {
        Row: {
          condicao_pagamento: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          desconto_percentual: number | null
          empresa: string | null
          erp_cliente_id: string | null
          erp_orcamento_id: string
          frete: number | null
          id: string
          impostos: number | null
          link: string | null
          modalidade_entrega: string | null
          organization_id: string
          payload: Json
          peso_total_kg: number | null
          solicitacao_id: string | null
          status: string | null
          subtotal: number | null
          updated_at: string
          validade: string | null
          valor_final: number | null
          vendedor_id: string | null
          wa_number_id: string | null
        }
        Insert: {
          condicao_pagamento?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          desconto_percentual?: number | null
          empresa?: string | null
          erp_cliente_id?: string | null
          erp_orcamento_id: string
          frete?: number | null
          id?: string
          impostos?: number | null
          link?: string | null
          modalidade_entrega?: string | null
          organization_id: string
          payload?: Json
          peso_total_kg?: number | null
          solicitacao_id?: string | null
          status?: string | null
          subtotal?: number | null
          updated_at?: string
          validade?: string | null
          valor_final?: number | null
          vendedor_id?: string | null
          wa_number_id?: string | null
        }
        Update: {
          condicao_pagamento?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          desconto_percentual?: number | null
          empresa?: string | null
          erp_cliente_id?: string | null
          erp_orcamento_id?: string
          frete?: number | null
          id?: string
          impostos?: number | null
          link?: string | null
          modalidade_entrega?: string | null
          organization_id?: string
          payload?: Json
          peso_total_kg?: number | null
          solicitacao_id?: string | null
          status?: string | null
          subtotal?: number | null
          updated_at?: string
          validade?: string | null
          valor_final?: number | null
          vendedor_id?: string | null
          wa_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "erp_orcamentos_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_orcamentos_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_orcamentos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_orcamentos_wa_number_id_fkey"
            columns: ["wa_number_id"]
            isOneToOne: false
            referencedRelation: "wa_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_pedidos: {
        Row: {
          concluido_em: string | null
          confirmado_em: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          erp_cliente_id: string | null
          erp_pedido_id: string
          faturado_em: string | null
          id: string
          modalidade_entrega: string
          motivo: string | null
          nota_chave_acesso: string | null
          nota_numero: string | null
          orcamento_id: string | null
          organization_id: string
          pagamento_expira_em: string | null
          pagamento_link: string | null
          pago_em: string | null
          payload: Json
          status: string
          status_ocorrido_em: string
          updated_at: string
          valor_final: number | null
          valor_pago: number | null
          wa_number_id: string | null
        }
        Insert: {
          concluido_em?: string | null
          confirmado_em?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          erp_cliente_id?: string | null
          erp_pedido_id: string
          faturado_em?: string | null
          id?: string
          modalidade_entrega: string
          motivo?: string | null
          nota_chave_acesso?: string | null
          nota_numero?: string | null
          orcamento_id?: string | null
          organization_id: string
          pagamento_expira_em?: string | null
          pagamento_link?: string | null
          pago_em?: string | null
          payload?: Json
          status: string
          status_ocorrido_em?: string
          updated_at?: string
          valor_final?: number | null
          valor_pago?: number | null
          wa_number_id?: string | null
        }
        Update: {
          concluido_em?: string | null
          confirmado_em?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          erp_cliente_id?: string | null
          erp_pedido_id?: string
          faturado_em?: string | null
          id?: string
          modalidade_entrega?: string
          motivo?: string | null
          nota_chave_acesso?: string | null
          nota_numero?: string | null
          orcamento_id?: string | null
          organization_id?: string
          pagamento_expira_em?: string | null
          pagamento_link?: string | null
          pago_em?: string | null
          payload?: Json
          status?: string
          status_ocorrido_em?: string
          updated_at?: string
          valor_final?: number | null
          valor_pago?: number | null
          wa_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "erp_pedidos_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_pedidos_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_pedidos_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "erp_orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_pedidos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_pedidos_wa_number_id_fkey"
            columns: ["wa_number_id"]
            isOneToOne: false
            referencedRelation: "wa_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_regioes: {
        Row: {
          ativo: boolean
          cidades: Json
          created_at: string
          grupos: string[] | null
          id: string
          nome: string
          organization_id: string
          produto_ids: string[] | null
          regiao_id: string
          sincronizado_em: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cidades?: Json
          created_at?: string
          grupos?: string[] | null
          id?: string
          nome: string
          organization_id: string
          produto_ids?: string[] | null
          regiao_id: string
          sincronizado_em?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cidades?: Json
          created_at?: string
          grupos?: string[] | null
          id?: string
          nome?: string
          organization_id?: string
          produto_ids?: string[] | null
          regiao_id?: string
          sincronizado_em?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      erp_sync_execucoes: {
        Row: {
          created_at: string
          desativados: number
          falhas_do_erp: string[]
          gravados: number
          id: string
          motivo: string | null
          organization_id: string
          problemas: string[]
          status: string
          tipo: string
        }
        Insert: {
          created_at?: string
          desativados?: number
          falhas_do_erp?: string[]
          gravados?: number
          id?: string
          motivo?: string | null
          organization_id: string
          problemas?: string[]
          status: string
          tipo: string
        }
        Update: {
          created_at?: string
          desativados?: number
          falhas_do_erp?: string[]
          gravados?: number
          id?: string
          motivo?: string | null
          organization_id?: string
          problemas?: string[]
          status?: string
          tipo?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          asaas_payment_id: string | null
          created_at: string
          id: string
          organization_id: string
          pago_em: string | null
          status: string
          subscription_id: string | null
          valor_centavos: number
          vencimento: string
        }
        Insert: {
          asaas_payment_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          pago_em?: string | null
          status?: string
          subscription_id?: string | null
          valor_centavos: number
          vencimento: string
        }
        Update: {
          asaas_payment_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          pago_em?: string | null
          status?: string
          subscription_id?: string | null
          valor_centavos?: number
          vencimento?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      labels: {
        Row: {
          cor: string
          created_at: string
          id: string
          nome: string
          organization_id: string
        }
        Insert: {
          cor?: string
          created_at?: string
          id?: string
          nome: string
          organization_id: string
        }
        Update: {
          cor?: string
          created_at?: string
          id?: string
          nome?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "labels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          categoria: string
          created_at: string
          descricao: string
          id: string
          organization_id: string
          slug: string
          texto: string
          variaveis: string
        }
        Insert: {
          categoria: string
          created_at?: string
          descricao: string
          id?: string
          organization_id: string
          slug: string
          texto: string
          variaveis?: string
        }
        Update: {
          categoria?: string
          created_at?: string
          descricao?: string
          id?: string
          organization_id?: string
          slug?: string
          texto?: string
          variaveis?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          autor: Database["public"]["Enums"]["message_autor"]
          camp: boolean
          conversation_id: string
          created_at: string
          id: string
          organization_id: string
          read: boolean
          texto: string
          tipo: string
          wamid: string | null
        }
        Insert: {
          autor: Database["public"]["Enums"]["message_autor"]
          camp?: boolean
          conversation_id: string
          created_at?: string
          id?: string
          organization_id: string
          read?: boolean
          texto: string
          tipo?: string
          wamid?: string | null
        }
        Update: {
          autor?: Database["public"]["Enums"]["message_autor"]
          camp?: boolean
          conversation_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          read?: boolean
          texto?: string
          tipo?: string
          wamid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacoes: {
        Row: {
          contact_id: string | null
          corpo: string
          created_at: string
          id: string
          lida_em: string | null
          organization_id: string
          product_id: string | null
          resolvida_em: string | null
          sale_id: string | null
          status: Database["public"]["Enums"]["notificacao_status"]
          tipo: Database["public"]["Enums"]["notificacao_tipo"]
          titulo: string
          wa_number_id: string | null
          wa_template_id: string | null
        }
        Insert: {
          contact_id?: string | null
          corpo: string
          created_at?: string
          id?: string
          lida_em?: string | null
          organization_id: string
          product_id?: string | null
          resolvida_em?: string | null
          sale_id?: string | null
          status?: Database["public"]["Enums"]["notificacao_status"]
          tipo: Database["public"]["Enums"]["notificacao_tipo"]
          titulo: string
          wa_number_id?: string | null
          wa_template_id?: string | null
        }
        Update: {
          contact_id?: string | null
          corpo?: string
          created_at?: string
          id?: string
          lida_em?: string | null
          organization_id?: string
          product_id?: string | null
          resolvida_em?: string | null
          sale_id?: string | null
          status?: Database["public"]["Enums"]["notificacao_status"]
          tipo?: Database["public"]["Enums"]["notificacao_tipo"]
          titulo?: string
          wa_number_id?: string | null
          wa_template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notificacoes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificacoes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificacoes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "business_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificacoes_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificacoes_wa_number_id_fkey"
            columns: ["wa_number_id"]
            isOneToOne: false
            referencedRelation: "wa_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_eventos: {
        Row: {
          evento_id: string
          id: string
          ocorrido_em: string | null
          orcamento_id: string
          organization_id: string
          payload: Json
          recebido_em: string
          status: string | null
        }
        Insert: {
          evento_id: string
          id?: string
          ocorrido_em?: string | null
          orcamento_id: string
          organization_id: string
          payload: Json
          recebido_em?: string
          status?: string | null
        }
        Update: {
          evento_id?: string
          id?: string
          ocorrido_em?: string | null
          orcamento_id?: string
          organization_id?: string
          payload?: Json
          recebido_em?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_eventos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamentos_em_andamento: {
        Row: {
          contact_id: string | null
          conversation_id: string
          created_at: string
          dados: Json
          erp_orcamento_id: string | null
          etapa: string
          etapa_desde_mensagem: string | null
          expira_em: string | null
          id: string
          modo: string
          motivo_pausa: string | null
          numero: number | null
          organization_id: string
          pergunta_pendente: string | null
          retorno_para: Json | null
          substitui_id: string | null
          updated_at: string
          versao: number
          wa_number_id: string | null
        }
        Insert: {
          contact_id?: string | null
          conversation_id: string
          created_at?: string
          dados?: Json
          erp_orcamento_id?: string | null
          etapa: string
          etapa_desde_mensagem?: string | null
          expira_em?: string | null
          id?: string
          modo?: string
          motivo_pausa?: string | null
          numero?: number | null
          organization_id: string
          pergunta_pendente?: string | null
          retorno_para?: Json | null
          substitui_id?: string | null
          updated_at?: string
          versao?: number
          wa_number_id?: string | null
        }
        Update: {
          contact_id?: string | null
          conversation_id?: string
          created_at?: string
          dados?: Json
          erp_orcamento_id?: string | null
          etapa?: string
          etapa_desde_mensagem?: string | null
          expira_em?: string | null
          id?: string
          modo?: string
          motivo_pausa?: string | null
          numero?: number | null
          organization_id?: string
          pergunta_pendente?: string | null
          retorno_para?: Json | null
          substitui_id?: string | null
          updated_at?: string
          versao?: number
          wa_number_id?: string | null
        }
        Relationships: []
      }
      organization_integrations: {
        Row: {
          ativo: boolean
          config: Json
          created_at: string
          endereco_base: string
          id: string
          organization_id: string
          tipo: string
          token_atualizado_em: string | null
          token_secret_id: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          config?: Json
          created_at?: string
          endereco_base: string
          id?: string
          organization_id: string
          tipo?: string
          token_atualizado_em?: string | null
          token_secret_id?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          config?: Json
          created_at?: string
          endereco_base?: string
          id?: string
          organization_id?: string
          tipo?: string
          token_atualizado_em?: string | null
          token_secret_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_integrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          acessa_painel: boolean
          ativo: boolean
          cargo: string
          codigo_erp: string | null
          created_at: string
          id: string
          invite_email: string | null
          nome: string
          online: boolean
          organization_id: string
          role: Database["public"]["Enums"]["member_role"]
          telefone_whatsapp: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          acessa_painel?: boolean
          ativo?: boolean
          cargo?: string
          codigo_erp?: string | null
          created_at?: string
          id?: string
          invite_email?: string | null
          nome: string
          online?: boolean
          organization_id: string
          role?: Database["public"]["Enums"]["member_role"]
          telefone_whatsapp?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          acessa_painel?: boolean
          ativo?: boolean
          cargo?: string
          codigo_erp?: string | null
          created_at?: string
          id?: string
          invite_email?: string | null
          nome?: string
          online?: boolean
          organization_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          telefone_whatsapp?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          lembrete_ativo: boolean
          lembrete_horas_antes: number
          ao_estourar_limite: string
          asaas_customer_id: string | null
          cnpj: string | null
          created_at: string
          dados_saude: Json
          descricao: string
          endereco: string | null
          id: string
          nome: string
          nome_fantasia: string
          produtos: string[]
          secoes_ocultas: string[]
          segmento: string
          telefone: string | null
          updated_at: string
          wa_number: string | null
          wa_phone_number_id: string | null
          waba_id: string | null
        }
        Insert: {
          lembrete_ativo?: boolean
          lembrete_horas_antes?: number
          ao_estourar_limite?: string
          asaas_customer_id?: string | null
          cnpj?: string | null
          created_at?: string
          dados_saude?: Json
          descricao?: string
          endereco?: string | null
          id?: string
          nome: string
          nome_fantasia?: string
          produtos?: string[]
          secoes_ocultas?: string[]
          segmento?: string
          telefone?: string | null
          updated_at?: string
          wa_number?: string | null
          wa_phone_number_id?: string | null
          waba_id?: string | null
        }
        Update: {
          lembrete_ativo?: boolean
          lembrete_horas_antes?: number
          ao_estourar_limite?: string
          asaas_customer_id?: string | null
          cnpj?: string | null
          created_at?: string
          dados_saude?: Json
          descricao?: string
          endereco?: string | null
          id?: string
          nome?: string
          nome_fantasia?: string
          produtos?: string[]
          secoes_ocultas?: string[]
          segmento?: string
          telefone?: string | null
          updated_at?: string
          wa_number?: string | null
          wa_phone_number_id?: string | null
          waba_id?: string | null
        }
        Relationships: []
      }
      plans: {
        Row: {
          id: string
          key: Database["public"]["Enums"]["plan_key"]
          max_atendentes: number
          max_msgs_mes: number
          nome: string
          preco_anual_centavos: number
          preco_centavos: number
          visivel: boolean
        }
        Insert: {
          id?: string
          key: Database["public"]["Enums"]["plan_key"]
          max_atendentes: number
          max_msgs_mes: number
          nome: string
          preco_anual_centavos: number
          preco_centavos: number
          visivel?: boolean
        }
        Update: {
          id?: string
          key?: Database["public"]["Enums"]["plan_key"]
          max_atendentes?: number
          max_msgs_mes?: number
          nome?: string
          preco_anual_centavos?: number
          preco_centavos?: number
          visivel?: boolean
        }
        Relationships: []
      }
      questionnaire_responses: {
        Row: {
          contact_id: string
          conversation_id: string | null
          created_at: string
          id: string
          organization_id: string
          respostas: Json
          resultado: string | null
        }
        Insert: {
          contact_id: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          respostas?: Json
          resultado?: string | null
        }
        Update: {
          contact_id?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          respostas?: Json
          resultado?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "questionnaire_responses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questionnaire_responses_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questionnaire_responses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_replies: {
        Row: {
          created_at: string
          id: string
          ordem: number
          organization_id: string
          texto: string
          titulo: string
        }
        Insert: {
          created_at?: string
          id?: string
          ordem?: number
          organization_id: string
          texto: string
          titulo: string
        }
        Update: {
          created_at?: string
          id?: string
          ordem?: number
          organization_id?: string
          texto?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_replies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          id: string
          nome_snapshot: string
          organization_id: string
          product_id: string | null
          quantidade: number
          sale_id: string
          valor_unit_centavos: number
        }
        Insert: {
          id?: string
          nome_snapshot: string
          organization_id: string
          product_id?: string | null
          quantidade?: number
          sale_id: string
          valor_unit_centavos?: number
        }
        Update: {
          id?: string
          nome_snapshot?: string
          organization_id?: string
          product_id?: string | null
          quantidade?: number
          sale_id?: string
          valor_unit_centavos?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "business_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          baixa_aplicada_em: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          id: string
          organization_id: string
          origem: string
          status: Database["public"]["Enums"]["sale_status"]
          updated_at: string
          valor_total_centavos: number
        }
        Insert: {
          baixa_aplicada_em?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          origem?: string
          status?: Database["public"]["Enums"]["sale_status"]
          updated_at?: string
          valor_total_centavos?: number
        }
        Update: {
          baixa_aplicada_em?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          origem?: string
          status?: Database["public"]["Enums"]["sale_status"]
          updated_at?: string
          valor_total_centavos?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          asaas_subscription_id: string | null
          created_at: string
          id: string
          intervalo: string | null
          metodo_pagamento: string | null
          organization_id: string
          periodo_fim: string | null
          periodo_inicio: string
          plan_id: string
          renova_automatico: boolean
          status: string
        }
        Insert: {
          asaas_subscription_id?: string | null
          created_at?: string
          id?: string
          intervalo?: string | null
          metodo_pagamento?: string | null
          organization_id: string
          periodo_fim?: string | null
          periodo_inicio: string
          plan_id: string
          renova_automatico?: boolean
          status?: string
        }
        Update: {
          asaas_subscription_id?: string | null
          created_at?: string
          id?: string
          intervalo?: string | null
          metodo_pagamento?: string | null
          organization_id?: string
          periodo_fim?: string | null
          periodo_inicio?: string
          plan_id?: string
          renova_automatico?: boolean
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_numbers: {
        Row: {
          ativo: boolean
          billing_atualizado_em: string | null
          billing_status: Database["public"]["Enums"]["wa_number_billing_status"]
          coexistencia: boolean
          created_at: string
          id: string
          member_id: string | null
          organization_id: string
          papel: Database["public"]["Enums"]["wa_number_papel"]
          phone_number_id: string
          telefone: string | null
          token_atualizado_em: string | null
          token_secret_id: string | null
          updated_at: string
          waba_id: string | null
        }
        Insert: {
          ativo?: boolean
          billing_atualizado_em?: string | null
          billing_status?: Database["public"]["Enums"]["wa_number_billing_status"]
          coexistencia?: boolean
          created_at?: string
          id?: string
          member_id?: string | null
          organization_id: string
          papel?: Database["public"]["Enums"]["wa_number_papel"]
          phone_number_id: string
          telefone?: string | null
          token_atualizado_em?: string | null
          token_secret_id?: string | null
          updated_at?: string
          waba_id?: string | null
        }
        Update: {
          ativo?: boolean
          billing_atualizado_em?: string | null
          billing_status?: Database["public"]["Enums"]["wa_number_billing_status"]
          coexistencia?: boolean
          created_at?: string
          id?: string
          member_id?: string | null
          organization_id?: string
          papel?: Database["public"]["Enums"]["wa_number_papel"]
          phone_number_id?: string
          telefone?: string | null
          token_atualizado_em?: string | null
          token_secret_id?: string | null
          updated_at?: string
          waba_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_numbers_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_numbers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_templates: {
        Row: {
          categoria: string
          corpo: string
          created_at: string
          id: string
          idioma: string
          meta_template_id: string | null
          motivo_rejeicao: string | null
          nome: string
          oculto: boolean
          organization_id: string
          origem: string
          status: string
          updated_at: string
          variaveis: Json
          waba_id: string
        }
        Insert: {
          categoria: string
          corpo: string
          created_at?: string
          id?: string
          idioma?: string
          meta_template_id?: string | null
          motivo_rejeicao?: string | null
          nome: string
          oculto?: boolean
          organization_id: string
          origem?: string
          status?: string
          updated_at?: string
          variaveis?: Json
          waba_id: string
        }
        Update: {
          categoria?: string
          corpo?: string
          created_at?: string
          id?: string
          idioma?: string
          meta_template_id?: string | null
          motivo_rejeicao?: string | null
          nome?: string
          oculto?: boolean
          organization_id?: string
          origem?: string
          status?: string
          updated_at?: string
          variaveis?: Json
          waba_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      agente_turnos_resumo: {
        Row: {
          caminho: string[] | null
          chamadas_erp: number | null
          chamadas_ia: number | null
          conversation_id: string | null
          created_at: string | null
          custo_usd: number | null
          divergencias: string[] | null
          duracao_ms: number | null
          id: string | null
          organization_id: string | null
          origem: string | null
          roteiro: string | null
          sombra_etapa_antes: string | null
          sombra_etapa_depois: string | null
          status: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      apagar_integracao: {
        Args: { p_integration_id: string }
        Returns: boolean
      }
      aprovar_venda: { Args: { p_sale_id: string }; Returns: undefined }
      claim_member_invite: { Args: never; Returns: string }
      create_organization_with_owner: {
        Args: { org_nome: string; org_segmento?: string; owner_nome: string }
        Returns: string
      }
      credencial_da_integracao: {
        Args: { p_integration_id: string }
        Returns: string
      }
      descartar_venda: { Args: { p_sale_id: string }; Returns: undefined }
      guardar_credencial_da_integracao: {
        Args: { p_integration_id: string; p_token: string }
        Returns: string
      }
      guardar_token_do_numero: {
        Args: { p_phone_number_id: string; p_token: string }
        Returns: string
      }
      is_admin_of: { Args: { org_id: string }; Returns: boolean }
      is_member_of: { Args: { org_id: string }; Returns: boolean }
      numerar_orcamento: {
        Args: { p_expira_em: string; p_id: string }
        Returns: {
          expira_em: string
          numero: number
        }[]
      }
      registrar_avisos_erp: {
        Args: { p_avisos: Json; p_org: string }
        Returns: number
      }
      token_do_numero: { Args: { p_phone_number_id: string }; Returns: string }
    }
    Enums: {
      agente_tom: "simpatico" | "direto" | "formal" | "descontraido"
      appointment_status: "agendado" | "confirmado" | "cancelado" | "realizado"
      campaign_status: "ativa" | "agendada" | "encerrada"
      campaign_tipo: "imediato" | "agendado"
      contact_origem:
        | "whatsapp"
        | "instagram"
        | "google"
        | "indicacao"
        | "presencial"
      contact_status: "ativo" | "inativo"
      conversation_modo: "ia" | "humano"
      conversation_status: "aberta" | "encerrada"
      fallback_mode: "encerrar" | "transferir" | "aguardar"
      member_role: "owner" | "admin" | "atendente"
      message_autor: "ia" | "cliente" | "humano" | "nota" | "sys"
      notificacao_status: "pendente" | "resolvida" | "descartada"
      notificacao_tipo:
        | "venda_baixa_estoque"
        | "estoque_minimo"
        | "numero_pagamento_falhou"
        | "template_nao_aprovado"
        | "template_recategorizado"
        | "limite_do_plano"
        | "consulta_desmarcada"
        | "aviso_nao_enviado"
        | "erp_formato_novo"
      plan_key: "basico" | "profissional" | "avancado" | "unico"
      sale_status: "pendente" | "confirmada" | "descartada"
      wa_number_billing_status: "ok" | "pagamento_falhou"
      wa_number_papel: "atendimento" | "vendedor" | "copiloto"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      agente_tom: ["simpatico", "direto", "formal", "descontraido"],
      appointment_status: ["agendado", "confirmado", "cancelado", "realizado"],
      campaign_status: ["ativa", "agendada", "encerrada"],
      campaign_tipo: ["imediato", "agendado"],
      contact_origem: [
        "whatsapp",
        "instagram",
        "google",
        "indicacao",
        "presencial",
      ],
      contact_status: ["ativo", "inativo"],
      conversation_modo: ["ia", "humano"],
      conversation_status: ["aberta", "encerrada"],
      fallback_mode: ["encerrar", "transferir", "aguardar"],
      member_role: ["owner", "admin", "atendente"],
      message_autor: ["ia", "cliente", "humano", "nota", "sys"],
      notificacao_status: ["pendente", "resolvida", "descartada"],
      notificacao_tipo: [
        "venda_baixa_estoque",
        "estoque_minimo",
        "numero_pagamento_falhou",
        "template_nao_aprovado",
        "template_recategorizado",
        "limite_do_plano",
        "consulta_desmarcada",
        "aviso_nao_enviado",
        "erp_formato_novo",
      ],
      plan_key: ["basico", "profissional", "avancado", "unico"],
      sale_status: ["pendente", "confirmada", "descartada"],
      wa_number_billing_status: ["ok", "pagamento_falhou"],
      wa_number_papel: ["atendimento", "vendedor", "copiloto"],
    },
  },
} as const
