# Fases e critérios de conclusão

Executar em ordem. Nenhuma fase posterior pode ser declarada funcional por ter arquivos ou mocks. Testes de contrato não substituem integração, hardware ou teste de segurança.

| Fase | Dependência | Entrega | Verificação necessária | Estado |
| --- | --- | --- | --- | --- |
| 01 Arquitetura | Requisitos | Stack, estrutura, banco lógico, auth, contratos | Compilar schemas, validar exemplos e invariantes de mensagens | Concluída: check + 28 testes passaram |
| 02 Supabase | 01 + ambiente local | Migrations, RLS, empresas, usuários, funcionários, locais, terminais | Subir stack limpa, reset, integridade e isolamento com dois tenants/roles | Concluída: migrations reproduzidas; suíte atual com 84 testes pgTAP e lint limpo |
| 03 API | 02 aprovada | Auth, funcionários, jornadas, terminais, sync | HTTP real + banco, erro de auth, concorrência e idempotência | Concluída; suíte atual com 17 testes HTTP reais + 84 pgTAP |
| 04 Android | 03 + SDK/JDK/tablet | Câmera, kiosk, estados de captura e confirmação | Compilar APK e executar tablet; pipeline facial só é homologado na 06 | Em andamento: APK, câmera frontal, pareamento real, credencial Keystore e estados executados no aparelho de teste |
| 05 Offline | 04 | Room, fila, WorkManager, relógio | Modo avião, kill/restart, reconexão, queda durante ACK, clock/boot | Concluída no aparelho: todos os cenários previstos foram aprovados |
| 06 Facial | 05 + hardware/modelos | Cadastro, identificação e liveness reais | Pessoa, impostor, foto, vídeo, qualidade e latência no hardware | Em andamento: detecção, embedding cifrado, identificação e desafio ativo validados; PAD homologado pendente |
| 07 Jornada | 06 | Classificação e cálculos independentes | Casos de jornada diurna/noturna, ambiguidades e regras configuradas | Em andamento: motor puro com 7 testes, revisões/estornos, fila com lease, processamento automático e correções auditadas de batidas |
| 08 Painel | 07 | Dashboard e módulos administrativos | Fluxos autenticados, filtros, permissões e layout responsivo | Em andamento: React/Vite local com autenticação Supabase, filtro por empresa/período, jornadas, ocorrências, banco de horas, correção auditada, gestão de funcionários/locais/terminais, vínculos de local e escala, programação diária de turnos e código de pareamento temporário |
| 09 Relatórios | 08 | PDF/XLSX e filtros | Abrir arquivos e comparar números/linhas com mesma consulta do painel | Concluída localmente: XLSX e PDF autenticados, mesmo filtro do painel, totais e isolamento de tenant verificados |
| 10 Ponta a ponta | 09 + dois tablets | MVP validado | Executar matriz abaixo com evidências reais | Em andamento: uma batida facial real foi aceita pelo servidor local; os demais cenários da matriz continuam pendentes |

As fases 04/05 podem validar persistência com eventos sintéticos em testes explicitamente identificados. Isso não habilita marcação facial em produção antes da fase 06. A integração final da UI com o serviço facial faz parte da fase 06, resolvendo a dependência da câmera solicitada antes da homologação do reconhecimento.

## Matriz obrigatória

| Cenário | Resultado esperado |
| --- | --- |
| Internet funcionando | Captura real, commit local, ACK persistido e painel atualizado |
| Internet desligada | Captura/identificação local e fila persistida; sem dependência de rede |
| Internet retornando | Drenar pendências sem duplicar, com recibos por evento |
| Queda após commit antes do ACK | Mesmo UUID retorna recibo original |
| Dois tablets simultâneos | Um banco e nenhuma colisão/perda; reprocessamento consistente |
| Funcionário em dois locais | Jornada única quando autorizado; histórico correto dos locais |
| Reconhecimento facial | Funcionário correto com margem/limiar homologados |
| Foto/vídeo em tela ou papel | Recusar e registrar suspeita, sem criar marcação aceita |
| Marcação duplicada | Retry idêntico idempotente; UUID com payload diferente conflita |
| Turno 22h–06h | 480 minutos na mesma instância de jornada |
| Duas batidas 14h–22h | 480 minutos; não exigir intervalo inexistente na escala |
| Quatro batidas 08h/12h/13h30/18h | 510 minutos trabalhados e 90 de intervalo |
| Atraso 08h05 | 5 minutos brutos antes de aplicar tolerância configurada |
| Extra, saída 18h40 e entrada 08h05 | Extra bruto 40, atraso 5, saldo +35 com intervalo completo |
| Esquecimento de saída | Ocorrência após janela; nenhum horário de saída presumido |
| Banco +35 e -20 | +15; reprocessar não duplica lançamento |
| Exportação | PDF/XLSX com filtros, fuso e totais idênticos à consulta |
| Mudança de relógio e reboot offline | Preservar originais, detectar divergência ou marcar não verificado |
| Funcionário/terminal revogado | Sem novo acesso online; fila prévia preservada e tratada na reconexão |
| Empresa A tentando ler/alterar B | Negado por API/RLS/FKs/RPC, sem revelar dados |
| Correção administrativa | Original intacto, motivo obrigatório, autor, revisão e auditoria atômica |

## Ambiente

Usuário escolheu Supabase local para desenvolvimento em 13/09/2026. Node 24.15.0 e npm 11.12.1 disponíveis. Android Studio, JDK embarcado e SDK encontrados; compatibilidade JDK/SDK/ABI deve ser verificada na fase Android. WSL 2 e Rancher Desktop com Moby estão operacionais, e a stack local do Supabase foi validada após a reinicialização.

Nenhum projeto remoto foi vinculado ou alterado. Não foram solicitadas credenciais pelo chat. A validação física inicial da leitura facial foi concluída no telefone de teste; o APK ARM64 e o terminal administrativo permanecem preparados. Manter este documento atualizado com comandos, resultados e limitações reais.

## Evidência parcial da fase 05

- No aparelho SM-S911B, a API local foi confirmada indisponível enquanto Supabase, USB e a rede pessoal permaneceram inalterados.
- Após encerrar e abrir somente o FacePonto, CameraX iniciou, o catálogo continuou com 1 funcionário, a fila permaneceu em 0 e a âncora ainda não expirada foi validada pelo tempo monotônico.
- O WorkManager registrou falha de I/O e manteve retry. Depois de restaurar a API por `npm.cmd run api:local`, um novo trabalho terminou com `SUCCESS`.
- Uma identidade `OFFLINE-PROBE`, sem biometria pessoal, gerou evento sintético no APK `debug`. Com a API desligada, o Room mostrou fila 1 após encerrar/reabrir o processo; após reconexão, a fila chegou a 0 e o PostgreSQL confirmou evento aceito, relógio verificado e recibo.
- Um gancho habilitado somente por `api:local:faults` derrubou a resposta depois do commit. Antes do backoff, o servidor tinha recibo e o Room mantinha `pending_count=1`; o retry do mesmo UUID recebeu o resultado idempotente e zerou a fila sem duplicar o evento.
- Os ensaios não criaram marcação para pessoa real nem alteraram configurações do aparelho. Ao final, a sonda, o perfil e seus eventos sintéticos foram removidos de forma restrita; a API normal foi restaurada e o aplicativo voltou ao estado-base com catálogo 1, fila 0 e relógio verificado.
- O gancho de queda pós-commit permanece desabilitado por padrão e só pode ser iniciado explicitamente com `npm.cmd run api:local:faults`; o APK de produção não envia o cabeçalho de ativação usado pelo ensaio.
- O aparelho foi reiniciado de forma controlada: o `BOOT_COUNT` passou de 460 para 461, catálogo 1 e fila 0 foram preservados, e a âncora do boot anterior não foi aceita. Depois da API voltar, uma nova âncora foi obtida e a interface mostrou `Relógio verificado`.
- Com modo avião ativo e o túnel USB removido, o app preservou catálogo 1, fila 0 e a âncora válida do boot 461 após kill/restart. O worker falhou por conexão, retornou `RETRY` e não perdeu estado. Ao desativar o modo avião e restaurar o túnel, o trabalho terminou com `SUCCESS`; o aparelho ficou com modo avião desativado, catálogo 1, fila 0 e relógio verificado.

## Retomada após reinicialização

Usuário confirmou reinício do Windows. WSL 2 disponível. Conector Supabase autenticado; o único projeto remoto listado estava INACTIVE e não foi alterado. Mantida a escolha anterior de desenvolver localmente.

Rancher Desktop 1.24.0 instalado pelo winget oficial, hash verificado, Moby 29.5.3 iniciado sem Kubernetes. Supabase local disponível. O projeto remoto inativo não foi alterado.

Schema aplicado, diagnósticos executados e migrations geradas. A primeira reconstrução detectou perda de privilégios por coluna devido à ordenação do `pg-delta`; a migration `phase02_restore_column_grants` corrigiu a divergência. Uma segunda reconstrução limpa aplicou somente as migrations e passou em todos os testes.

## Evidência da fase 02

- Migrations locais `20260913215253_phase02_foundation.sql` e `20260913215502_phase02_restore_column_grants.sql` aplicadas numa base recriada pela CLI.
- `supabase test db`: 44 testes pgTAP aprovados. Abrange RLS de dois tenants, perfis, revogação imediata, FKs compostas, auditoria, imutabilidade, bootstrap e escalas noturnas/sobrepostas.
- `supabase db lint --local --level warning`: nenhum erro de schema.
- Advisors de segurança (incluindo INFO) e desempenho (WARN+): nenhum problema encontrado.
- Auth health e Studio responderam HTTP 200 após a reconstrução.
- A fase cobre a fundação prevista na ordem obrigatória. Marcações e idempotência persistida pertencem à implementação da API/fase 03.

## Evidência parcial da fase 03

- API Fastify/TypeScript criada com configuração validada e limite de corpo de 512 KiB.
- Tokens são validados por `auth.getUser`; clientes sem identidade, anônimos ou com token inválido recebem 401.
- A API encaminha o JWT verificado para consultas sujeitas a RLS. A chave secreta fica limitada ao provisionamento da identidade individual do terminal; nunca integra o APK ou o painel.
- `npm.cmd run api:test`: 11 testes de integração aprovados contra Auth + PostgREST + PostgreSQL locais, incluindo dois tenants, edições versionadas/auditadas, tentativa cruzada, jornadas sem sobreposição, reassociação transacional de terminal, pareamento de uso único, catálogo por local, âncora de relógio e sync idempotente.
- `npm.cmd run typecheck`: aprovado. `npm audit`: nenhuma vulnerabilidade após atualizar Ajv para 8.20.0.
- As migrations da fase 03 criam escalas em transação, pareamento com código armazenado por hash, identidade por terminal, heartbeat, catálogo, âncoras de relógio e marcações persistidas com recibo.
- Retry idêntico devolve o recibo original; UUID reutilizado com payload diferente é recusado; eventos sem relógio verificável são preservados em quarentena.
- Reconstrução limpa aprovada com 55 testes pgTAP, lint e advisors de segurança/desempenho sem achados.
- Atribuição de escalas, leitura do histórico e encerramento de vigência foram implementados por RPC transacional com isolamento de tenant e exclusão temporal no banco.
- Empresas, funcionários, locais e terminais possuem edição/desativação sem exclusão, versão otimista, incremento seletivo e auditoria. Heartbeat não incrementa a versão administrativa do terminal.
- Reassociação imediata de terminal fecha e abre vínculos no mesmo instante, preserva `terminal_status`/fila, incrementa versões e mantém o histórico. A fase 03 está concluída.

## Evidência da fase 01

- `npm.cmd run check`: schemas JSON Schema 2020-12 compilados com Ajv em modo estrito e formatos validados; exemplos compatíveis.
- `npm.cmd test`: 21 testes, 21 aprovações, nenhuma falha. O sandbox Windows inicialmente bloqueou subprocesso com EPERM; execução autorizada fora do sandbox passou.
- Testes validam contratos de transmissão, não efeitos de banco ou eficácia biométrica. Idempotência real, RLS e hardware continuam pendentes.
- `supabase init`: executado com a CLI 2.117.0. `supabase start`: configuração lida, inicialização interrompida por ausência de Docker/Podman.
- `npm.cmd run doctor`: identificou JDK/SDK Android e ausência de runtime; código 1 esperado enquanto essa dependência faltar.
