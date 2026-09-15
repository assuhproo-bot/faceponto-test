# API — fase 03 concluída

Node.js 24, TypeScript, Fastify e Supabase JS. Implementados:

- `GET /health`, sem autenticação;
- `GET /v1/me`, com token validado pelo Supabase Auth;
- `POST /v1/companies`, bootstrap transacional de empresa e administrador;
- `GET /v1/employees`, com filtros de empresa, local e status;
- `POST /v1/employees`, sujeito às políticas RLS;
- `PATCH /v1/employees/:id`, edição/desativação com versão otimista e auditoria;
- `GET/POST /v1/locations`, consulta e criação por empresa;
- `PATCH /v1/companies/:id`, `PATCH /v1/locations/:id` e `PATCH /v1/terminals/:id`, alterações administrativas versionadas, sem exclusão;
- `POST /v1/terminals/:id/reassign`, troca imediata e transacional de local com histórico contínuo e fila preservada;
- `GET/POST /v1/terminals`, monitoramento e cadastro transacional com vínculo ao local;
- `GET/POST /v1/schedules`, criação atômica de versão, dias e segmentos;
- `GET/POST /v1/schedule-assignments` e `PATCH /v1/schedule-assignments/:id/close`, histórico de jornadas por vigência, sem sobreposição;
- `POST /v1/terminals/:id/pairing` e `POST /v1/terminal/pair`, pareamento único e expirável com identidade própria do tablet;
- `POST /v1/terminal/heartbeat` e `GET /v1/terminal/catalog`, estado e catálogo limitado ao local;
- `POST /v1/terminal/clock-anchors` e `POST /v1/terminal/sync`, relógio verificável e ingestão idempotente;
- `POST /v1/terminal/refresh`, renovação da sessão do terminal por refresh token;
- `GET /v1/punches`, leitura sujeita ao escopo de empresa e local.
- `GET /v1/attendance`, espelho versionado por jornada e período;
- `GET /v1/occurrences` e `POST /v1/occurrences/:id/resolution`, consulta e resolução auditada;
- `GET /v1/bank-hours`, livro razão e saldo autorizado por empresa/funcionário.
- `POST /v1/punches/:id/adjustments`, correção administrativa imutável, com motivo, autor, auditoria e recálculo em fila.
- `GET /v1/punch-adjustments`, histórico de correções sujeito ao escopo de empresa e funcionário.

Execute `npm.cmd run typecheck` e `npm.cmd run api:test` com o Supabase local ativo. Os 13 testes de integração usam Auth, PostgREST e PostgreSQL reais, criam dois tenants sintéticos e limpam somente seus próprios dados ao terminar. `SUPABASE_SECRET_KEY` é usada somente pelo endpoint de provisionamento para criar a identidade individual do terminal e consumir o código de pareamento. Ela nunca deve ser enviada ao APK ou ao painel.

Para desenvolvimento, `npm.cmd run api:local` obtém silenciosamente as chaves da CLI local e inicia o servidor no loopback. `npm.cmd run api:start` continua disponível para ambientes cujas variáveis descritas em `.env.example` já estejam configuradas. Não versionar nem imprimir valores de ambiente.

O escopo da fase 03 está concluído. O motor completo de cálculo permanece na fase 07.

Em desenvolvimento local, o processador de jornada inicia junto com `api:local`. Ele usa o papel interno somente para adquirir a fila, ler escala/batidas e publicar revisões; os testes HTTP deixam o worker desligado até o cenário explícito que valida ingestão, lease, cálculo e drenagem ponta a ponta.
