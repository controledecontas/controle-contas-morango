# Controle de Contas — Morango

App para controlar as contas pagas por mim e o rateio com o sócio na produção de morango.

## Stack
- **Backend:** [Supabase](https://supabase.com) free (Postgres + Auth + Storage)
- **Frontend:** HTML/CSS/JS puro + Chart.js, deploy no GitHub Pages
- **Sem servidor próprio** — não usa o Pi da estufa

## Como funciona
- Cada conta paga vira um **lançamento** com descrição, valor total e percentual da minha parte (digitado na hora).
- Saldo é **corrente**: cada lançamento tem flag `quitado`. Quando o sócio paga, marca como quitado.
- Foto da nota fiscal opcional (Supabase Storage, bucket privado).
- Dashboard com gastos por mês e top produtos em aberto.

## Setup local

1. Schema no Supabase: rode [`supabase/schema.sql`](supabase/schema.sql) no SQL Editor.
2. Frontend: edite [`frontend/config.js`](frontend/config.js) com URL e anon/publishable key.
3. Servir local: qualquer servidor estático funciona. Ex: `cd frontend && python -m http.server 8000`.

## Deploy
GitHub Pages servindo a branch `gh-pages`:
```bash
git subtree push --prefix frontend origin gh-pages
```
