-- La plantilla bodegasosur-db emite tokens de 30 s; getToken tardó como mucho
-- 364 ms al medirlo. La base acepta hasta 60 s: una plantilla configurada más
-- larga por error falla cerrada en lugar de alargar la vida de un token que
-- quedó sin consumir tras un rollback.
ALTER TABLE seguridad.llave_publica ALTER COLUMN vida_maxima SET DEFAULT 60;
UPDATE seguridad.llave_publica SET vida_maxima = 60 WHERE vida_maxima > 60;
