# Pontíficeluga

Sistema de ponto facial Pontíficeluga, com terminal Android nativo, API própria e painel web, usando uma base Supabase compartilhada entre locais da mesma empresa.

**Estado: fases 01–03, 05 e 09 concluídas; Android, facial, jornada e painel em andamento.** Banco local, APIs administrativas, pareamento seguro, atribuição de jornadas, programação diária de turnos, sincronização idempotente e fila persistente de recálculo funcionam. O APK de teste possui câmera, Room, Keystore, relógio verificável, detecção e identificação facial local; depois da identificação, o desafio ativo de rotação cria uma batida na fila e agenda a sincronização. Em 15/09/2026, uma batida facial real foi aceita pelo servidor local com relógio verificado. O motor de jornada cobre os exemplos obrigatórios e registra revisões auditadas; o painel React local permite acompanhar jornadas, ocorrências, banco de horas, corrigir uma batida sem alterar o original, autorizar funcionários em locais adicionais, preparar terminais com código de pareamento temporário e baixar relatórios XLSX/PDF do período filtrado. PAD passivo homologado permanece pendente.

Fases 01, 02 e 03 concluídas. Há testes de contratos, motor, banco e integração HTTP para os fluxos administrativos e de jornada. A fase 03 cobre autenticação, administração versionada/auditada, jornadas, terminais, reassociação histórica de local, identidade individual do tablet, relógio verificável e ingestão de batidas. Consulte o [estado das fases](docs/phases.md).

## Começar

Requer Node.js 24 e npm. Na primeira instalação, execute `npm ci` (no PowerShell, `npm.cmd ci` se a política bloquear scripts).

```powershell
npm.cmd run check
npm.cmd test
```

Esses comandos validam os contratos JSON Schema e os exemplos de integração. Não testam reconhecimento, RLS ou sincronização real.

Com o Supabase local ativo, `npm.cmd run api:local` inicia a API usando as chaves locais obtidas pela CLI sem imprimi-las. Esse comando é destinado somente ao desenvolvimento no loopback.

Em outro terminal, `npm.cmd run admin:local` inicia o painel em `http://127.0.0.1:5173`. O comando obtém apenas a URL e a chave pública locais do Supabase e usa um proxy local para a API.

## Operação do painel

O painel separa o trabalho administrativo em abas para que o fechamento não se misture com os cadastros:

- **Funcionários** reúne cadastro, edição, situação e acompanhamento do perfil facial. Ao deixar a matrícula em branco no novo cadastro, o sistema atribui a próxima matrícula disponível da empresa. A edição preserva batidas, escala e perfil facial; desativar um funcionário também preserva o histórico para uma reativação posterior.
- **Configurações** permite manter os cargos e as categorias de justificativa. A instalação inicial contém **Administrativos** e **Chapas**; novos cargos podem ser incluídos, renomeados, desativados ou reativados. Cada categoria de justificativa define se abona as horas previstas, por exemplo atestado, folga ou licença.
- **Pagamentos** mantém valores gerais da empresa, valores por cargo e exceções por funcionário. Cada item é resolvido nesta ordem: funcionário, cargo e empresa. Os itens são independentes: hora normal, hora extra, serão, madrugada, almoço, janta, diária e sábado. Deixar vazio um valor de cargo ou de funcionário faz somente aquele item herdar o nível seguinte.
- **Escalas** registra a jornada por blocos. Uma escala de `08:00–12:00` e `14:00–18:00`, por exemplo, tem quatro posições esperadas. Se a primeira batida ocorrer às 14h, ela é associada à entrada da tarde; as posições da manhã continuam como falta, em vez de serem deslocadas para a tarde.
- **Escala padrão por cargo** permite que, por exemplo, todos os Chapas recebam a mesma jornada ao serem cadastrados. A aplicação para cadastros existentes inclui somente quem não possui uma escala individual ativa ou futura, preservando exceções. Remover o padrão não apaga vínculos já existentes.
- **Apuração** é a consulta única do funcionário e período. Ela mantém todos os dias pesquisados visíveis, mesmo sem batida, e mostra as posições da jornada, horas trabalhadas, abonadas, extras, faltas, saldo de horas e saldo financeiro de cada data, além do total do período. A mesma seleção alimenta os arquivos XLSX e PDF. Batidas realizadas em locais diferentes da mesma empresa compõem a mesma jornada do funcionário; o local aparece como informação da batida, sem dividir o cálculo.

Na Apuração, uma data sem batidas só entra como falta quando houver escala prevista. Para justificar o dia inteiro, use **Justificar dia**, escolha a categoria e, se necessário, acrescente uma observação. O sistema grava se aquela justificativa abonava horas no momento em que foi criada; alterar a categoria depois não modifica cálculos já fechados. Horários podem ser corrigidos ou incluídos com motivo, mantendo o evento original e acionando novo cálculo.

Os valores exibidos na Apuração usam a regra de pagamento atual da empresa, do cargo e do funcionário. Depois de alterar uma dessas regras, consulte o período novamente para atualizar a prévia; o fechamento de uma folha já paga será uma etapa própria quando essa necessidade entrar no processo.

## Documentos

- [Arquitetura e decisões](docs/architecture.md)
- [Modelo de dados e isolamento](docs/data-model.md)
- [Contrato da API e sincronização](docs/api.md)
- [Plano de fases e critérios de aceite](docs/phases.md)
- [Reconhecimento e homologação](docs/face-recognition.md)
- [Avaliação de antispofing/PAD](docs/pad-evaluation.md)
- [Preparação do ambiente local](docs/local-development.md)
- [Requisitos originais](docs/requirements.txt)

## Organização

| Diretório | Responsabilidade | Estado |
| --- | --- | --- |
| `apps/android` | Terminal Kotlin/Compose | Instalado no aparelho de teste; câmera, Room, sync e identificação experimental validados |
| `apps/api` | API TypeScript | Fase 03 concluída: administração, jornadas, terminais e sync |
| `apps/admin` | Painel React/TypeScript | Login, jornadas, ocorrências, banco, correção auditada, cadastros e vínculos administrativos; fase 08 em andamento |
| `packages/attendance` | Motor puro de jornada | Implementado e coberto pelos cenários de jornada da fase 07 |
| `packages/contracts` | Schemas versionados de integração | Implementados e verificáveis |
| `supabase` | Configuração local, migrations e políticas | Base reproduzível, RLS e persistência de batidas validadas |
| `tests` | Testes de contratos | Executáveis localmente |

Não incluir fotos, embeddings, credenciais ou dados pessoais reais em fixtures. As identidades dos exemplos são sintéticas.
