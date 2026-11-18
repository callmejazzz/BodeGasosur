import { atenderTarea } from "@/lib/correo/tarea";

export const dynamic = "force-dynamic";

export function POST(peticion: Request) {
  return atenderTarea(peticion);
}
