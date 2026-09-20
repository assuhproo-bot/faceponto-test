# Jornada, pagamentos e funcionários — especificação

## Objetivo

Tornar o Pontificeluga previsível para a operação diária: cada batida deve ocupar o horário correto da escala, ausências podem ser justificadas por dia, os valores de pagamento têm regras claras por empresa, cargo e funcionário, e o cadastro de funcionários fica editável com matrícula automática.

## Escopo e critérios de sucesso

- Uma escala de 08:00–12:00 e 14:00–18:00 trata batidas às 14:00 e 18:00 como `Entrada 2` e `Saída 2`.
- Os períodos anteriores sem batidas aparecem como faltas após a carência da escala, sem fabricar horários.
- Um dia justificado mostra a categoria e não entra como falta quando a categoria abona as horas.
- O painel permite configurar valores gerais, por cargo e por funcionário em campos independentes.
- O total financeiro do dia e do período explica cada componente aplicado.
- Cada novo funcionário recebe uma matrícula numérica sequencial no servidor; seus dados permanecem editáveis.
- O painel agrupa as tarefas em abas compreensíveis e mantém relatórios e exportações coerentes com a apuração exibida.

## Jornada baseada nos horários da escala

### Slots esperados

O motor transforma os segmentos da escala em slots ordenados. Para 08:00–12:00 e 14:00–18:00, os slots são:

| Slot | Horário previsto | Coluna do espelho |
| --- | --- | --- |
| 1 | 08:00 | Entrada |
| 2 | 12:00 | Saída 1 |
| 3 | 14:00 | Entrada 2 |
| 4 | 18:00 | Saída 2 |

Cada batida é associada ao slot temporal mais apropriado, de forma monotônica. A escolha não usa somente a quantidade ou a ordem das batidas. Em empate ou situação ambígua, o motor cria uma ocorrência para revisão; ele não escolhe um slot silenciosamente.

### Cálculo por período de trabalho

Cada segmento é avaliado independentemente. Quando tem início e fim registrados, o sistema calcula trabalho, atraso, saída antecipada e extra daquele segmento. Quando faltam slots e a carência já terminou, o período previsto não trabalhado entra como falta.

Exemplos definitivos para 08:00–12:00 e 14:00–18:00:

| Marcações | Trabalhado | Falta | Saldo | Classificação |
| --- | ---: | ---: | ---: | --- |
| 08:00, 12:00, 14:00, 18:00 | 8h00 | 0h00 | 0h00 | quatro slots completos |
| 14:00, 18:00 | 4h00 | 4h00 | -4h00 | Entrada 2, Saída 2 |
| 14:30, 18:00 | 3h30 | 4h30 | -4h30 | Entrada 2 atrasada, Saída 2 |

Antes de a jornada terminar e de a carência expirar, o dia pode permanecer provisório. O relatório identifica esse estado e não trata uma batida ainda em andamento como resultado final.

Turnos noturnos continuam usando minutos relativos à jornada e não devem regredir. A vigência de uma escala será comparada como data local da empresa, para incluir corretamente o primeiro dia e excluir corretamente o dia de encerramento.

## Justificativas de dia inteiro

### Categorias

Haverá categorias por empresa, com nome, situação e regra financeira. As categorias iniciais são:

- Atestado — abona as horas.
- Licença paternidade — abona as horas.
- Folga — abona as horas.

O administrador pode criar, editar, desativar e, quando não houver uso, remover outras categorias. Cada categoria define se as horas previstas são abonadas ou se a ausência continua descontando horas e valor.

### Registro e efeito

Na aba Apuração, cada data terá a ação **Justificar dia**. O responsável escolhe a categoria e registra uma observação opcional. Uma justificativa de dia inteiro substitui o efeito de faltas daquele dia, mantendo as batidas existentes para auditoria.

Uma justificativa abonada mostra:

- Horas trabalhadas reais: somente as que tiveram batida.
- Horas abonadas: a jornada prevista coberta pela justificativa.
- Horas faltantes: zero para o período abonado.
- Saldo de horas: sem desconto pelo período abonado.

As horas abonadas entram no valor de hora normal daquele dia, para que a justificativa não gere desconto financeiro.

Uma justificativa sem abono mantém as faltas e os descontos, mas identifica o motivo na apuração e no relatório. Alterar ou remover a justificativa reprocessa o dia com histórico auditável.

## Cargos e valores de pagamento

### Cargos administráveis

O cadastro existente de departamentos será apresentado no painel como **Cargos**. Cada cargo é uma seleção no funcionário, em vez de texto livre. A implantação cria os cargos `Administrativo` e `Chapa` para a empresa atual sem apagar informações anteriores.

O administrador pode criar, renomear e desativar cargos. Um cargo que possua funcionários associados será desativado, e não excluído, para preservar relatórios e vínculos.

### Hierarquia de valores

Cada categoria de pagamento é resolvida individualmente nesta ordem:

1. Valor exclusivo do funcionário, quando definido.
2. Valor do cargo do funcionário, quando definido.
3. Valor geral da empresa.

Limpar um valor exclusivo ou do cargo volta apenas aquele item ao próximo nível. Os demais valores permanecem inalterados.

Itens independentes:

- Hora normal — valor por hora.
- Hora extra — valor por hora.
- Serão — valor fixo por ocorrência.
- Madrugada — valor fixo por ocorrência.
- Almoço — valor fixo por ocorrência.
- Janta — valor fixo por ocorrência.
- Diária — valor fixo por ocorrência.
- Sábado — valor fixo por ocorrência.

O serão é tratado como valor fixo por ocorrência, de acordo com a planilha de referência. Caso a regra operacional mude para valor por hora, isso será uma alteração explícita de categoria, sem reutilizar silenciosamente a tarifa de hora extra.

### Apuração financeira

O sistema produzirá uma apuração financeira única para a tela, o XLSX e o PDF. Por data, ela apresentará:

- Horas normais e valor correspondente.
- Horas extras e valor correspondente.
- Faltas e desconto correspondente.
- Horas abonadas, quando houver.
- Cada adicional marcado no dia, com quantidade, tarifa e total.
- Total financeiro do dia.

O resumo do período soma cada categoria e apresenta o total a pagar ou descontar. Horas e valores positivos usam verde; faltas e descontos usam vermelho. Alterações de horários, justificativas, adicionais ou tarifas provocam uma atualização da apuração.

## Matrícula e edição de funcionário

### Matrícula automática

O servidor, e não o navegador, atribui a matrícula. O próximo número é reservado de forma transacional por empresa, impedindo duplicação em cadastros simultâneos. Matrículas não numéricas existentes são preservadas e nunca alteradas automaticamente.

Quando uma matrícula numérica é corrigida manualmente para um número maior, a próxima matrícula automática avança para o número seguinte. Matrículas desativadas também não são reutilizadas.

### Edição

Cada funcionário terá uma ação **Editar** com matrícula, nome, cargo, descrição complementar, local principal e situação. A gravação usa versão do registro para evitar que uma alteração sobrescreva outra. Alterar esses dados não modifica o UUID, histórico de pontos, escala, perfil facial ou autorizações de local.

## Organização do painel

| Aba | Conteúdo principal |
| --- | --- |
| Início | Últimas batidas, alertas e resumo operacional |
| Apuração | Filtros, espelho diário, justificativas, correções, totais e exportação |
| Pagamentos | Valores gerais, valores por cargo e valores por funcionário |
| Funcionários | Cadastro, edição, matrícula, cargo, situação e facial |
| Escalas | Escalas, vínculos e programação diária |
| Terminais e locais | Relógios, pareamento e locais |
| Configurações | Categorias de justificativa e cadastros de apoio |

Os filtros de funcionário, período e local ficam dentro de Apuração e são os mesmos usados para a tela, o PDF e o XLSX.

## Migração e compatibilidade

- Dados existentes de funcionários, escalas, batidas e perfil facial permanecem intactos.
- O motor de jornada recebe nova versão e reprocessa jornadas afetadas, preservando revisões anteriores e auditoria.
- Cargos existentes serão reaproveitados quando possível; registros antigos de texto permanecem como descrição complementar.
- Configurações de pagamento existentes continuam válidas como valores gerais ou exclusivos até serem reorganizadas nos novos níveis.
- Justificativas e categorias novas serão auditáveis, com autoria e data.

## Testes essenciais

1. Motor de jornada classifica 14:00/18:00 como Entrada 2/Saída 2 e calcula a falta da manhã.
2. Motor trata entrada tardia no segundo segmento, ausência parcial, empate temporal e turno noturno.
3. Worker inclui a data inicial da vigência e exclui a data de encerramento conforme o fuso da escala.
4. Uma justificativa abonada remove falta e desconto; uma não abonada conserva ambos.
5. Valores resolvem por item na ordem funcionário, cargo e empresa.
6. Almoço, janta, serão e madrugada alteram o total financeiro correto.
7. Tela, XLSX e PDF usam os mesmos resultados financeiros.
8. Matrículas automáticas são sequenciais mesmo sob dois cadastros simultâneos.
9. Edição de funcionário preserva os vínculos e o perfil facial.
