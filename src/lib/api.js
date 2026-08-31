// Helper para hablar con la función de Netlify que lee/escribe en Neon.
const BASE = "/api/state";

export async function loadState() {
  const res = await fetch(BASE);
  if (!res.ok) throw new Error("No se pudo cargar el estado");
  const { data } = await res.json();
  return data; // null la primera vez, o { people, txs, categories }
}

export async function saveState(state) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error("No se pudo guardar el estado");
}
