# Painel — fase 08

React, TypeScript e Vite. O painel local permite entrar ou criar a primeira empresa, selecionar empresa e período, consultar jornadas, ocorrências e banco de horas, e criar uma correção administrativa de batida. A correção sempre preserva o evento original, exige motivo e aciona o recálculo no backend.

Execute `npm.cmd run api:local` e, em outro terminal, `npm.cmd run admin:local`. O painel fica em `http://127.0.0.1:5173` e usa o proxy do Vite para a API local. A URL e a chave pública locais do Supabase são obtidas pelo script; nenhuma chave secreta é exposta ao navegador.

`npm.cmd run admin:build` gera a versão estática em `apps/admin/dist`. O painel não reimplementa cálculos de jornada. A criação de escalas permite escolher os dias da semana, adicionar até doze períodos de trabalho e indicar quando um período termina no dia seguinte. Também permite cadastrar um terminal vinculado a um local e gerar seu código de pareamento de uso único, válido por dez minutos. A geração do código fica sob ação explícita do administrador; nenhum terminal é criado automaticamente.

Os botões de relatório baixam XLSX ou PDF da mesma consulta de jornadas filtrada no painel. O arquivo apresenta período, fuso, totais previsto/trabalhado/saldo e uma linha por colaborador e data. A API aplica as permissões da empresa antes de criar o arquivo.

Ocorrências abertas podem ser resolvidas no painel somente com uma justificativa. A marcação original e o cálculo que originaram a ocorrência não são alterados.

No cadastro de funcionário, o local principal é o local padrão. A seção **Autorizar outros locais** cria vínculos adicionais com vigência, permitindo que o funcionário apareça no catálogo de terminais desses locais sem alterar seu local principal.

A seção **Vínculos de escala** mostra a escala, a versão e a vigência de cada funcionário. Um vínculo ativo pode ser encerrado em uma data; a regra do banco impede que escalas do mesmo funcionário tenham vigências sobrepostas.

A seção **Programação diária** agenda uma escala excepcional para um funcionário em uma data específica. Ela prevalece somente naquele dia e pode ser retirada para voltar à escala padrão; depois de uma batida aceita, a programação daquela data fica protegida contra alteração.
