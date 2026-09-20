# Motor de jornada — especificação para fase 07

Implementação inicial em `index.mjs`. A função pura `evaluateAttendance` recebe uma instância de jornada já resolvida para o fuso, segmentos relativos, batidas imutáveis, versões e instante de avaliação. Ela ordena batidas por instante/UUID, mantém resultados incompletos sem saldo final e separa atraso, extra bruto e saldo. `aggregateBalances` soma somente saldos diários finais disponíveis.

O Supabase guarda dias de trabalho, revisões de cálculo, ocorrências e lançamentos do banco de horas. Uma nova revisão torna a anterior `superseded`, estorna seu lançamento e publica o novo saldo na mesma transação. Inserir uma batida também cria ou amplia atomicamente a janela em `private.attendance_recalculation_queue`; a fila não é exposta a clientes.

O processo da API adquire tarefas com lease exclusivo, resolve escala e fuso no servidor, associa cada batida à jornada candidata mais próxima, executa o motor e publica o resultado. Empates entre jornadas geram `AMBIGUOUS_JOURNEY`. Falhas liberam o lease com backoff; tarefas que recebem nova batida durante o processamento não são removidas pelo resultado antigo. Dias futuros não são materializados.

Função pura recebe funcionário, versão da escala, data da jornada, eventos e ajustes, regras e instante de avaliação. Não lê relógio global, não acessa rede/banco e não depende de interface.

Intervalos de trabalho são segmentos previstos com início/fim em minutos relativos à data de jornada. Exemplo noturno: 1320..1800 representa 22h..06h seguinte. Escala A: 480..720 e 810..1080 (510 minutos). Escala B: 840..1320 (480 minutos). Dias trabalhados e vigência delimitam quais instâncias existem.

Associar eventos às janelas de marcação configuradas na escala e às instâncias candidatas. Uma marcação só pode integrar um segmento; múltiplas atribuições plausíveis ou eventos faltantes geram ocorrência, sem escolher silenciosamente a sequência ordinal. Respeitar vínculo/local autorizado no instante e ordenar por instante/UUID de forma determinística. Eventos atrasados na sincronização reprocessam a instância e vizinhas afetadas.

Retorno: minutos previstos, trabalhados confirmados, atrasos, saídas antecipadas, intervalos, extra bruto, saldo líquido, faltas, incompletudes, classificação por evento e ocorrências com severidade. Ausência definitiva só após encerramento da janela + carência configurada; dia em andamento é provisório. Dia sem escala não vira falta. Resultado inclui versão do motor, da escala e das regras.

Exemplo de quatro batidas com intervalo 12h..13h30: previsto 08h..18h, realizado 08h05/12h/13h30/18h40. Previsto 510, trabalhado 545, atraso bruto 5, extra bruto 40, saldo +35. Tolerâncias de marcação e do total diário são configuradas separadamente e aplicadas explicitamente. Não esconder atraso dentro da métrica de extra bruto.

Não converter um segmento com apenas uma das duas batidas em saldo final negativo; manter esse caso para correção manual, com campos finais nulos. Revisão aprovada estorna lançamentos anteriores de banco antes do novo lançamento, sem duplicar crédito. Agregações semanal/mensal respeitam fuso e período, incluindo quantidade distinta de dias atrasados e esquecimentos.

## Associação por slots da escala

Cada segmento previsto gera dois slots, em ordem cronológica: `Entrada` e `Saída` no primeiro período; entre períodos, `Saída 1` e `Entrada 2`; o último slot é sempre `Saída`. Cada batida é associada ao horário previsto mais próximo. Um empate exato entre dois slots fica como `unclassified` com a ocorrência `AMBIGUOUS_SCHEDULE_SLOT`; o sistema não escolhe uma coluna por tentativa.

Depois que termina a carência da jornada, um segmento inteiro sem as duas batidas vira falta do período, sem criar horários fictícios. Assim, numa escala 08:00–12:00 / 14:00–18:00, as batidas 14:00 e 18:00 são `Entrada 2` e `Saída 2`, com quatro horas de falta pela manhã. Um segmento com apenas uma batida continua incompleto e requer correção, pois não há como inferir a hora que faltou.

`regular_minutes` mede o tempo dentro dos limites previstos; `missing_minutes` mede a parte prevista não coberta; `justified_minutes` cobre essa falta quando a categoria abona horas. O saldo preserva o tempo real trabalhado, incluindo eventual extra, e soma as horas abonadas antes de comparar com a jornada prevista.
