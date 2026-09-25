/** Un FormData que anota cada método que se le llama: sin sesión no debe abrirse. */
export function formDataEspia(original: FormData): { formData: FormData; lecturas: string[] } {
  const lecturas: string[] = [];
  const formData = new Proxy(original, {
    get(objetivo, propiedad) {
      const valor: unknown = Reflect.get(objetivo, propiedad, objetivo);
      if (typeof valor !== "function") return valor;
      return (...args: unknown[]) => {
        lecturas.push(String(propiedad));
        return valor.apply(objetivo, args);
      };
    },
  });
  return { formData, lecturas };
}
