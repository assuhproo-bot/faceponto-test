# Handoff — FacePonto

Atualizado em 15/09/2026. Este arquivo não contém senhas, tokens ou chaves.

## Objetivo e limites

FacePonto é um piloto interno de ponto facial. O usuário não quer custos neste momento. A implementação de PAD é experimental e exclusiva do APK `debug`; ela não é homologação trabalhista, governamental ou comercial. O celular pessoal do usuário não pode ser apagado, restaurado, ter dados limpos ou ter o app original removido.

## Workspace e código

- Workspace: `C:\Users\wadso\Downloads\ponto`
- Git: `main`, remoto público `https://github.com/assuhproo-bot/faceponto-test`
- Último commit: `1272daa` (`Align test facial profiles with PAD policy v2`)
- Há uma pasta `tmp/` local não rastreada. Não adicioná-la ao Git.
- Antes de publicar alterações, executar validações adequadas e nunca mostrar credenciais em terminal ou chat.

## Serviços publicados

- Painel: `https://faceponto-hdignlvf-admin.onrender.com`
- API: `https://faceponto-hdignlvf-api.onrender.com`
- Supabase: projeto `faceponto-test`, ref `hdignlvfkxeekjtswpfl`, São Paulo.
- Render: API `srv-dakbshek1f9s73cohn9g`; painel estático `srv-dakbsmbm8hqs73e1t3eg`.
- A API responde em `/health`; CORS aceita o painel publicado.
- Render está no plano gratuito: pode adormecer após inatividade. É adequado ao piloto, não a operação contínua em escala.

## Banco remoto

- Todas as migrações locais foram aplicadas, inclusive `20260915104252_facial_profile_pad_policy_v2.sql`.
- Última verificação de advisors do Supabase: sem avisos.
- A primeira empresa, local, funcionário e terminal de piloto já existem no ambiente remoto.
- O perfil facial ativo do funcionário piloto está na versão 2 e usa a política PAD versão 2.
- Não existe escala, atribuição de escala nem programação diária remota ainda. Por isso as marcações do piloto aparecem como `unclassified` até a escala ser criada e atribuída.
- A confirmação ponta a ponta ocorreu: há marcação facial aceita, com relógio verificado, no terminal remoto.

## Celular de teste

- Dispositivo conectado por ADB: Samsung `SM-S911B`, id `RQ8T20773WY`.
- App original/local: `br.com.faceponto.terminal`. Não desinstalar, limpar dados, restaurar ou alterar.
- App online separado: `br.com.faceponto.terminal.hostedtest`. Ele aponta para a API Render e foi instalado com `adb install -r`, preservando dados da cópia online.
- A cópia online já foi pareada, tem catálogo de um funcionário, relógio validado e uma amostra facial cifrada apenas no aparelho.
- Para abrir a cópia online:
  `adb shell am start -n br.com.faceponto.terminal.hostedtest/br.com.faceponto.terminal.MainActivity`

## Reconhecimento e PAD

- Reconhecimento facial é local no Android; a amostra é cifrada e não é enviada ao servidor.
- O servidor guarda somente metadados versionados do perfil.
- APK debug usa MiniFASNet V1SE + V2 e desafio ativo; é experimental.
- Descriptor/PAD esperado no servidor: hash `1f1ff7268858f92ff9777f6860cdd38a13a0cc2552f9514c427f7c9deb7200f2`, política 2.
- O perfil de versão 1 causava o bloqueio “Catálogo precisa atualizar a política de presença”; isso foi corrigido por migração e novo provisionamento de perfil.
- A interface do app agora preserva a confirmação após ponto aceito e informa quando o desafio é interrompido ao afastar o rosto antes do fim.

## Última validação

A marcação mais recente no banco remoto foi aceita (`sync_status=accepted`), com `clock_status=verified` e `source=face`. O status `unclassified` é esperado enquanto não houver escala.

## Próximas tarefas, na ordem recomendada

1. Criar as escalas reais no painel e atribuir a escala do funcionário piloto. Jornadas já informadas pelo usuário:
   - 08:00–12:00 e 14:00–18:00;
   - 14:00–22:00;
   - 04:00–08:00.
2. Fazer novas marcações e validar classificação de entrada, intervalo, retorno e saída, jornada, ocorrências, banco de horas e exportações XLSX/PDF.
3. Criar programação diária para dias que fogem da escala fixa, em vez de alterar o funcionário frequentemente.
4. Testar rejeições: pessoa não cadastrada, foto/replay básico, desafio de movimento incompleto e má iluminação.
5. Testar modo offline: registrar sem rede, restabelecer a rede e confirmar sincronização idempotente.
6. Cadastrar mais funcionários, locais e terminais conforme o piloto crescer; provisionar o perfil no painel e cadastrar a amostra local em cada terminal necessário.
7. Avaliar estabilidade/tempo de resposta do Render gratuito antes de ampliar testes. Para uso contínuo em escala será necessária infraestrutura sem suspensão e uma revisão de segurança, retenção, LGPD e conformidade trabalhista.

## Comandos seguros úteis

```powershell
node scripts/supabase.mjs migration list --linked
node scripts/supabase.mjs db advisors --linked --type all --level warn --output-format json
npm.cmd run typecheck
npm.cmd run api:test
npm.cmd run admin:build
```

Para APK online de teste, sempre usar identificador separado:

```powershell
Set-Location apps\android
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat :app:assembleDebug '-PfacepontoApiUrl=https://faceponto-hdignlvf-api.onrender.com' '-PfacepontoApplicationIdSuffix=.hostedtest'
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

Nunca usar `adb uninstall`, `adb shell pm clear`, restauração de fábrica ou comandos de remoção no celular pessoal.

## Atualização de UX — 16/09/2026

- A cópia online de teste no celular foi atualizada com uma tela de funcionário mais simples: título, câmera e uma única orientação por vez. Ela não mostra ID de terminal, fila, catálogo, relógio, pontuação ou detalhes do PAD.
- Após uma marcação aceita, o terminal mostra saudação baseada no horário local: Bom dia, Boa tarde ou Boa noite, seguida do primeiro nome reconhecido e da confirmação de ponto registrado.
- O botão de cadastro de amostra aparece somente enquanto este terminal ainda não possui uma amostra facial local; ele fica em uma seção de configuração inicial destinada ao responsável.
- O painel publicado ganhou o bloco “Comece por aqui”, que explica local, funcionário, terminal, pareamento e escala.
- O painel permite copiar um link público de solicitação de cadastro. O funcionário preenche nome, matrícula opcional, contato e observação sem criar login. A solicitação aparece na fila do painel; o responsável analisa e então realiza o cadastro definitivo do funcionário.
- Migração adicional aplicada: `20260916024605_employee_registration_requests.sql`.
- Commit publicado: `52e4fce` (`Simplify terminal experience and add registration requests`).
- O link público da empresa de piloto é: `https://faceponto-hdignlvf-admin.onrender.com/?cadastro=15974f56-ca8c-48b7-b16a-608757bb3e29`.

## Observação de validação

- `npm.cmd run api:test` não foi executado nesta atualização porque o Docker Desktop não estava iniciado. Typecheck, build do painel e testes unitários Android passaram. A API e o painel publicados responderam normalmente; o endpoint público da empresa também foi verificado.
