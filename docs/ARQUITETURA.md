# JoiaFlow — Arquitetura técnica

## Visão geral

```
┌────────────────────────────┐        HTTPS (JWT do usuário)        ┌─────────────────────────────────────┐
│  GitHub Pages (estático)   │ ───────────────────────────────────▶ │  Supabase                           │
│  React + TS + Vite + TW    │                                      │  ├─ Auth (e-mail/senha, sem signup) │
│  usa só a ANON KEY (pública)│ ◀─────────────────────────────────── │  ├─ PostgreSQL + RLS (autorização)  │
└────────────────────────────┘                                      │  ├─ Triggers (validação + auditoria)│
                                                                    │  └─ Edge Function admin-users       │
                                                                    │      (única com SERVICE_ROLE)       │
                                                                    └─────────────────────────────────────┘
```

- **Front-end** é 100% estático. Não guarda segredo nenhum. A anon key é pública por design.
- **Toda autorização está no banco.** Mesmo que alguém altere requisições no navegador, o PostgreSQL recusa (RLS + triggers).
- **Operações privilegiadas** (criar usuário, trocar senha de terceiros, desativar) acontecem só na Edge Function, que valida se quem chama é administrador.

## Perfis de acesso

| Perfil | Escopo |
|---|---|
| `platform_admin` | Todas as empresas. Cria empresas e usuários de qualquer perfil. |
| `org_admin` (gestor) | Apenas a própria empresa. Vê todas as vendas dela, gerencia vendedores dela. |
| `seller` (vendedor) | Apenas as próprias vendas. Edita se o admin permitir; nunca exclui. |

> O perfil `org_admin` é um acréscimo à especificação: permite que cada loja tenha um gestor sem dar acesso à plataforma inteira. Se não for usado, basta não atribuí-lo.

## Autenticação

1. Login com e-mail/senha via Supabase Auth (`signInWithPassword`, fluxo PKCE).
2. Cadastro público **desligado** no Supabase (`enable_signup = false` + configuração no painel) e sem tela de cadastro no app.
3. Após o login, o app carrega `profiles`. Se o perfil estiver inativo ou a empresa desativada, a sessão é encerrada.
4. Ao desativar um usuário, a Edge Function também aplica *ban* no Auth — ele não consegue mais nem obter token.
5. Recuperação: "Esqueci minha senha" → e-mail com link → `/redefinir-senha`. O admin também pode definir nova senha pela Edge Function.

## Separação dos dados por empresa (multitenant)

- Banco único, isolamento por linha: toda venda tem `organization_id` e `seller_id` obrigatórios.
- Funções `SECURITY DEFINER` (`current_org_id()`, `current_role_name()`, `is_platform_admin()`, `is_active_user()`) leem o perfil de quem está logado a partir do JWT (`auth.uid()`), nunca de dados enviados pelo cliente.
- Políticas RLS em `organizations`, `profiles`, `categories`, `sales`, `audit_logs`.
- Trigger `validate_sale`:
  - vendedor: o banco **sobrescreve** `seller_id` e `organization_id` com os dados reais dele;
  - impede mover venda entre empresas, transferir venda, vendedor excluir venda;
  - confere se o vendedor e a categoria pertencem à empresa da venda.
- Exclusão é **lógica** (`deleted_at`/`deleted_by`). Não há política de DELETE.
- `audit_logs` é preenchido apenas por trigger (antes/depois em JSON, autor, data). Ninguém escreve nele pela API.

Testes automatizados em `supabase/tests/` comprovam 24 cenários (vendedor de A não vê B, não vira admin, anônimo bloqueado etc.).

## Parcelas e recebimentos

- Cada venda gera automaticamente suas parcelas na tabela `installments` (trigger no banco).
- Vencimentos mensais a partir do 1º vencimento, sempre no mesmo dia (dias 29–31 caem no último dia dos meses curtos).
- "Pago no ato" marca a 1ª parcela como paga na criação.
- Confirmar/desfazer pagamento grava `paid_at` e `paid_by` (quem confirmou) e entra na auditoria.
- Usuários só podem alterar a coluna `paid_at`; valor e vencimento nunca são editáveis pela API.
- Com parcela paga, o valor/parcelamento/vencimento da venda fica travado (desfaça o pagamento antes).
- O Dashboard alerta parcelas atrasadas, vencendo hoje e nos próximos 7 dias.

## Relatórios

Funções `sales_summary` e `sales_by_month` (SECURITY INVOKER: respeitam o RLS) agregam no banco pela data efetiva da venda, no fuso de Brasília. Exportação em PDF (jsPDF) e Excel (SheetJS), carregadas sob demanda.

## Dinheiro e datas

- Valores em **centavos (bigint)**. Parcelas calculadas pelo próprio banco (colunas geradas):
  `installment_cents = total / n`, `installment_remainder_cents = total % n` (o resto vai na 1ª parcela). Nunca se perde um centavo.
- `sold_at` (timestamptz) é a data **efetiva** da venda e base dos relatórios; `created_at` é só o registro.
- Interface sempre no fuso `America/Sao_Paulo`, DD/MM/AAAA, 24h.

## Estrutura de pastas

```
joiaflow/
├─ .github/workflows/deploy.yml   # build + testes + publicação no GitHub Pages
├─ docs/                          # arquitetura e passo a passo de publicação
├─ public/                        # favicon
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/                 # schema, segurança/RLS, categorias
│  ├─ functions/admin-users/      # Edge Function (service role fica só aqui)
│  ├─ tests/                      # testes de isolamento RLS (Postgres local)
│  └─ bootstrap_first_admin.sql   # cria o 1º administrador
└─ src/
   ├─ components/ui/              # Button, Card, Field, Alert, Toast, Logo…
   ├─ components/layout/          # AppLayout (sidebar/drawer/barra inferior), navegação
   ├─ contexts/AuthContext.tsx    # sessão + perfil + empresa
   ├─ routes/guards.tsx           # RequireAuth, RequireAdmin, PublicOnly
   ├─ lib/                        # supabase, money, datetime, password
   ├─ pages/                      # telas (auth/, Settings…)
   └─ types/database.ts
```

## Hospedagem

- GitHub Pages serve o build do Vite. `base` = `/<nome-do-repo>/` (configurável por `VITE_BASE_PATH`).
- Rotas com `BrowserRouter` + `basename`; o workflow copia `index.html` para `404.html`, então links diretos (ex.: `/joiaflow/historico`) funcionam.
- Supabase roda independente; trocar de hospedagem (Vercel, Netlify, domínio próprio) exige só mudar `VITE_BASE_PATH`.

## Custos

Supabase Free (500 MB de banco, 50 mil usuários ativos/mês, Edge Functions incluídas) + GitHub Pages grátis. Atenção: no plano Free o projeto Supabase é pausado após 7 dias sem uso.
