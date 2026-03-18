import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";

const TOKKO_API_BASE = "https://www.tokkobroker.com/api/v1";
const API_KEY = process.env.TOKKO_API_KEY || "";

// ─── Cliente HTTP para Tokko ───────────────────────────────────────────────
async function tokkoRequest<T>(
  resource: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  if (!API_KEY) throw new Error("TOKKO_API_KEY no configurada en el servidor");

  const qs = new URLSearchParams({ format: "json", key: API_KEY, lang: "es_ar" });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v));
  }

  const url = `${TOKKO_API_BASE}/${resource}/?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tokko API error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ─── Formateadores ─────────────────────────────────────────────────────────
function formatProperty(p: Record<string, unknown>): string {
  const ops = (p.operations as Array<Record<string, unknown>>) || [];
  const op = ops[0] || {};
  const prices = (op.prices as Array<Record<string, unknown>>) || [];
  const price = prices[0];
  const priceStr = price
    ? `${price.currency} ${Number(price.price).toLocaleString("es-MX")}`
    : "Consultar";

  const loc = (p.location as Record<string, unknown>)?.name || "";
  const rooms = p.suite_amount ? `${p.suite_amount} rec` : "";
  const baths = p.bathroom_amount ? `${p.bathroom_amount} baños` : "";
  const area = p.total_surface ? `${p.total_surface} m²` : "";
  const opType = (op.operation_type as string) || "";
  const status = p.status === 2 ? "Activa" : "Inactiva";

  return [
    `ID: ${p.id}`,
    `Dirección: ${p.address || p.fake_address || "Sin dirección"}`,
    `Operación: ${opType}  |  Precio: ${priceStr}`,
    loc && `Zona: ${loc}`,
    [rooms, baths, area].filter(Boolean).join("  |  "),
    `Estado: ${status}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Servidor MCP ──────────────────────────────────────────────────────────
const server = new McpServer({
  name: "tokko-mcp-server",
  version: "1.0.0",
});

// TOOL 1: Listar propiedades
server.registerTool(
  "tokko_listar_propiedades",
  {
    title: "Listar propiedades",
    description: `Lista las propiedades del CRM Tokko Broker con paginación y filtros opcionales.
Devuelve dirección, precio, tipo de operación, zona, habitaciones, baños, superficie y estado.

Args:
  - limit (number): Cuántas propiedades traer, máximo 50 (default: 20)
  - offset (number): Desde qué posición paginar (default: 0)
  - operation_type (string): "Venta" | "Alquiler" — filtra por tipo de operación
  - status (number): 2=activa, 3=pausada, 4=reservada (default: todas)

Returns: Lista de propiedades con resumen de cada una y total disponible.`,
    inputSchema: z.object({
      limit: z.number().int().min(1).max(50).default(20).describe("Propiedades a traer"),
      offset: z.number().int().min(0).default(0).describe("Offset para paginación"),
      operation_type: z.enum(["Venta", "Alquiler"]).optional().describe("Filtrar por tipo de operación"),
      status: z.number().int().optional().describe("2=activa, 3=pausada, 4=reservada"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ limit, offset, operation_type, status }) => {
    interface TokkoList { meta: { total_count: number }; objects: Array<Record<string, unknown>> }
    const data = await tokkoRequest<TokkoList>("property", { limit, offset });
    let props = data.objects || [];

    if (operation_type) {
      props = props.filter((p) => {
        const ops = (p.operations as Array<Record<string, unknown>>) || [];
        return ops.some((o) => o.operation_type === operation_type);
      });
    }
    if (status !== undefined) {
      props = props.filter((p) => p.status === status);
    }

    const total = data.meta?.total_count ?? props.length;
    const lines = props.map((p) => formatProperty(p)).join("\n\n---\n\n");
    const text = `Total: ${total} propiedades (mostrando ${props.length})\n\n${lines || "Sin resultados"}`;

    return { content: [{ type: "text", text }] };
  }
);

// TOOL 2: Detalle de propiedad
server.registerTool(
  "tokko_detalle_propiedad",
  {
    title: "Detalle de propiedad",
    description: `Obtiene la ficha completa de una propiedad por su ID de Tokko Broker.
Incluye descripción, fotos, servicios, superficies, precio, datos de contacto y portales donde está publicada.

Args:
  - id (number): ID numérico de la propiedad en Tokko (obtenido con tokko_listar_propiedades)

Returns: Ficha completa de la propiedad.`,
    inputSchema: z.object({
      id: z.number().int().positive().describe("ID de la propiedad en Tokko"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ id }) => {
    const qs = new URLSearchParams({ format: "json", key: API_KEY, lang: "es_ar" });
    const url = `${TOKKO_API_BASE}/property/${id}/?${qs.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Propiedad ${id} no encontrada (${res.status})`);
    const p = await res.json() as Record<string, unknown>;

    const ops = (p.operations as Array<Record<string, unknown>>) || [];
    const prices = ops.flatMap((o) => (o.prices as Array<Record<string, unknown>>) || []);
    const priceLines = prices.map((pr) => `  ${pr.currency} ${Number(pr.price).toLocaleString("es-MX")}`).join("\n");

    const photos = (p.photos as Array<Record<string, unknown>>) || [];
    const tags = (p.tags as Array<Record<string, unknown>>) || [];
    const portals = (p.publication_platforms as Array<Record<string, unknown>>) || [];

    const text = [
      `=== PROPIEDAD ID ${p.id} ===`,
      `Dirección: ${p.address || p.fake_address}`,
      `Tipo: ${(p.type as Record<string, unknown>)?.name || ""}`,
      `Estado: ${p.status === 2 ? "Activa" : p.status === 3 ? "Pausada" : "Reservada"}`,
      "",
      "PRECIOS:",
      priceLines || "  No especificado",
      "",
      `Superficie total: ${p.total_surface || "—"} m²`,
      `Superficie cubierta: ${p.roofed_surface || "—"} m²`,
      `Recámaras: ${p.suite_amount || "—"}`,
      `Baños: ${p.bathroom_amount || "—"}`,
      `Cocheras: ${p.parking_lot_amount || "—"}`,
      "",
      `Descripción: ${p.description || "Sin descripción"}`,
      "",
      `Fotos: ${photos.length}`,
      `Publicado en: ${portals.map((pp) => pp.portal_name).join(", ") || "Sin portales"}`,
      tags.length ? `Tags: ${tags.map((t) => t.name).join(", ")}` : "",
    ]
      .filter((l) => l !== undefined)
      .join("\n");

    return { content: [{ type: "text", text }] };
  }
);

// TOOL 3: Buscar propiedades
server.registerTool(
  "tokko_buscar_propiedades",
  {
    title: "Buscar propiedades",
    description: `Busca propiedades en Tokko Broker con filtros de precio, tipo y zona.
Útil para análisis de mercado, identificar oportunidades o revisar inventario por criterio.

Args:
  - precio_min (number): Precio mínimo en MXN
  - precio_max (number): Precio máximo en MXN
  - operation_type (string): "Venta" | "Alquiler"
  - limit (number): Cuántos resultados traer (default: 20, max: 50)

Returns: Propiedades que coinciden con los filtros aplicados.`,
    inputSchema: z.object({
      precio_min: z.number().optional().describe("Precio mínimo MXN"),
      precio_max: z.number().optional().describe("Precio máximo MXN"),
      operation_type: z.enum(["Venta", "Alquiler"]).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ precio_min, precio_max, operation_type, limit }) => {
    interface TokkoList { meta: { total_count: number }; objects: Array<Record<string, unknown>> }
    const data = await tokkoRequest<TokkoList>("property", { limit: 50 });
    let props = data.objects || [];

    props = props.filter((p) => {
      const ops = (p.operations as Array<Record<string, unknown>>) || [];
      return ops.some((o) => {
        if (operation_type && o.operation_type !== operation_type) return false;
        const prices = (o.prices as Array<Record<string, unknown>>) || [];
        return prices.some((pr) => {
          const price = Number(pr.price);
          if (precio_min && price < precio_min) return false;
          if (precio_max && price > precio_max) return false;
          return true;
        });
      });
    });

    props = props.slice(0, limit);
    const lines = props.map((p) => formatProperty(p)).join("\n\n---\n\n");
    const text = `Encontradas: ${props.length} propiedades\n\n${lines || "Sin resultados para esos filtros"}`;

    return { content: [{ type: "text", text }] };
  }
);

// TOOL 4: Resumen de inventario
server.registerTool(
  "tokko_resumen_inventario",
  {
    title: "Resumen de inventario",
    description: `Genera un resumen estadístico del inventario completo en Tokko Broker.
Muestra: total de propiedades, desglose por operación (venta/renta), precio promedio por tipo, propiedades activas vs inactivas.
Útil para tener una visión rápida del estado del portafolio.

Returns: Estadísticas del inventario.`,
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => {
    interface TokkoList { meta: { total_count: number }; objects: Array<Record<string, unknown>> }
    const data = await tokkoRequest<TokkoList>("property", { limit: 50 });
    const props = data.objects || [];
    const total = data.meta?.total_count ?? props.length;

    let ventas = 0, rentas = 0, activas = 0, inactivas = 0;
    const precios: number[] = [];

    for (const p of props) {
      if (p.status === 2) activas++; else inactivas++;
      const ops = (p.operations as Array<Record<string, unknown>>) || [];
      for (const o of ops) {
        if (o.operation_type === "Venta") ventas++;
        if (o.operation_type === "Alquiler") rentas++;
        const prices = (o.prices as Array<Record<string, unknown>>) || [];
        for (const pr of prices) {
          const price = Number(pr.price);
          if (price > 0) precios.push(price);
        }
      }
    }

    const promedio = precios.length
      ? Math.round(precios.reduce((a, b) => a + b, 0) / precios.length)
      : 0;

    const text = [
      "=== RESUMEN DE INVENTARIO TOKKO ===",
      `Total propiedades: ${total}`,
      `  Activas: ${activas}`,
      `  Inactivas: ${inactivas}`,
      "",
      `Operaciones:`,
      `  En venta: ${ventas}`,
      `  En renta: ${rentas}`,
      "",
      `Precio promedio: MXN ${promedio.toLocaleString("es-MX")}`,
      `(basado en ${props.length} propiedades cargadas)`,
    ].join("\n");

    return { content: [{ type: "text", text }] };
  }
);

// ─── Express + HTTP Transport ──────────────────────────────────────────────
async function main() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "tokko-mcp-server" });
  });

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT || "3000");
  app.listen(port, () => {
    console.error(`Tokko MCP server corriendo en http://localhost:${port}/mcp`);
  });
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
