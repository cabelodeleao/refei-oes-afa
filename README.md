# Refeições AFA 🍽️

Sistema web para cadetes da **Academia da Força Aérea** marcarem refeições opcionais.
Substitui a planilha do Google Sheets onde cada coluna é uma refeição de um dia e cada
cadete marca "Sim" ou "Não".

## Stack

- **Next.js 14** (App Router) + TypeScript
- **Supabase** (PostgreSQL) — acesso server-side via `service_role` key
- **Tailwind CSS** — UI mobile-first
- **bcryptjs** — hash de senhas
- **jose** — JWT em cookie `httpOnly`
- **exceljs** — exportação do resumo em Excel (.xlsx)

> Autenticação **própria** (não usa Supabase Auth). Login por número do cadete.

---

## Como rodar

### 1. Pré-requisitos
- Node.js 18+
- Um projeto no [Supabase](https://supabase.com)

### 2. Instalar dependências
```bash
npm install
```

### 3. Configurar o banco
No painel do Supabase → **SQL Editor**, cole e execute o conteúdo de
[`supabase-setup.sql`](./supabase-setup.sql). Ele cria as tabelas
(`cadets`, `meal_slots`, `meal_marks`), os índices e as políticas de RLS.

> **Atualizando um banco antigo?** Se o seu `meal_slots.squadrons` ainda é
> `INTEGER[]` (versão anterior), rode também
> [`supabase-migration-squadrons-jsonb.sql`](./supabase-migration-squadrons-jsonb.sql)
> uma única vez para converter o campo para JSONB (cada esquadrão com acesso
> vira `"opcional"`).

### 4. Variáveis de ambiente
Copie o exemplo e preencha:
```bash
cp .env.local.example .env.local
```

| Variável | Onde encontrar |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` (secret) |
| `JWT_SECRET` | Gere um valor aleatório: `openssl rand -base64 32` |

> ⚠️ A `service_role` key é secreta e só é usada no servidor. Nunca a exponha no cliente.

### 5. Popular o banco (seed)
Lê `cadets-data.json` (629 cadetes), gera o hash da senha inicial e cria também a
conta admin:
```bash
npm run seed
```

- **Senha inicial de todos:** `123456`
- **Admin:** número `admin`, senha `123456`

### 6. Rodar em desenvolvimento
```bash
npm run dev
```
Acesse [http://localhost:3000](http://localhost:3000).

---

## Esquadrões

| Número | Esquadrão | Ano |
| --- | --- | --- |
| `26/xxx` | 1º Esquadrão | 1º ano |
| `25/xxx` | 2º Esquadrão | 2º ano |
| `24/xxx` | 3º Esquadrão | 3º ano |
| `23/xxx` | 4º Esquadrão | 4º ano |

`squadron = 0` é reservado para a conta de administração.

---

## Estrutura

```
.
├── cadets-data.json          # 629 cadetes (number, name, squadron)
├── supabase-setup.sql        # schema + índices + RLS
├── scripts/seed.js           # npm run seed
├── middleware.ts             # proteção de rotas + controle de papel
└── src/
    ├── app/
    │   ├── page.tsx          # / (login)
    │   ├── cadete/           # painel do cadete
    │   ├── admin/            # painel do admin (Gerenciar / Resumo)
    │   └── api/              # auth, slots, marks, summary
    ├── components/           # Toggle, ChangePassword, LogoutButton
    └── lib/                  # auth (JWT), supabase, dates, constants
```

---

## Páginas

- **`/`** — Login (número + senha).
- **`/cadete`** — Refeições do esquadrão do cadete, agrupadas por dia. Refeições
  `opcional` têm toggle Sim/Não; `todos` aparecem como **Obrigatória** (sem toggle);
  `ninguem` não aparecem. Bloqueadas ficam em cinza (somente leitura). Inclui troca de senha.
- **`/admin`** — Dois modos:
  - **Gerenciar Refeições:** cria slots por intervalo de datas/refeição/esquadrão,
    grid editável (dias × refeições), bloqueio/desbloqueio e remoção em lote.
  - **Resumo:** contagem por refeição por esquadrão — `opcional` mostra quem
    marcou, `todos` mostra o efetivo em verde (soma no Total), `ninguem` mostra
    `-` em cinza. Detalhe dos cadetes e exportação **Excel (.xlsx)** com uma aba
    por esquadrão + aba "Resumo".

---

## API

| Método | Rota | Descrição |
| --- | --- | --- |
| POST | `/api/auth/login` | Login, retorna JWT em cookie |
| POST | `/api/auth/logout` | Limpa o cookie |
| POST | `/api/auth/change-password` | Troca de senha (mín. 6 caracteres) |
| GET | `/api/slots` | Slots (cadete: do seu esquadrão com marcação; admin: todos) |
| POST | `/api/slots` | (admin) cria/atualiza slots em lote |
| DELETE | `/api/slots` | (admin) remove slots |
| PUT | `/api/slots/lock` | (admin) bloqueia/desbloqueia em lote |
| GET | `/api/marks` | Marcações do cadete logado |
| PUT | `/api/marks` | Marca/desmarca uma refeição (valida lock + esquadrão) |
| GET | `/api/marks/summary` | (admin) contagens + detalhe dos cadetes |
| GET | `/api/marks/export` | (admin) gera o Excel (.xlsx) — abas por esquadrão + Resumo |

---

## Modelo de dados

- **cadets** — `number` (único), `name`, `squadron` (0–4), `password_hash`, `is_admin`.
- **meal_slots** — uma refeição de um dia: `date`, `meal_type` (`cafe`/`almoco`/`janta`/`ceia`),
  `squadrons` (**JSONB** com o acesso de cada esquadrão), `locked`. Único por `(date, meal_type)`.
  - `squadrons` ex.: `{ "1": "opcional", "2": "todos", "4": "opcional" }`
  - Estados: **`opcional`** (cadete marca Sim/Não), **`todos`** (obrigatória — todos
    do esquadrão comem), **`ninguem`** (esquadrão não tem a refeição). Esquadrão
    ausente do objeto = `ninguem`.
- **meal_marks** — existe uma linha ⇒ o cadete marcou "Sim". Único por `(cadet_id, slot_id)`.
