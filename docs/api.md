# Contrato da API v1

**Implementação parcial.** Health, identidade, empresa, funcionários, locais, terminais, escalas, atribuições de jornada, pareamento, heartbeat, catálogo, âncoras de relógio, sincronização, batidas, correções auditadas, espelho de jornada, ocorrências, banco de horas e relatórios estão disponíveis. O cadastro facial continua delegado ao terminal Android; o painel administrativo local consome as rotas autenticadas. JSON em UTF-8, HTTPS obrigatório fora do loopback de desenvolvimento. Instantes ISO-8601 com deslocamento explícito, UUIDs canônicos em minúsculas e minutos inteiros.

## Rotas disponíveis

Prefixo `/v1`. Token de acesso Supabase no cabeçalho `Authorization: Bearer …`. Login/renovação usam Supabase Auth; API não cria um segundo sistema de senhas.

| Rota | Uso e autorização |
| --- | --- |
| GET /me | Identidade e vínculos ativos do usuário |
| POST /companies | Criar empresa e vínculo inicial em transação autenticada |
| PATCH /companies/{id} | Configurar/desativar empresa com versão otimista |
| GET/POST /employees | Consulta filtrada/cadastro conforme escopo |
| PATCH /employees/{id} | Perfil e desativação auditada com versão otimista |
| POST /facial-profiles | Gestor provisiona uma nova versão dos metadados faciais aceitos pelo terminal; não recebe imagem nem embedding |
| GET/POST /locations | Locais da empresa |
| GET/POST /employee-locations | Vínculos adicionais de funcionário a local, com vigência |
| GET/POST /schedules | Escalas e versões; segmentos arbitrários |
| GET/POST /schedule-assignments | Consultar histórico e vincular versão de escala por vigência |
| PATCH /schedule-assignments/{id}/close | Encerrar atribuição aberta preservando o histórico |
| GET/POST /employee-schedule-plans | Consultar ou programar a escala excepcional de um funcionário para uma data |
| DELETE /employee-schedule-plans/{id} | Retirar programação futura e voltar à escala padrão |
| GET/POST /terminals | Cadastro e monitoramento administrativo |
| PATCH /locations/{id} | Renomear/desativar local com versão otimista |
| PATCH /terminals/{id} | Renomear/desativar terminal com versão otimista |
| POST /terminals/{id}/reassign | Reassociar imediatamente a local ativo, preservando fila e histórico |
| POST /terminals/{id}/pairing | Administrador gera código único expirável |
| POST /terminal/pair | Código de pareamento como credencial inicial; rate limit; consumo atômico |
| GET /terminal/catalog?cursor=… | Catálogo incremental e tombstones autorizados |
| POST /terminal/heartbeat | Status e tamanho da fila; horário do servidor |
| POST /terminal/clock-anchors | Registrar âncora no boot corrente com nonce e incerteza de RTT |
| POST /terminal/sync | Ingestão idempotente dos eventos |
| POST /terminal/security-events | Ocorrências de liveness/qualidade suspeita, sem foto bruta |
| POST /employees/{id}/enrollments | Sessão de cadastro delegada e expirável |
| POST /terminal/enrollments/{id}/complete | Perfil cifrado, versão/hash de modelos e resultado de teste novo |
| GET /punches | Marcações + classificação vigente; filtros aplicados |
| POST /punches/{id}/adjustments | Correção de horário com justificativa e auditoria; RH/admin. Mantém a batida original e coloca o recálculo em fila. |
| GET /punch-adjustments | Histórico das correções de batidas visível apenas no escopo autorizado |
| GET /attendance | Espelho e indicadores por jornada/período |
| GET /occurrences | Filtro por severidade/tipo/status |
| POST /occurrences/{id}/resolution | Resolução auditada |
| GET /bank-hours | Ledger e saldos por período |
| GET /reports/attendance?format=pdf ou xlsx | Exportação PDF/XLSX da mesma consulta autorizada de jornadas |

Cadastro/alteração usa controle de versão otimista (ETag/If-Match); conflito devolve 409. Empresa selecionada não autoriza acesso automaticamente. Nenhuma rota de apagar batida original.

## Sincronização verificável

Schemas executáveis: `packages/contracts/sync-request.schema.json` e `sync-response.schema.json`. Exemplos correspondentes são sintéticos; os hashes não identificam modelos reais. O contrato exige liveness aprovado, mas validar JSON não comprova liveness, autenticidade do hardware, hash homologado ou autorização: são verificações adicionais da implementação.

Lote máximo: 100 eventos e limite de corpo da API de 512 KiB. UUID único por evento dentro do lote. O terminal é identificado pela credencial; o local pelo vínculo histórico autorizado indicado em `terminal_assignment_id`. Sem âncora de relógio o evento pode ser transmitido e preservado em quarentena para revisão.

Processamento previsto por evento:

1. Validar token, terminal ativo, versão/tamanho, funcionário, vínculo temporal de local e evidências homologadas.
2. Calcular hash canônico do payload validado no servidor. Não aceitar hash fornecido pelo cliente como prova de idempotência.
3. Em transação, procurar/inserir UUID e recibo. Constraint protege concorrência; dois requests não podem produzir dois efeitos. Retry idêntico retorna estado original (inclusive quarentena), nunca transforma rejeição/quarentena em aceitação.
4. Gravar evento, recibo e solicitação persistente de recálculo atomicamente. Confirmar só após commit. Falha depois do commit e antes da resposta é resolvida pelo retry do mesmo UUID.
5. Processar demais eventos; retornar exatamente um resultado por ID. Falha estrutural invalida o lote inteiro (400); erro de negócio individual é resultado rejeitado/quarentena. Indisponibilidade antes de processar: 503, sem ACK.

| Resultado | Ação local |
| --- | --- |
| accepted | Persistir recibo, marcar sincronizado; tipo pode estar unclassified aguardando motor |
| already_received | Somente para evento previamente aceito; reutilizar recibo e concluir envio |
| quarantined | Persistir recibo e sinalizar revisão; dado transferido, ponto ainda não aprovado |
| rejected | Preservar registro local e exibir pendência ao gestor; sem retry cego |
| retry | Manter pendente e reagendar |
| Timeout, resposta inválida ou IDs inconsistentes | Manter lote pendente; reenvio seguro |

401 tenta renovação uma vez; se falhar, exige manutenção mantendo fila. 403 por terminal revogado bloqueia sincronização e abre pendência local. 429 respeita Retry-After. Nunca registrar tokens ou corpo biométrico nos logs. Retry de recebimento não implica novo evento de marcação.

A solicitação persistente de recálculo já é criada por trigger na mesma transação da batida. Pedidos do mesmo funcionário são coalescidos ampliando a janela afetada; tentativas, próximo processamento, lease e erro sanitizado ficam no banco para recuperação após falha do processador.

## Erros e relatórios

Erros padronizados terão `code`, `message` simples e `request_id`; detalhes técnicos somente no log sanitizado. Erro “não reconhecido” é resolvido no tablet; não exige API online. Relatórios recebem funcionário, departamento, local, escala, tipo de ocorrência e intervalo inclusivo de datas no fuso da empresa. Converter limites em intervalo UTC semiaberto no servidor, sem depender do fuso do navegador.

PDF/XLSX informam filtros, fuso, data de geração e estado provisório/fechado dos cálculos. Filtrar local não deve recortar um par de entrada/saída e inventar jornada parcial: indicadores de jornada usam jornadas completas que correspondem ao filtro, enquanto listagem de batidas mostra somente batidas do local. O relatório explicita essa semântica.
