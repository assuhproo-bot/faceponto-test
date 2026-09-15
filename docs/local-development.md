# Desenvolvimento local no Windows

Preparação escolhida pelo usuário: Supabase local, sem projeto remoto. CLI `supabase@2.117.0` instalada como dependência de desenvolvimento, configuração gerada pela CLI em `supabase/config.toml`. `project_id = faceponto`, PostgreSQL 17. Exposição automática de novas tabelas desativada: migrations precisam de GRANT e RLS explícitos.

O ambiente local está funcionando. WSL 2, Rancher Desktop 1.24.0 com Moby e Supabase local foram iniciados. As migrations da fase 02 estão aplicadas; não há dados pessoais reais nem projeto remoto vinculado.

## Pré-requisitos do host

1. WSL 2 instalado e Windows já reiniciado pelo usuário. Verificação realizada com `wsl --status`.
2. Instalar Rancher Desktop e selecionar engine **Moby/dockerd**, com Kubernetes desabilitado para reduzir consumo. Alternativa: outro runtime com API Docker suportada pelo Supabase.
3. Confirmar `docker info` com servidor acessível. `docker --version` sozinho não comprova que o banco poderá subir.

A escolha do Rancher evita depender do Docker Desktop como ferramenta obrigatória. Supabase documenta Rancher Desktop como runtime alternativo. A instalação do runtime altera o host; não é uma dependência npm.

## Comandos do projeto

Na raiz do projeto:

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test
npm.cmd run doctor
npm.cmd run db:start
```

`doctor` só inspeciona dependências e retorna código 1 se o runtime estiver ausente/inacessível. `db:start` baixa imagens na primeira execução e inicia a stack local. Não executar `db push`, `link` ou reset de base remota para este fluxo. Para parar preservando dados: `npm.cmd run db:stop`.

Após iniciar, Studio estará normalmente em `http://127.0.0.1:54323`, Auth/API em `http://127.0.0.1:54321`, PostgreSQL em `127.0.0.1:54322` e caixa de e-mail local em `http://127.0.0.1:54324`. São endereços previstos pela configuração, não serviços já verificados. Consulte a saída local da CLI para credenciais; não cole segredos no chat nem os coloque em commits.

Configuração contém apenas Auth, banco/API, Studio e caixa de e-mail de teste. Storage, Realtime, Edge Runtime e analytics estão desabilitados nesta etapa. Sem SMTP externo ou serviço de IA. Reativar somente o que uma fase implementar. Seeds estão desabilitados enquanto não houver schema; não cadastrar dados reais neste ambiente.

O Auth local exige confirmação de e-mail, consultável no servidor de e-mail de teste, e senha com pelo menos 12 caracteres. Ter conta Auth não garante acesso a empresa: isso será controlado por membership e RLS na fase 02.

## Gate da fase 02

Com o runtime acessível, implementar migrations e testes SQL e executar `npm.cmd run db:test`. A CLI não substitui o conjunto de testes: ausência de testes não é aprovação. A validação deve incluir dois tenants, papéis reais, negação de escrita cruzada, imutabilidade e concorrência de ingestão. Só depois iniciar a API.

Os serviços locais usam configuração de desenvolvimento, sem HTTPS. Restringir o host à máquina de desenvolvimento e não publicar portas no roteador. A etapa de dois tablets precisa de endpoint HTTPS acessível aos dispositivos e configuração própria; `127.0.0.1` de um tablet é o próprio tablet.

## Registro da preparação — 13/09/2026

- CLI 2.117.0 instalada, `supabase init` concluído, configuração ajustada e lida pela CLI.
- `supabase start` falhou explicitamente por ausência de Docker/Podman. Nenhum banco de aplicação foi criado.
- Instalação inicial do WSL sem elevação não iniciou. Instalação via UAC concluída com código 0; segunda execução para componentes também retornou 0.
- Consulta de hardware confirmou `VirtualizationFirmwareEnabled = True`; chave `Component Based Servicing/RebootPending` presente. Não atribuir o bloqueio à BIOS sem nova verificação depois de reiniciar.
- Rancher Desktop ainda precisa ser instalado/configurado. Não há daemon em execução nem validação de PostgreSQL/Auth/RLS.

## Fontes

- [Supabase CLI e runtimes locais](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [Rancher Desktop: instalação Windows e WSL](https://docs.rancherdesktop.io/getting-started/installation/)
- [Microsoft: instalação do WSL](https://learn.microsoft.com/en-us/windows/wsl/install)
