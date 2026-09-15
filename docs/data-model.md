# Modelo de dados proposto

Este é o desenho da fase 01. As tabelas e políticas ainda não foram criadas. A fase 02 deve traduzir estas invariantes em migrations SQL e testar com PostgreSQL/Supabase real.

## Convenções

PK UUID, horário do servidor como default para `created_at`, FKs explícitas e índices nas relações e filtros. Toda entidade da empresa possui `company_id NOT NULL`. Filhos referenciam `(company_id, parent_id)` mediante UNIQUE correspondente no pai, impedindo vínculos cruzados entre empresas mesmo por erro da API. Índices centrais: `(company_id, employee_id, timestamp)` e `(company_id, location_id, timestamp)`.

Status de negócio por enum/check; desativação no lugar de exclusão destrutiva. Versões vigentes não se sobrepõem. CPF é opcional, restrito e protegido, nunca identificador de sincronização. Identidades administrativas pertencem a `auth.users`; `users` guarda apenas perfil público mínimo, sem duplicar senhas.

| Tabela | Campos e restrições principais |
| --- | --- |
| companies | id, name, timezone, active, created_at |
| users | id FK auth.users, display_name; acesso apenas próprio/administrativo autorizado |
| company_memberships | company_id, user_id, role, active; UNIQUE(company_id,user_id); Terminal não é membro administrativo |
| member_locations | company_id, user_id, location_id; escopo de gestores |
| departments | id, company_id, name; UNIQUE(company_id,name) |
| employees | id, company_id, registration, name, cpf_ciphertext opcional, job_title, department_id, home_location_id, active; UNIQUE(company_id,registration) |
| locations | id, company_id, name, active |
| employee_locations | company_id, employee_id, location_id, valid_from, valid_to; autorização de captura por local |
| terminals | id, company_id, location_id, auth_user_id único, code, active, last_heartbeat_at, last_sync_at; UNIQUE(company_id,code) |
| terminal_location_assignments | company_id, terminal_id, location_id, valid_from, valid_to, version; histórico imutável |
| terminal_pairings | id, company_id, terminal_id, code_hash, expires_at, consumed_at, created_by; código usado uma vez |
| clock_anchors | id, company_id, terminal_id, boot_id, server_time, device_elapsed_ms, uncertainty_ms, expires_at |
| work_schedules | id, company_id, name, active |
| schedule_versions | id, company_id, schedule_id, version, effective_from, effective_to, timezone, rules JSONB validado; UNIQUE(company_id,schedule_id,version) |
| schedule_weekdays | company_id, schedule_version_id, iso_weekday 1..7 |
| schedule_segments | id, company_id, schedule_version_id, ordinal, start_minute, end_minute; minuto relativo ao início da data de jornada, pode exceder 1440; intervalos ordenados sem sobreposição |
| schedule_assignments | id, company_id, employee_id, schedule_version_id, valid_from, valid_to; exclusão de vigências sobrepostas do funcionário |
| employee_schedule_plans | id, company_id, employee_id, local_date, schedule_version_id, active, version; uma programação excepcional por funcionário e data, com auditoria e precedência sobre a escala padrão |
| facial_enrollments | id, company_id, employee_id, terminal_id, requested_by, expires_at, status, sample_count, test_result; sessão delegada |
| facial_profiles | id, company_id, employee_id, version, model_id, model_sha256, embedding_ciphertext, quality, active, created_at, revoked_at; acesso biométrico restrito |
| time_punches | id do evento, company_id, employee_id, location_id, terminal_id, timestamp, device_timestamp, server_timestamp, boot_id, device_elapsed_ms, clock_anchor_id opcional, clock_status, source, sync_status, payload_hash, created_at; registro imutável |
| punch_classifications | id, company_id, time_punch_id, work_day_id, revision, punch_type, segment_ordinal, confidence, engine_version; projeção versionada |
| punch_adjustments | id, company_id, original_time_punch_id, employee_id, original_value JSONB, new_value JSONB, corrected_timestamp, reason, actor_id, created_at; correção de horário sem apagar a batida original |
| work_days | id, company_id, employee_id, work_date, schedule_version_id, expected_minutes, worked_minutes, late_minutes, early_leave_minutes, break_minutes, overtime_minutes, balance_minutes, status, revision, engine_version; UNIQUE(company_id,employee_id,work_date,revision) |
| attendance_occurrences | id, company_id, employee_id opcional, terminal_id opcional, work_day_id opcional, severity, type, occurred_at, details sanitizado, resolution, resolved_by, resolved_at |
| bank_hours | id, company_id, employee_id, work_day_id, revision, delta_minutes, reason, reversal_of opcional; ledger imutável com estornos; evitar dupla contabilização de revisão |
| audit_logs | id, company_id, actor_id, action, entity_type, entity_id, before/after sanitizados, reason, request_id, created_at; somente append pelo servidor |
| sync_queue | id, company_id, terminal_id, event_id, payload_hash, result, received_at; recibos de ingestão, UNIQUE(company_id,terminal_id,event_id) |
| system_settings | company_id, key, version, value JSONB validado, effective_from, created_by; sem segredos |

`time_punches.punch_type` será exposto na view/API como a classificação vigente (ou `unclassified`), não como fato sobrescrito no evento. Assim as marcações retornadas ao painel contêm todos os campos mínimos do requisito 3, com rastreabilidade de reclassificações. `sync_status` central indica accepted/quarantined; pending/in_flight/retry pertencem à outbox Room e nunca são aceitos como status imposto pelo cliente.

Local da batida é resolvido pelo histórico autorizado do terminal. Reassociar terminal requer drenar a fila ou encerrar explicitamente a versão anterior; evento guarda `terminal_assignment_id`, verificado contra o terminal autenticado. O ID não dá ao cliente autorização para escolher qualquer local.

## Isolamento e auditoria a implementar

- RLS habilitada em todas as tabelas de negócio; nenhum acesso anônimo. Usuário inativo não lê nem escreve.
- SELECT de empresa exige vínculo ativo e escopo de local quando aplicável. INSERT/UPDATE usam WITH CHECK para empresa e função; operador e terminal não podem elevar privilégios.
- RPC de ingestão confirma identidade do terminal, vínculo, funcionário autorizado, evidências, tamanho e versão do payload. Idempotência e inserção são atômicas.
- Repetição de UUID com mesmo terminal/conteúdo retorna recibo prévio. UUID já usado por outro terminal/empresa, ou conteúdo alterado, retorna conflito sem revelar registro alheio.
- DELETE/UPDATE direto em fatos, ajustes e auditoria é negado aos papéis da aplicação. Correção válida e log devem ocorrer na mesma transação.
- Exportações respeitam RLS e filtros. Perfis faciais não integram consultas gerais de funcionários nem relatórios.
- Criação inicial de empresa + vínculo de administrador via operação autenticada transacional; cliente não escolhe privilégios para si em tabela aberta.

## Room no tablet

`cached_employees`, `cached_facial_profiles`, `catalog_state`, `terminal_configuration`, `clock_anchors`, `time_punches`, `sync_queue` e `security_events`. Índice único por UUID; fila com attempts, next_attempt_at, lease_until e erro sanitizado. Dados locais cifrados, chave protegida no Keystore e sem backup automático. Falha/revogação de chave exige manutenção; não apagar fila pendente silenciosamente.
