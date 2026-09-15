# Avaliação de detecção de ataques de apresentação (PAD)

O FacePonto exige PAD passivo e desafio ativo antes de criar uma marcação facial aceita. O contrato Android `PresentationAttackDetectionProvider` retorna `Passed`, `Failed` ou `Unavailable` e inclui provedor, versão, SHA-256, versão da política, pontuação e sessão. Em build de produção, o seletor usa `UnavailablePadProvider`; ausência, erro ou hash inesperado bloqueiam a marcação. O build de depuração seleciona `ActiveChallengeTestPadProvider` somente para ensaiar o fluxo, e nunca deve ser tratado como PAD passivo.

## Portão de homologação

Uma implementação candidata precisa apresentar:

- direito comercial documentado para código, pesos e dados de treinamento;
- artefato versionado e verificado por SHA-256;
- execução Android compatível com os aparelhos-alvo e funcionamento offline quando esse requisito for mantido;
- relatório independente de PAD alinhado a ISO/IEC 30107-3 ou evidência equivalente aceita pelo responsável do produto;
- limiar definido antes dos ensaios, sem ajuste para favorecer as amostras locais;
- testes no hardware real contra rosto vivo, foto impressa, foto em tela, vídeo/replay, múltiplas faces e condições de luz;
- medição de APCER/BPCER, latência p50/p95, memória e aquecimento;
- revisão de privacidade e retenção compatível com LGPD, sem foto bruta por padrão.

## Candidatos avaliados

### Silent-Face-Anti-Spoofing / MiniFASNet

O repositório da Minivision publica código, pesos e um exemplo Android sob Apache-2.0, e declara classificação RGB de rosto real contra papel, telas e máscaras. A própria documentação alerta que a robustez varia com câmera e ambiente.

Decisão atual: não integrar ao APK distribuível. O conjunto de treinamento e sua procedência não estão documentados, perguntas sobre os dados permanecem abertas, o projeto principal está sem atividade relevante há anos e a opção ONNX encontrada é uma conversão comunitária sem homologação do autor. Uma avaliação isolada em laboratório não resolveria esses impedimentos.

- [Repositório e descrição oficial](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing)
- [Exemplo Android oficial](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing-APK)
- [Questão aberta sobre o conjunto de treinamento](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/issues/125)
- [Questão sobre manutenção](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/issues/135)

### Desafio de movimento FacePonto

O protótipo local sorteia a primeira direção, exige centro e lados opostos por leituras consecutivas e expira rapidamente. Ele valida continuidade temporal e interface, mas uma apresentação gravada ou uma foto movimentada ainda pode passar. Ele nunca deve ser selecionado como provedor de produção nem apresentado como PAD passivo.

Em 15/09/2026, o aplicativo passou a enviar essa evidência pelo contrato `PresentationAttackDetectionProvider` antes de persistir uma batida. O provedor de teste exige ao menos três quadros com ordem temporal válida e o desafio concluído; o seletor de produção retorna indisponível. Os testes unitários cobrem ambas as seleções e a recusa de evidência incompleta ou fora de ordem. Isso fecha o portão técnico, não a homologação contra ataques.

## Decisão pendente de produto

Em 14/09/2026, o responsável definiu custo zero como requisito: não usar SDK comercial nem API facial paga. O próximo candidato precisa executar localmente e ter código, pesos, dados de treinamento e direitos de uso auditáveis. Enquanto nenhum candidato cumprir esse portão, o PAD passivo continua indisponível. A versão de teste, porém, pode registrar a batida após reconhecimento local e desafio ativo para validar o fluxo completo; ela não pode ser apresentada como proteção PAD homologada.

### Triagem adicional de opções gratuitas

- `face-antispoof-onnx` publica pesos pequenos e métricas próprias, mas declara avaliação no CelebA-Spoof. Os termos oficiais do conjunto limitam seu uso a pesquisa não comercial e também restringem dados derivados; por isso, esses pesos não entram no aplicativo distribuível.
- `TrainYourFace` publica código MIT e execução offline, mas também usa CelebA-Spoof, ainda não apresenta avaliação externa e lista coleta multissessão e avaliação entre conjuntos como trabalho futuro. Não atende ao portão.
- `OpenPAD` oferece integração Android offline, porém combina pesos herdados do MiniFASNet, modelos treinados pelo próprio projeto sem procedência pública suficiente e um componente AGPL. As alegações e métricas são do autor, sem relatório independente localizado. Não integrar.
- CASIA-SURF CeFA exige acordo e orienta contato separado para licença comercial. Não serve como base gratuita automaticamente liberada para o produto.

Fontes consultadas: [termos oficiais do CelebA-Spoof](https://mmlab.ie.cuhk.edu.hk/projects/CelebA/CelebA_Spoof.html), [repositório face-antispoof-onnx](https://github.com/facenox/face-antispoof-onnx), [repositório TrainYourFace](https://github.com/kcitlyn/TrainYourFace), [repositório OpenPAD](https://github.com/iamjosephmj/OpenPAD) e [licenciamento CASIA-SURF CeFA](https://sites.google.com/view/face-anti-spoofing-challenge/dataset-download/casia-surf-cefacvpr2020).
