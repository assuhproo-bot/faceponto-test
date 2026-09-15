# Terminal Android — fase 04

Aplicativo Android nativo em Kotlin, Jetpack Compose e CameraX. A versão atual contém tela de espera, câmera frontal, detecção local com OpenCV/YuNet, embeddings SFace cifrados e identificação experimental. A marcação real permanece bloqueada enquanto não houver PAD homologado.

Versões travadas: AGP 9.4.0, Gradle 9.6.0, Kotlin/Compose Compiler 2.3.21, Compose BOM 2026.08.00, CameraX 1.6.2, Room 2.8.5, WorkManager 2.11.2 e DataStore 1.2.1. `compileSdk`/`targetSdk` 37 e `minSdk` 26.

`punch_events` e `sync_outbox` são gravados pela mesma transação Room. O evento conserva UUID, relógio civil/monotônico, boot, âncora e evidências versionadas. O schema é exportado em `app/schemas`. Reconhecimento local e desafio ativo estão implementados para teste; após a confirmação de presença, a marcação entra na fila local. O PAD passivo padrão continua indisponível.

Antes do build, execute `npm run android:models` na raiz. O comando baixa os pesos oficiais fixados e verifica os hashes. O APK repete essa verificação em tempo de execução. A análise ocorre em memória e nenhuma foto da câmera é salva.

O build `debug` oferece um cadastro local de amostra para o primeiro funcionário do catálogo. O embedding SFace é cifrado com AES-256-GCM por uma chave do Android Keystore antes de entrar no Room. Esse controle é estritamente experimental; o fluxo de produção exigirá sessão de cadastro emitida por gestor.

A identificação local compara similaridade cosseno, exige limiar e margem entre candidatos. O desafio de movimento aleatório usa a relação entre nariz e olhos para exigir rosto frontal, virada para os dois lados e expira rapidamente. Depois de identificar e concluir esse desafio, a versão de teste grava o evento localmente e agenda a sincronização. Esse fluxo serve para validar a operação ponta a ponta; não equivale a PAD homologado contra foto, tela ou replay.

O fluxo inicial solicita o código único emitido por um administrador. Tokens e identidade recebidos da API são cifrados com AES-GCM por uma chave não exportável do Android Keystore. Somente o manifest `debug` permite HTTP local para testes por `adb reverse`; builds normais continuam sem permissão para tráfego HTTP em texto claro.

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat :app:assembleDebug
```

O APK de desenvolvimento fica em `app/build/outputs/apk/debug/app-debug.apk`. Ele é gerado para `arm64-v8a`, arquitetura do telefone de teste, para não incluir bibliotecas de emulador e 32 bits. Instalar somente em dispositivo de teste autorizado. O modo kiosk não é ativado automaticamente, sobretudo em aparelho pessoal.

O WorkManager executa heartbeat e catálogo com restrição de rede, renova a sessão expirada e atualiza o cache Room. A fila envia lotes de até 100 eventos pelo contrato v1; recibos aceitos, quarentena, rejeição e retry produzem estados locais distintos. O trabalho imediato usa política de substituição e o periódico roda a cada 15 minutos.

Cada inicialização física recebe um UUID ligado ao `BOOT_COUNT`. Após medir o tempo de ida e volta, o terminal solicita uma âncora autenticada, guarda horário do servidor, `elapsedRealtime`, incerteza e expiração no Room e só considera verificadas as capturas do mesmo boot. A primeira âncora foi confirmada no aparelho e no PostgreSQL local.

A interface também verifica a expiração da âncora pelo tempo monotônico; uma âncora antiga do mesmo boot não permanece marcada como válida indefinidamente. Em teste no aparelho, a API foi interrompida sem desligar a rede: o app reiniciou com catálogo, perfil e fila preservados, o worker retornou retry e, após restaurar a API, concluiu com `SUCCESS`. Uma sonda sem biometria pessoal confirmou fila 1 persistente após kill/restart, drenagem para 0 e retry idempotente quando a resposta foi derrubada depois do commit. Um reinício físico invalidou corretamente a âncora do boot anterior e preservou os demais dados; após reconectar, o app obteve nova âncora. O ensaio em modo avião, também com kill/restart, preservou o estado e retornou `RETRY`; ao restaurar a conectividade, o worker terminou com `SUCCESS`.

Próximos módulos: cadastro facial delegado e PAD passivo avaliado. O modelo MiniFASNet da Minivision ainda não foi adicionado: os pesos oficiais publicados são PyTorch e o exemplo Android usa NCNN com bibliotecas nativas próprias. Nenhuma chave secreta pode integrar o APK.
