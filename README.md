# JoiaFlow — Gestão de Vendas de Semijoias

Sistema SaaS multitenant para lançamento e gestão de vendas de semijoias.
React + TypeScript + Vite + Tailwind no front-end (GitHub Pages) e Supabase (PostgreSQL, Auth, Edge Functions) no back-end.

Arquitetura detalhada: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md)

## Status do desenvolvimento

| Módulo | Situação |
|---|---|
| Login, recuperação de senha, multitenant e segurança (RLS) | ✅ |
| Dashboard (indicadores, gráficos, parcelas a receber) | ✅ |
| Nova venda (categorias visuais, parcelas, vencimentos) | ✅ |
| Histórico (filtros, busca, paginação, edição/exclusão auditadas, pagamentos) | ✅ |
| Relatórios mensais (comparativos, comissão, PDF e Excel) | ✅ |
| Lançamentos financeiros (controle pessoal de entradas e saídas) | ✅ |
| Trocas (devolução + itens novos, recálculo de valor e parcelas, motivo) | ✅ |
| Vendedores (cadastro pelo admin, senha, ativar/desativar) | ✅ |
| Empresas (gestão de várias empresas) | ⏳ em desenvolvimento |

---|---|
| 1. Arquitetura e estrutura | ✅ |
| 2. React/TS/Vite + identidade visual | ✅ |
| 3. Banco de dados Supabase + RLS | ✅ (24 testes de segurança passando) |
| 4. Autenticação e multitenant | ✅ |
| 5. Dashboard | ⏳ |
| 6. Lançamento de vendas | ⏳ |
| 7. Histórico e filtros | ⏳ |
| 8. Relatórios mensais (PDF/Excel) | ⏳ |
| 9. Painel administrativo (telas de Vendedores/Empresas) | ⏳ (Edge Function já pronta) |
| 10. Segurança, testes e publicação | ⏳ |

---

## Passo a passo de configuração

### 1. Criar o projeto no Supabase
1. Acesse <https://supabase.com> → **New project** (região São Paulo, se disponível).
2. Em **Authentication → Sign In / Providers**: desative **Allow new users to sign up**. Mantenha Email habilitado.
3. Em **Authentication → URL Configuration**:
   - *Site URL*: `https://SEU-USUARIO.github.io/joiaflow/`
   - *Redirect URLs*: `https://SEU-USUARIO.github.io/joiaflow/**` e `http://localhost:5173/**`

### 2. Criar o banco
No **SQL Editor**, execute **em ordem** os arquivos de `supabase/migrations/`:
1. `20261113000001_schema.sql`
2. `20261113000002_security_rls.sql`
3. `20261113000003_seed_categories.sql`
4. `20261113000004_profiles_contact_reports.sql`
5. `20261113000005_installments.sql`
6. `20261113000006_sale_items.sql`
7. `20261113000007_category_pulseira.sql`
8. `20261113000008_category_tornozeleira.sql`
9. `20261113000009_commission_financial_entries.sql`
10. `20261114000010_exchanges.sql`

(Ou, com o Supabase CLI: `npx supabase link --project-ref SEU_REF && npx supabase db push`.)

### 3. Publicar a Edge Function de usuários
```bash
npx supabase login
npx supabase link --project-ref SEU_REF
npx supabase functions deploy admin-users
# Opcional: restringir a origem das chamadas
npx supabase secrets set ALLOWED_ORIGINS=https://SEU-USUARIO.github.io,http://localhost:5173
```
A `SUPABASE_SERVICE_ROLE_KEY` é injetada automaticamente pelo Supabase dentro da função. **Nunca** a coloque no front-end, no `.env` do Vite ou no GitHub.

### 4. Criar o primeiro administrador
1. **Authentication → Users → Add user** (marque *Auto Confirm User*).
2. Edite e execute `supabase/bootstrap_first_admin.sql` no SQL Editor.

### 5. Rodar localmente
```bash
cp .env.example .env.local   # preencha URL e ANON KEY (Project Settings → API)
npm install
npm run dev                  # http://localhost:5173/joiaflow/
```

### 6. Publicar no GitHub Pages
1. Crie o repositório `joiaflow` no GitHub e envie o código para a branch `main`.
2. **Settings → Secrets and variables → Actions → Secrets**: crie `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
3. **Settings → Pages → Source**: selecione **GitHub Actions**.
4. Cada `push` na `main` roda testes, build e publica em `https://SEU-USUARIO.github.io/joiaflow/`.
5. Se o repositório tiver outro nome ou usar domínio próprio, crie a *variable* `BASE_PATH` (ex.: `/` para domínio próprio).

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Typecheck + build de produção |
| `npm test` | Testes unitários (dinheiro, parcelas, fuso horário) |
| `./supabase/tests/run.sh` | 73 testes de segurança/parcelas num PostgreSQL local descartável |

## Segurança — resumo
- Sem cadastro público; usuários só pela Edge Function `admin-users`.
- RLS em todas as tabelas; vendedor nunca vê outra empresa ou outro vendedor.
- Exclusão lógica + trilha de auditoria automática.
- Service role só no servidor do Supabase.
