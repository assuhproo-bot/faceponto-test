# Painel — fase 08

React, TypeScript e Vite. O painel local permite entrar ou criar a primeira empresa, selecionar empresa e período, consultar jornadas, ocorrências e banco de horas, e criar uma correção administrativa de batida. A correção sempre preserva o evento original, exige motivo e aciona o recálculo no backend.

Execute `npm.cmd run api:local` e, em outro terminal, `npm.cmd run admin:local`. O painel fica em `http://127.0.0.1:5173` e usa o proxy do Vite para a API local. A URL e a chave pública locais do Supabase são obtidas pelo script; nenhuma chave secreta é exposta ao navegador.

`npm.cmd run admin:build` gera a versão estática em `apps/admin/dist`. O painel não reimplementa cálculos de jornada. A criação de escalas permite escolher os dias da semana, adicionar até doze períodos de trabalho e indicar quando um período termina no dia seguinte. Também permite cadastrar um terminal vinculado a um local e gerar seu código de pareamento de uso único, válido por dez minutos. A geração do código fica sob ação explícita do administrador; nenhum terminal é criado automaticamente.

Os botões de relatório baixam XLSX ou PDF da mesma consulta de jornadas filtrada no painel. O arquivo apresenta período, fuso, totais previsto/trabalhado/saldo e uma linha por colaborador e data. A API aplica as permissões da empresa antes de criar o arquivo.

Ocorrências abertas podem ser resolvidas no painel somente com uma justificativa. A marcação original e o cálculo que originaram a ocorrência não são alterados.

No cadastro de funcionário, o local principal é o local padrão. A seção **Autorizar outros locais** cria vínculos adicionais com vigência, permitindo que o funcionário apareça no catálogo de terminais desses locais sem alterar seu local principal.

A seção **Vínculos de escala** mostra a escala, a versão e a vigência de cada funcionário. Um vínculo ativo pode ser encerrado em uma data; a regra do banco impede que escalas do mesmo funcionário tenham vigências sobrepostas.

A seção **Programação diária** agenda uma escala excepcional para um funcionário em uma data específica. Ela prevalece somente naquele dia e pode ser retirada para voltar à escala padrão; depois de uma batida aceita, a programação daquela data fica protegida contra alteração.

## Organização do painel

O painel agrupa as rotinas em **Visão geral**, **Apuração**, **Pagamentos**, **Funcionários**, **Terminais e locais**, **Escalas** e **Configurações**. Os filtros de funcionário e período ficam na Apuração, junto com o espelho e os botões de XLSX e PDF; os dois arquivos sempre usam exatamente o filtro que está sendo exibido.

### Funcionários e cargos

Em **Funcionários**, deixe a matrícula vazia para o sistema gerar a próxima disponível. Use **Editar** para ajustar matrícula, nome, cargo, descrição complementar, local principal e situação. Essa edição não remove batidas, escalas ou a amostra facial. Funcionários desativados continuam na lista para poderem ser reativados.

Em **Configurações > Cargos**, a empresa começa com **Administrativos** e **Chapas**. Crie os demais cargos ali e selecione o cargo ao cadastrar ou editar o funcionário. Desativar um cargo o retira de novos cadastros, sem apagar funcionários ou histórico associados a ele.

### Valores de pagamento

A aba **Pagamentos** tem três painéis, nesta ordem:

1. **Valores gerais da empresa**, usados como padrão.
2. **Valores por cargo**, aplicados a todos os funcionários daquele cargo.
3. **Valores exclusivos por funcionário**, usados somente para a pessoa escolhida.

Cada valor é independente: hora normal, hora extra, serão, madrugada, almoço, janta, diária e sábado. A Apuração procura cada item primeiro no funcionário, depois no cargo e por último na empresa. Nos painéis de cargo e funcionário, apagar um campo faz apenas aquele valor voltar a herdar o padrão, sem alterar os demais campos.

Os valores calculados são uma prévia com as regras atuais. Após mudar um valor, use **Buscar apuração** de novo para atualizar o período; o fechamento de folha já paga será tratado separadamente quando for necessário.

### Escalas, faltas e justificativas

Uma escala pode ter vários blocos no dia. Por exemplo, `08:00–12:00` e `14:00–18:00` mantém separadas entrada, saída para intervalo, retorno e saída final. As batidas são associadas à posição prevista pelo horário: se a primeira batida válida for às 14h, ela ocupa o retorno da tarde e a manhã fica registrada como falta. Dia sem batida só conta como falta quando há escala prevista.

Em **Escalas > Escala padrão por cargo**, escolha uma escala para cada cargo. Os funcionários novos desse cargo recebem o vínculo automaticamente. Ao aplicar o padrão aos já cadastrados, o painel inclui apenas quem não tem uma escala individual ativa ou futura; vínculos individuais são sempre preservados. Retirar o padrão impede novos vínculos automáticos, mas não remove os já criados.

Na Apuração, escolha **Justificar dia** para marcar uma ausência integral, selecione a categoria e informe uma observação se necessário. Em **Configurações > Categorias de justificativa**, é possível criar, editar, desativar ou remover categorias que ainda não tenham uso. Cada categoria informa se abona as horas previstas. Essa decisão fica registrada na justificativa criada, portanto uma mudança futura na categoria não altera os cálculos históricos.

### Apuração e fechamento

Em **Apuração**, escolha o funcionário, o período e use **Buscar apuração**. A tabela diária mantém todos os dias do período pesquisado, inclusive os dias ainda sem batida; assim os controles de adicionar, editar e justificar permanecem disponíveis. Ela mostra os horários esperados, outras batidas que precisam de revisão, trabalhado, abonado, extra, falta, saldo e financeiro. O rodapé reúne os totais de todo o período. Use os controles de cada data para marcar almoço, janta, diária, madrugada, sábado ou serão; o financeiro é recalculado com os valores configurados.

As batidas de todos os locais autorizados da mesma empresa entram na mesma jornada do funcionário. O local permanece registrado em cada batida, mas não separa a apuração. Para corrigir uma hora, use **Editar** na célula; para uma batida esquecida, use **Adicionar**. Informe o horário e o motivo. O campo aceita, por exemplo, `831` e apresenta `08:31` enquanto você digita. A correção é auditada e o cálculo é atualizado sem reescrever a batida original.
