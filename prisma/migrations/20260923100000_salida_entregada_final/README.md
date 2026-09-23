# Migración histórica sustituida

Esta migración aplicó una decisión transitoria que **ya no es el contrato de la
fase 6**. La migración posterior
[`20260923130000_retiro_recepcion`](../20260923130000_retiro_recepcion/migration.sql)
renombra `ENTREGADA` a `RETIRADA`, elimina la restricción que impedía `RECIBIDA`
y restablece `RECIBIDA` como estado final.

Se conserva `migration.sql` sin cambios porque ya fue aplicada y Prisma verifica
su checksum. Para construir una base nueva desde el esquema vigente, los SQL
canónicos están en [`prisma/sql/despues/`](../../sql/despues/); allí no se incluye
esta restricción transitoria.
