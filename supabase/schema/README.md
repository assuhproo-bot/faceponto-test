# Schema de trabalho

`phase02.sql` contém a implementação em revisão da fundação do banco. Não é um seed e não deve ser aplicado em projeto remoto. Requer Supabase/PostgreSQL 17 com Auth e roles nativas. O arquivo inteiro é transacional: um erro reverte sua aplicação.

Inclui empresas, perfis mínimos, membership, escopo de locais, departamentos, funcionários, autorizações de local, terminais e histórico de associação, escalas/versionamento/segmentos/vigências e auditoria. CPF fica em tabela privada, separado da consulta comum. Marcações, biometria e ingestão serão implementadas nas fases correspondentes.

Procedimento após subir o runtime local:

1. `npx.cmd --no-install supabase db query --local --file supabase/schema/phase02.sql`
2. `npm.cmd run db:test`
3. `npx.cmd --no-install supabase db advisors --local --type security --fail-on warn`
4. Gerar migration pela CLI e verificar reconstrução em base local descartável.

Ainda não executado: não tratar os testes escritos como testes aprovados. As fixtures pgTAP são sintéticas e rodam dentro de uma transação revertida ao final.
