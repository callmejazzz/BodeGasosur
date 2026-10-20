/**
 * Espera la promesa hasta que la señal se aborte; entonces rechaza con su
 * motivo. No detiene el trabajo de fondo: sirve para dejar de esperar lo que
 * no acepta una señal propia.
 */
export function hastaElPlazo<T>(promesa: Promise<T>, señal: AbortSignal): Promise<T> {
  if (señal.aborted) {
    promesa.catch(() => {});
    return Promise.reject(señal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const abortar = () => reject(señal.reason);
    señal.addEventListener("abort", abortar, { once: true });
    promesa.then(
      (valor) => {
        señal.removeEventListener("abort", abortar);
        resolve(valor);
      },
      (error) => {
        señal.removeEventListener("abort", abortar);
        reject(error);
      },
    );
  });
}
