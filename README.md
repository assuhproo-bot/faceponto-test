# FacePonto

Sistema de ponto facial com terminal Android nativo, API própria e painel web, usando uma base Supabase compartilhada entre locais da mesma empresa.

**Estado: fases 01–03, 05 e 09 concluídas; Android, facial, jornada e painel em andamento.** Banco local, APIs administrativas, pareamento seguro, atribuição de jornadas, programação diária de turnos, sincronização idempotente e fila persistente de recálculo funcionam. O APK de teste possui câmera, Room, Keystore, relógio verificável, detecção e identificação facial local; depois da identificação, o desafio ativo de rotação cria uma batida na fila e agenda a sincronização. Em 15/09/2026, uma batida facial real foi aceita pelo servidor local com relógio verificado. O motor de jornada cobre os exemplos obrigatórios e registra revisões auditadas; o painel React local permite acompanhar jornadas, ocorrências, banco de horas, corrigir uma batida sem alterar o original, autorizar funcionários em locais adicionais, preparar terminais com código de pareamento temporário e baixar relatórios XLSX/PDF do período filtrado. PAD passivo homologado permanece pendente.

Fases 01, 02 e 03 concluídas. Há 28 testes de contratos e motor, 84 testes pgTAP e 17 testes HTTP reais aprovados. A fase 03 cobre autenticação, administração versionada/auditada, jornadas, terminais, reassociação histórica de local, identidade individual do tablet, relógio verificável e ingestão de batidas. Consulte o [estado das fases](docs/phases.md).

## Começar

Requer Node.js 24 e npm. Na primeira instalação, execute `npm ci` (no PowerShell, `npm.cmd ci` se a política bloquear scripts).

```powershell
npm.cmd run check
npm.cmd test
```

Esses comandos validam os contratos JSON Schema e os exemplos de integração. Não testam reconhecimento, RLS ou sincronização real.

Com o Supabase local ativo, `npm.cmd run api:local` inicia a API usando as chaves locais obtidas pela CLI sem imprimi-las. Esse comando é destinado somente ao desenvolvimento no loopback.

Em outro terminal, `npm.cmd run admin:local` inicia o painel em `http://127.0.0.1:5173`. O comando obtém apenas a URL e a chave pública locais do Supabase e usa um proxy local para a API.

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
