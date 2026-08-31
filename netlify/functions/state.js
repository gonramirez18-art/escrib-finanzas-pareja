// Netlify Function (v2) que lee/escribe el estado de la app en Neon.
// Corre en el servidor: la cadena de conexión a la base nunca llega al navegador.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

// Todos los datos de la pareja viven en una sola fila identificada por ROW_ID.
const ROW_ID = "familia";

export default async (req) => {
  if (req.method === "GET") {
    const rows = await sql`select data from app_state where id = ${ROW_ID}`;
    const data = rows[0]?.data ?? null;
    return new Response(JSON.stringify({ data }), {
      headers: { "content-type": "application/json" },
    });
  }

  if (req.method === "POST") {
    const body = await req.json();
    await sql`
      insert into app_state (id, data, updated_at)
      values (${ROW_ID}, ${JSON.stringify(body)}::jsonb, now())
      on conflict (id) do update set data = excluded.data, updated_at = now()
    `;
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
};

// Esto hace que la función responda en /api/state en vez de la ruta larga de Netlify
export const config = {
  path: "/api/state",
};
