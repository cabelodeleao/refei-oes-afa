// Wrapper de fetch para componentes de cliente.
// Se a sessão expirou (401), o cookie JWT não é mais válido — redireciona
// para a tela de login em vez de deixar a página em estado quebrado.
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/";
  }
  return res;
}
