/**
 * Espera la promesa hasta que la señal se aborte; entonces rechaza con su
 * motivo. No detiene el trabajo de fondo: sirve para dejar de esperar lo que
 * no acepta una señal propia.
 */
export function hastaElPlazo<T>(promesa: Promise<T>, senial: AbortSignal): Promise<T> {
  if (senial.aborted) {
    promesa.catch(() => {});
    return Promise.reject(senial.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const abortar = () => reject(senial.reason);
    senial.addEventListener("abort", abortar, { once: true });
    promesa.then(
      (valor) => {
        senial.removeEventListener("abort", abortar);
        resolve(valor);
      },
      (error) => {
        senial.removeEventListener("abort", abortar);
        reject(error);
      },
    );
  });
}
