# Preparar uma versão futura

Este fluxo será usado quando os aplicativos forem produzidos. Não compila apps
e não publica nada automaticamente.

1. Produzir e assinar os instaladores fora deste repositório.
2. Colocá-los em staging/ (pasta ignorada pelo Git).
3. Gerar hashes e o manifesto, por exemplo:

   node scripts/prepare-release.mjs 2.0.0 android staging/Falae-2.0.0.apk

   É possível passar outros pares de plataforma e arquivo na mesma chamada.
4. Revisar assinaturas, permissões, notas e dados mínimos de sistema.
5. Criar uma release em rascunho no repositório público falaegrup/falae-downloads
   e anexar instaladores, staging/release.json e staging/SHA256SUMS.
6. Conferir os anexos e publicar o rascunho quando solicitado.

O manifesto usa links dos anexos de Releases, calculados para a tag v<versão>.
Eles só passam a existir depois do upload e da publicação. Não conectar um
botão do site a esses links antes de confirmar os arquivos reais.

Nunca anexar o ZIP de fontes e assinatura, certificados privados ou senhas.
O APK anterior usa o certificado original; atualizações devem preservá-lo.
O futuro cliente iOS precisará do canal de distribuição adequado da Apple.

