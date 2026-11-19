import { ButtonLink } from "@/components/ui/button";
import { Card, EstadoVacio } from "@/components/ui/superficies";

// Un registro que no existe, dentro del sistema: la barra lateral sigue a la mano
export default function NoEncontradoEnElSistema() {
  return (
    <Card>
      <EstadoVacio
        titulo="No encontramos lo que buscas"
        descripcion="El registro no existe o la dirección está mal escrita."
        accion={<ButtonLink href="/" variante="secundario">Ir al tablero</ButtonLink>}
      />
    </Card>
  );
}
