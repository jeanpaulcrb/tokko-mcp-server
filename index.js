import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";

const API_KEY = process.env.TOKKO_API_KEY || "";
if (!API_KEY) { console.error("ERROR: TOKKO_API_KEY requerida"); process.exit(1); }

const TOKKO_BASE = "http://www.tokkobroker.com/api/v1";

async function tokkoGet(resource, params = {}) {
  const url = new URL(`${TOKKO_BASE}/${resource}/`);
  url.searchParams.set("format", "json");
  url.searchParams.set("key", API_KEY);
  url.searchParams.set("lang", "es_ar");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Tokko API error ${res.status}`);
  return res.json();
}

function formatPrice(prop) {
  const price = prop.operations?.[0]?.prices?.[0];
  if (!price) return "Sin precio";
  return `${price.currency} ${Number(price.price).toLocaleString("es-MX")}`;
}

function propLine(p) {
  const precio = formatPrice(p);
  const op = p.operations?.[0]?.operation_type ?? "—";
  const sup = p.total_surface ? `${p.total_surface}m²` : "";
  const rec = p.suite_amount ? `${p.suite_amount}rec` : "";
  const dir = p.address || p.fake_address || "Sin dirección";
  return `[${p.id}] ${dir} | ${op} ${precio} | ${[sup, rec].filter(Boolean).join(" ")} | ${p.status === 2 ? "Activa" : "Inactiva"}`;
}

function propDetalle(p) {
  return [
    `ID: ${p.id}`,
    `Dirección: ${p.address || p.fake_address || "—"}`,
    `Precio: ${formatPrice(p)}`,
    `Tipo: ${p.property_type?.name ?? "—"}`,
    `Operación: ${p.operations?.[0]?.operation_type ?? "—"}`,
    `Superficie total: ${p.total_surface ? `${p.total_surface} m²` : "—"}`,
    `Superficie cubierta: ${p.roofed_surface ? `${p.roofed_surface} m²` : "—"}`,
    `Recámaras: ${p.suite_amount ?? "—"}`,
    `Baños: ${p.bathroom_amount ?? "—"}`,
    `Estacionamientos: ${p.parking_lot_amount ?? "—"}`,
    `Ubicación: ${p.location?.full_location ?? p.location?.name ?? "—"}`,
    `Estado: ${p.status === 2 ? "Activa" : "Inactiva"}`,
    p.description_only || p.description
      ? `Descripción: ${(p.description_only || p.description || "").slice(0, 400)}`
      : null,
    p.photos?.length ? `Fotos: ${p.photos.length}` : null,
  ].filter(Boolean).join("\n");
}

const server = new McpServer({ name: "tokko-mcp-server", version: "1.0.0" });

// ─── listar propiedades ────────────────────────────────────────────────────
server.registerTool("tokko_listar_propiedades", {
  title: "Listar propiedades",
  description: "Lista el inventario de Tokko Broker con paginación. Devuelve dirección, precio, superficie, recámaras y estado.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(50).default(20),
    offset: z.number().int().min(0).default(0),
    operacion: z.enum(["Venta", "Alquiler"]).optional(),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false },
}, async ({ limit, offset, operacion }) => {
  const params = { limit, offset };
  if (operacion) params.operation = operacion;
  const data = await tokkoGet("property", params);
  const props = data.objects || [];
  if (!props.length) return { content: [{ type: "text", text: "Sin propiedades." }] };
  const total = data.meta?.total_count ?? props.length;
  const lines = props.map(propLine);
  return { content: [{ type: "text", text: `Total: ${total} | Mostrando ${offset + 1}–${offset + props.length}\n\n${lines.join("\n")}` }] };
});

// ─── detalle propiedad ─────────────────────────────────────────────────────
server.registerTool("tokko_detalle_propiedad", {
  title: "Detalle de propiedad",
  description: "Ficha completa de una propiedad por su ID: dirección, precio, superficie, recámaras, baños, descripción, fotos.",
  inputSchema: z.object({
    id: z.number().int().positive(),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false },
}, async ({ id }) => {
  const prop = await tokkoGet(`property/${id}`);
  return { content: [{ type: "text", text: propDetalle(prop) }] };
});

// ─── buscar propiedades ────────────────────────────────────────────────────
server.registerTool("tokko_buscar_propiedades", {
  title: "Buscar propiedades",
  description: "Busca propiedades con filtros: precio_max, precio_min, tipo (Casa/Departamento/Terreno/Local), recamaras_min, operacion (Venta/Alquiler).",
  inputSchema: z.object({
    precio_max: z.number().optional(),
    precio_min: z.number().optional(),
    tipo: z.enum(["Casa", "Departamento", "Terreno", "Local", "Bodega"]).optional(),
    recamaras_min: z.number().int().min(1).max(10).optional(),
    operacion: z.enum(["Venta", "Alquiler"]).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false },
}, async ({ precio_max, precio_min, tipo, recamaras_min, operacion, limit }) => {
  const params = { limit: 100 };
  if (operacion) params.operation = operacion;
  const data = await tokkoGet("property", params);
  let props = data.objects || [];

  if (precio_max !== undefined) props = props.filter(p => (p.operations?.[0]?.prices?.[0]?.price ?? Infinity) <= precio_max);
  if (precio_min !== undefined) props = props.filter(p => (p.operations?.[0]?.prices?.[0]?.price ?? 0) >= precio_min);
  if (tipo) props = props.filter(p => p.property_type?.name?.toLowerCase().includes(tipo.toLowerCase()));
  if (recamaras_min !== undefined) props = props.filter(p => (p.suite_amount ?? 0) >= recamaras_min);
  props = props.slice(0, limit);

  if (!props.length) return { content: [{ type: "text", text: "Sin resultados para los filtros aplicados." }] };
  return { content: [{ type: "text", text: `${props.length} resultado(s):\n\n${props.map(propLine).join("\n")}` }] };
});

// ─── resumen de mercado ────────────────────────────────────────────────────
server.registerTool("tokko_resumen_mercado", {
  title: "Resumen de mercado",
  description: "Estadísticas del inventario: precio promedio, mínimo y máximo por tipo de operación (Venta/Alquiler). Total activas vs inactivas.",
  inputSchema: z.object({}),
  annotations: { readOnlyHint: true, destructiveHint: false },
}, async () => {
  const data = await tokkoGet("property", { limit: 100 });
  const props = data.objects || [];
  const total = data.meta?.total_count ?? props.length;
  const activas = props.filter(p => p.status === 2).length;

  const stats = (list, label) => {
    const prices = list.map(p => p.operations?.[0]?.prices?.[0]?.price).filter(v => typeof v === "number" && v > 0);
    if (!prices.length) return `${label}: sin datos`;
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    return `${label} (${list.length} props)\n  Promedio: $${Math.round(avg).toLocaleString("es-MX")}\n  Mínimo:   $${Math.min(...prices).toLocaleString("es-MX")}\n  Máximo:   $${Math.max(...prices).toLocaleString("es-MX")}`;
  };

  const ventas = props.filter(p => p.operations?.[0]?.operation_type === "Venta");
  const rentas = props.filter(p => p.operations?.[0]?.operation_type === "Alquiler");

  const text = [
    `=== RESUMEN TOKKO BROKER ===`,
    `Total CRM: ${total} | Activas (muestra): ${activas} | Analizadas: ${props.length}`,
    ``,
    stats(ventas, "VENTA"),
    ``,
    stats(rentas, "RENTA"),
  ].join("\n");

  return { content: [{ type: "text", text }] };
});

// ─── servidor HTTP ─────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok", server: "tokko-mcp-server" }));

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const PORT = parseInt(process.env.PORT || "3000");
app.listen(PORT, () => console.log(`Tokko MCP server en puerto ${PORT}`));
