export function normalizarRfc(crudo: string | null | undefined): string | null {
  if (!crudo) return null;
  const rfc = crudo.toUpperCase().replace(/[\s-]/g, "");
  return rfc.length > 0 ? rfc : null;
}

/** Forma general del RFC del SAT: 3 o 4 letras, fecha AAMMDD y homoclave de 3. */
export const FORMA_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
