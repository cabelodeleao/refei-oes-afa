# Refeições AFA — Manual do Projeto

> Este arquivo descreve o projeto para que você (Claude Code) entenda o contexto rapidamente, sem precisar vasculhar todos os arquivos. Leia antes de começar qualquer tarefa.

## O que é
Sistema web para cadetes da Academia da Força Aérea (AFA) marcarem refeições opcionais e para fiscalização da entrada no rancho via QR code. Substitui uma planilha do Google Sheets onde cada coluna era uma refeição de um dia e cada cadete marcava "Sim"/"Não".

São ~629 cadetes em 4 esquadrões.

## Stack
- **Next.js 14** (App Router)
- **Supabase** (PostgreSQL + Storage)
- **Vercel** (deploy)
- **Tailwind CSS**
- **Autenticação**: JWT em cookie httpOnly usando `jose`, senhas com `bcryptjs`. NÃO usa Supabase Auth.
- **Excel**: `exceljs`
- **QR code**: geração e leitura (html5-qrcode para a câmera)
- Deploy sob o GitHub do usuário (cabelodeleao)

## Variáveis de ambiente
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`

## Regras de negócio (IMPORTANTE — não óbvias pelo código)

### Esquadrões (mapeamento turma → esquadrão)
- Turma 26/xxx = 1º Esquadrão (1º ano)
- Turma 25/xxx = 2º Esquadrão (2º ano)
- Turma 24/xxx = 3º Esquadrão (3º ano)
- Turma 23/xxx = 4º Esquadrão (4º ano)
- squadron 0 = admin/fiscal (não pertence a esquadrão)

### Estados de acesso por refeição (por esquadrão)
Cada refeição (meal_slot) define, para cada esquadrão, um de três estados:
- **"opcional"** — o cadete escolhe marcar Sim/Não
- **"todos"** (obrigatório) — todos do esquadrão vão comer
- **"ninguem"** — refeição não disponível para o esquadrão
Armazenado como JSONB: `{ "1": "opcional", "2": "todos", "3": "ninguem", "4": "opcional" }`

### Refeição obrigatória = opcional pré-marcada (TODOS os esquadrões)
Quando uma refeição está como **"todos"** (obrigatória), para os 4 esquadrões:
- aparece MARCADA por padrão e leva a etiqueta "Obrigatória" no painel do cadete
- MAS o cadete pode desmarcar se realmente não for comer (opt-out)
Antes só o 3º e o 4º ano podiam desmarcar; desde ago/2026 o 1º e o 2º também podem
(a etiqueta "Obrigatória" continua aparecendo para todos).
Isso afeta: painel do cadete, validação no PUT /api/marks, contagem no resumo,
fiscalização (quem desmarcou não entra) e exportação.
No banco: sem linha em meal_marks = "Sim"; linha com attending=false = "Não".

### Senha e primeiro acesso
- Senha inicial de todos: "123456"
- Cadetes e fiscais são FORÇADOS a trocar a senha no primeiro login (campo must_change_password). O admin NÃO é forçado.
- Quando o admin reseta a senha de alguém, must_change_password volta a TRUE.

### Prazo / disponibilidade
- O admin controla manualmente quais refeições existem e quais esquadrões participam, criando meal_slots por intervalo de datas.
- O admin pode bloquear (locked) refeições — quando locked, cadetes não podem mais alterar.
- A visão principal do cadete mostra as refeições de HOJE em diante. As passadas ficam na aba "Últimos 7 dias" (GET /api/slots?history=1), somente consulta (tudo locked). O admin continua vendo tudo.
- Fuso horário: sempre America/Sao_Paulo.

## Esquema do banco (principais tabelas)
- **cadets**: id, number, name, squadron (0-4), password_hash, is_admin, is_fiscal, is_rancho, must_change_password, qr_token, password_changed_at, created_at. Tokens JWT emitidos antes de password_changed_at são rejeitados em getSession (troca/reset de senha derruba sessões antigas).
- **meal_slots**: id, date, meal_type ('cafe'/'almoco'/'janta'/'ceia'), squadrons (JSONB com estados por esquadrão), locked, created_at. UNIQUE(date, meal_type)
- **meal_marks**: id, cadet_id, slot_id, created_at. UNIQUE(cadet_id, slot_id). Existência da linha = marcou "Sim".
- **meal_entries**: registro oficial de entradas autorizadas (fiscalização). UNIQUE(cadet_id, slot_id)
- **scan_attempts**: log de TODAS as leituras de QR (result: 'autorizado'/'nao_marcou'/'duplicado'), flagged_person, fiscal_note
- **menu_photos**: cardápio da semana (title, image_url, storage_path, active, sort_order). VÁRIAS imagens podem estar ativas ao mesmo tempo (uma por dia: sexta, sábado, domingo…, até 6); o cadete vê todas em um carrossel, na ordem de sort_order.

## Papéis de usuário
- **Cadete**: marca refeições do próprio esquadrão, vê cardápio, tem QR code. Vai para /cadete.
- **Fiscal**: conta separada (criada pelo admin, geralmente sargentos). Escaneia QR na entrada do rancho. Vai para /fiscal.
- **Admin**: gerencia refeições, vê resumo, fiscalização, cardápio, cadetes, fiscais. Vai para /admin.
- **Rancho**: conta única e compartilhada (login "rancho" ou "Rancho", `is_rancho=true`, squadron 0, senha 123456, NÃO é forçada a trocar). Vai para /rancho e só CONSULTA o painel de resumo (mesma tabela do admin, lista de nomes e exportação em Excel). Não aprova última hora, não cria/edita nada, não marca refeição. Guardas: `canViewSummary()` em /api/marks/summary, /detail e /export.

## Fiscalização por QR
> **DESLIGADO no momento** (`QR_ENABLED = false` em `src/lib/constants.ts`): o cadete
> não vê o botão "Meu QR" e o fiscal só registra entrada digitando o número do cadete
> (a mesma validação do QR). Todo o código do QR continua no projeto — para religar,
> basta voltar a constante para `true`.

- Cada cadete tem um qr_token secreto (não falsificável). O QR contém esse token.
- O fiscal seleciona a refeição que está fiscalizando e escaneia. Resultado em cores:
  - VERDE: marcou/tem direito, primeira passagem → registra entrada
  - VERMELHO: não marcou/sem direito → registra como 'nao_marcou'
  - AMARELO: QR já usado → registra como 'duplicado'. O fiscal pode anotar QUEM está usando o QR alheio (flagged_person) para punição.
- Aba Fiscalização mostra categorias: Entraram, Entraram sem marcar, QR reutilizado, Faltaram (marcou mas não foi), Sem QR.

## Convenções de design (UX) — seguir sempre
- **Cores por ESTADO** (não por esquadrão): Obrigatório = VERDE, Opcional = AZUL, Ninguém = CINZA. A cor reforça o estado; o texto sempre indica o significado.
- **Texto por extenso**, evitar abreviações crípticas. "Obrigatório", "Opcional", "Ninguém" completos.
- **Mobile-first**, mas aproveitar bem a largura no desktop (dashboards/tabelas não devem ter max-width pequeno que deixe faixa vazia).
- Células/conteúdo do tamanho do conteúdo, sem espaço morto; conteúdo centralizado.
- **Dark mode** suportado.
- Feedback redundante (cor + texto + ícone) para acessibilidade.
- Não poluir com avisos desnecessários: o próprio estado do elemento já é feedback. Só mostrar toast em ERROS.
- Marcação de refeição é otimista e instantânea (atualiza a UI na hora, salva em segundo plano). Sem delay, sem toast de sucesso.

## Restrições técnicas importantes
- **Limite de 1000 linhas do Supabase**: PostgREST retorna no máximo 1000 linhas por query. Em qualquer query que possa passar disso (marcações, entradas, exportações), PAGINAR com .range() em loop. São 629 cadetes e milhares de marcações/entradas.
- Acesso ao banco é via service_role nas API routes (RLS habilitado com políticas permissivas).
- A service_role key NUNCA deve vazar para o client.
- Validações sempre no SERVIDOR (não confiar só no frontend): cadete só marca refeição do próprio esquadrão, não marca slot locked, respeita os estados.

## Como trabalhar comigo (instruções de comportamento)
- **Sempre me avise quando uma mudança exigir rodar SQL no Supabase**, e me dê o SQL pronto para colar no SQL Editor (você não tem acesso DDL ao Supabase).
- **Não quebre funcionalidade existente** ao fazer mudanças visuais. Visual e lógica são separados.
- **Prefira texto por extenso** a abreviações.
- Ao mexer em layout, manter responsividade (celular e desktop) e dark mode.
- Ao final de cada tarefa, **resuma o que mudou** e avise se há algo para eu rodar/testar.
- Cuidado com o limite de 1000 linhas do Supabase em qualquer query nova.

## Deploy
- Push para o GitHub → Vercel rebuilda automaticamente.
- Variáveis de ambiente configuradas na Vercel (as 3 acima).
- O seed (npm run seed) popula os cadetes a partir de cadets-data.json e cria a conta admin. É INSERT-ONLY (ignoreDuplicates): rodar de novo NÃO altera senha/QR de quem já existe. Cadetes individuais são criados/excluídos pelo admin na aba Cadetes.
- Login aceita o número com ou sem barra ("25/217" ou "25217"); o banco armazena com barra.
- Cadetes não podem alterar marcações de refeições de dias que já passaram (validação no PUT /api/marks + cadeado na UI).
