-- Fase 6: una partida consume cada capa una sola vez; impide registrar dos veces el mismo consumo.

-- CreateIndex
CREATE UNIQUE INDEX "ConsumoCapa_partidaId_capaId_key" ON "ConsumoCapa"("partidaId", "capaId");
