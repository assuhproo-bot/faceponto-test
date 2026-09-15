# Banco — próxima fase

O modelo está em `../docs/data-model.md`. Configuração local em `config.toml`, com CLI travada no package-lock. O schema de trabalho originou duas migrations verificadas em `migrations/`; testes estão em `tests/database/phase02.test.sql`.

Fase 02: criar migrations SQL ordenadas, seed exclusivamente sintético e testes transacionais para tabelas, FKs compostas, vigências, RLS, auditoria e idempotência. Validar em Supabase local (CLI + Docker) ou projeto de desenvolvimento dedicado. Não aplicar migrations em base de produção sem revisão do destino e backup.

Não enviar segredos pelo chat. Credenciais permanecem locais e não devem entrar em commits. WSL 2, Moby e Supabase local estão operacionais. Preparação e comandos em `../docs/local-development.md`.
