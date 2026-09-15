# Reconhecimento: fluxo de teste e homologação pendente

FaceRecognitionService encapsula carregamento de modelos, detecção, qualidade, geração de embeddings, comparação e identificação. LivenessService é uma dependência separada: o APK de desenvolvimento usa um desafio ativo de movimento antes de criar uma marcação de teste, enquanto a liberação de produção exige PAD passivo homologado. Resultados tipados: identified, unknown, ambiguous, poor_quality, multiple_faces, spoof_suspected, model_unavailable. Identificar exige limiar e margem entre os dois melhores candidatos; valores serão calibrados com dados de teste autorizados.

## Bibliotecas e pesos

Candidato em teste: OpenCV Android 4.14.0 + YuNet para detecção/alinhamento e SFace para embeddings locais. O APK valida os pesos por SHA-256 antes de carregá-los. Os arquivos não entram no repositório; `npm run android:models` baixa as versões fixadas da origem oficial e rejeita qualquer conteúdo com hash diferente.

- YuNet `face_detection_yunet_2023mar.onnx`: `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` (MIT).
- SFace `face_recognition_sface_2021dec.onnx`: `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79` (avaliação local somente).

O YuNet tem licença publicada de forma clara. Embora o diretório SFace publique Apache-2.0, existe uma questão aberta sobre a procedência e os direitos dos dados de treinamento. O SFace não está homologado para distribuição comercial até essa questão ser resolvida e documentada.

- [OpenCV SFace: licença publicada](https://github.com/opencv/opencv_zoo/blob/main/models/face_recognition_sface/LICENSE)
- [OpenCV YuNet: licença publicada](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/LICENSE)
- [OpenCV Zoo: questão aberta sobre procedência do SFace](https://github.com/opencv/opencv_zoo/issues/313)
- [InsightFace: código MIT, pesos com restrições próprias](https://github.com/deepinsight/insightface#license). Não adotar os pesos padrão como solução comercial gratuita.

O modelo de anti-spoofing passivo ainda precisa ser selecionado e avaliado, incluindo direitos sobre pesos. Detectar face, piscar ou mover a cabeça isoladamente não comprova resistência a vídeo reproduzido. Sem modelo/protocolo aprovado, não liberar reconhecimento para produção. Falha em carregar o modelo deve bloquear captura facial, jamais aceitar por padrão.

Em 14/09/2026, o responsável pelo aparelho autorizou expressamente o teste com o próprio rosto. O ensaio no Galaxy SM-S911B confirmou câmera frontal, OpenCV e detecção de uma face. O aplicativo processa quadros em memória e não persiste fotos. No build de desenvolvimento, depois da identificação, o desafio aleatório de movimento precisa ser concluído para criar a marcação local; a interface informa que esse é um modo de teste sem PAD passivo homologado.

No mesmo ensaio, o SFace extraiu um embedding e o build de depuração o cadastrou para `Funcionário Android Teste`. O vetor foi cifrado com AES-256-GCM e chave não exportável do Android Keystore antes de ser persistido no Room. O controle de cadastro experimental não é compilado para uso em uma interface de produção e não substitui o fluxo delegado com autorização online.

Uma captura posterior identificou o funcionário com similaridade cosseno observada entre 0,416 e 0,831. O limiar experimental segue a referência SFace de 0,363, com margem mínima de 0,08 entre os dois melhores candidatos. Um desafio aleatório direita/esquerda, exigindo três leituras estáveis em cada etapa, foi concluído no aparelho. A sessão expira após cinco segundos sem leitura válida. Esse desafio valida o encadeamento da interface, mas não é prova de vida homologada: replay de vídeo ou movimentação de uma foto ainda precisam ser detectados por PAD dedicado.

Em 15/09/2026, depois de provisionar localmente a versão 1 do perfil para `Funcionário Android Teste`, uma nova captura real concluiu a presença ativa. O evento foi sincronizado e aceito pelo PostgreSQL local, com perfil versão 1 e relógio `verified`; a fila do terminal retornou a zero. O servidor recebeu somente os identificadores, hashes de modelo e a evidência de versão, nunca a imagem ou o embedding armazenado no Android Keystore/Room.

## Cadastro delegado

1. Gestor autorizado cria funcionário e sessão de cadastro para terminal específico, com expiração.
2. Terminal recebe sessão após autenticação e exibe instruções simples.
3. Captura várias amostras com face única, luz/pose adequadas e liveness aprovado; quantidade e métricas são versionadas.
4. Gera embeddings, verifica qualidade/consistência e colisão com outro funcionário. Sem gravar fotos por padrão.
5. Teste imediato usa captura nova, não uma das amostras de cadastro. Falha descarta o candidato e solicita repetição.
6. Publica perfil cifrado só após teste aprovado; sincroniza versão aos terminais autorizados. Perfil prévio continua ativo até substituição atômica.

Cadastro inicial depende de autorização online. Bater ponto offline funciona após catálogo e modelos estarem provisionados. Cadastrar rosto offline não é requisito do MVP.

## Ensaios em hardware

Medir latência p50/p95, aquecimento, memória e taxa de erro no modelo real de tablet. Avaliar pessoas autorizadas e impostores, variações de iluminação, óculos, pose e afastamento. Registrar FAR/FRR e erros do anti-spoofing, não só percentual de reconhecimento.

Ataques obrigatórios: foto impressa, foto em celular, vídeo gravado em celular, replay de desafio e múltiplas faces. Registrar condições, amostras, resultado esperado/observado, modelo/hash e parâmetros. O limiar de aceite deve ser definido antes do ensaio; não escolher limiar apenas para fazer as amostras passarem. Caso um candidato falhe, manter a fase aberta e avaliar outro modelo/hardware, sem simulação de sucesso.

Após uma confirmação, o terminal exige que a face saia completamente do enquadramento antes de armar outra marcação. Em 15/09/2026, uma pessoa permaneceu diante da câmera por cerca de dez segundos após a confirmação e o servidor local recebeu exatamente uma nova batida aceita; depois da saída do enquadramento, a interface voltou ao estado pronto. Esse rearme local não substitui ocorrência de proximidade entre dois tablets. Falha de liveness gera evento de segurança com funcionário apenas se houver identificação suficientemente confiável; caso contrário, identidade desconhecida.
