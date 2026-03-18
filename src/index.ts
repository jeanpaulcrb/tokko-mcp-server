import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import {
  tokkoGet,
  formatPropText,
  TokkoListResponse,
  TokkoProperty,
} from "./tokko.js";

const API_KEY = process.env.TOKKO_API_KEY || "";
if (!API_KEY) {
  console.error("ERROR: TOKKO_API_KEY env var is required");
  process.exit(1);
}

const server = new McpServer({
  name: "tokko-mcp-server",
  version: "1.0.0",
});

// ─── TOOL: listar propiedades ──────────────────────────────────────────────
server.registerTool(
  "tokko_listar_propiedades",
  {
    title: "Listar propiedades",
    description: `Lista las propiedades de la inmobiliaria en Tokko Broker.
Soporta paginación y filtros básicos.

Args:
  - limit: cantidad de resultados (default 20, max 50)
  - offset: desplazamiento para paginación (default 0)
  - operacion: 'Venta' | 'Alquiler' (opcional)

Returns:
  Lista de propiedades con precio, dirección, superficie, recámaras y estado.`,
    inputSchema: z.object({
      limit: z.number().int().min(1).max(50).default(20).describe("Cantidad de resultados"),
      offset: z.number().int().min(0).default(0).describe("Desplazamiento para paginación"),
      operacion: z.enum(["Venta", "Alquiler"]).optional().describe("Filtrar por tipo de operación"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ limit, offset, operacion }) => {
    const params: Record<string, string | number> = { limit, offset };
    if (operacion) params["operation"] = operacion;

    const data = await tokkoGet<TokkoListResponse>("property", API_KEY, params);
    const props = data.objects;

    if (!props.length) {
      return { content: [{ type: "text", text: "No se encontraron propiedades." }] };
    }

    const total = data.meta.total_count;
    const lines = props.map((p) => {
      const precio = p.operations?.[0]?.prices?.[0];
      const precioStr = precio ? `${precio.currency} ${Number(precio.price).toLocaleString("es-MX")}` : "Sin precio";
      const op = p.operations?.[0]?.operation_type ?? "—";
      const sup = p.total_surface ? `${p.total_surface}m²` : "";
      const rec = p.suite_amount ? `${p.suite_amount}rec` : "";
      return `[${p.id}] ${p.address || p.fake_address || "Sin dir"} | ${op} ${precioStr} | ${[sup, rec].filter(Boolean).join(" ")} | ${p.status === 2 ? "Activa" : "Inactiva"}`;
    });

    const text = `Total: ${total} propiedades (mostrando ${offset + 1}–${offset + props.length})\n\n${lines.join("\n")}`;
    return { content: [{ type: "text", text }] };
  }
);

// ─── TOOL: detalle de propiedad ────────────────────────────────────────────
server.registerTool(
  "tokko_detalle_propiedad",
  {
    title: "Detalle de propiedad",
    description: `Obtiene el detalle completo de una propiedad por su ID.

Args:
  - id: ID numérico de la propiedad en Tokko

Returns:
  Ficha completa: dirección, precio, superficie, recámaras, baños, descripción, fotos, ubicación.`,
    inputSchema: z.object({
      id: z.number().int().positive().describe("ID de la propiedad en Tokko Broker"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ id }) => {
    const prop = await tokkoGet<TokkoProperty>(`property/${id}`, API_KEY);
    const text = formatPropText(prop);
    const fotos = prop.photos?.length ? `\nFotos: ${prop.photos.length} disponibles` : "";
    return { content: [{ type: "text", text: text + fotos }] };
  }
);

// ─── TOOL: buscar propiedades ──────────────────────────────────────────────
server.registerTool(
  "tokko_buscar_propiedades",
  {
    title: "Buscar propiedades",
    description: `Busca propiedades con filtros avanzados: precio, tipo, zona, recámaras.

Args:
  - precio_max: precio máximo en MXN (opcional)
  - precio_min: precio mínimo en MXN (opcional)
  - tipo: tipo de propiedad: 'Casa' | 'Departamento' | 'Terreno' | 'Local' (opcional)
  - recamaras_min: mínimo de recámaras (opcional)
  - operacion: 'Venta' | 'Alquiler' (opcional)
  - limit: cantidad de resultados (default 20)

Returns:
  Lista filtrada de propiedades que coinciden con los criterios.`,
    inputSchema: z.object({
      precio_max: z.number().optional().describe("Precio máximo en la moneda del portal"),
      precio_min: z.number().optional().describe("Precio mínimo en la moneda del portal"),
      tipo: z.enum(["Casa", "Departamento", "Terreno", "Local", "Bodega"]).optional().describe("Tipo de propiedad"),
      recamaras_min: z.number().int().min(1).max(10).optional().describe("Mínimo de recámaras"),
      operacion: z.enum(["Venta", "Alquiler"]).optional().describe("Tipo de operación"),
      limit: z.number().int().min(1).max(50).default(20).describe("Cantidad de resultados"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ precio_max, precio_min, tipo, recamaras_min, operacion, limit }) => {
    const params: Record<string, string | number> = { limit: 50 };
    if (operacion) params["operation"] = operacion;

    const data = await tokkoGet<TokkoListResponse>("property", API_KEY, params);
    let props = data.objects;

    // Filtros del lado cliente
    if (precio_max !== undefined) {
      props = props.filter((p) => {
        const price = p.operations?.[0]?.prices?.[0]?.price;
        return price !== undefined && price <= precio_max!;
      });
    }
    if (precio_min !== undefined) {
      props = props.filter((p) => {
        const price = p.operations?.[0]?.prices?.[0]?.price;
        return price !== undefined && price >= precio_min!;
      });
    }
    if (tipo) {
      props = props.filter((p) => p.property_type?.name?.toLowerCase().includes(tipo.toLowerCase()));
    }
    if (recamaras_min !== undefined) {
      props = props.filter((p) => (p.suite_amount ?? 0) >= recamaras_min!);
    }

    props = props.slice(0, limit);

    if (!props.length) {
      return { content: [{ type: "text", text: "Sin resultados para los filtros aplicados." }] };
    }

    const lines = props.map((p) => {
      const precio = p.operations?.[0]?.prices?.[0];
      const precioStr = precio ? `${precio.currency} ${Number(precio.price).toLocaleString("es-MX")}` : "Sin precio";
      const op = p.operations?.[0]?.operation_type ?? "—";
      const sup = p.total_surface ? `${p.total_surface}m²` : "";
      const rec = p.suite_amount ? `${p.suite_amount}rec` : "";
      return `[${p.id}] ${p.address || p.fake_address || "Sin dir"} | ${op} ${precioStr} | ${[sup, rec].filter(Boolean).join(" ")}`;
    });

    return { content: [{ type: "text", text: `${props.length} resultado(s):\n\n${lines.join("\n")}` }] };
  }
);

// ─── TOOL: resumen de mercado ──────────────────────────────────────────────
server.registerTool(
  "tokko_resumen_mercado",
  {
    title: "Resumen de mercado",
    description: `Genera un resumen estadístico del inventario: precio promedio, min, max por tipo de operación.
Útil para análisis de mercado rápido en SLP.

Returns:
  Estadísticas de precios por operación (Venta / Alquiler), total de activas vs inactivas.`,
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => {
    const data = await tokkoGet<TokkoListResponse>("property", API_KEY, { limit: 100 });
    const props = data.objects;
    const total = data.meta.total_count;

    const activas = props.filter((p) => p.status === 2).length;
    const ventas = props.filter((p) => p.operations?.[0]?.operation_type === "Venta");
    const rentas = props.filter((p) => p.operations?.[0]?.operation_type === "Alquiler");

    const stats = (list: TokkoProperty[], label: string): string => {
      const prices = list
        .map((p) => p.operations?.[0]?.prices?.[0]?.price)
        .filter((v): v is number => typeof v === "number" && v > 0);
      if (!prices.length) return `${label}: sin datos de precio`;
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      return `${label} (${list.length} props):\n  Promedio: $${Math.round(avg).toLocaleString("es-MX")}\n  Mínimo:   $${min.toLocaleString("es-MX")}\n  Máximo:   $${max.toLocaleString("es-MX")}`;
    };

    const text = [
      `=== RESUMEN TOKKO BROKER ===`,
      `Total en CRM: ${total} | Activas: ${activas} | Muestra analizada: ${props.length}`,
      ``,
      stats(ventas, "VENTA"),
      ``,
      stats(rentas, "RENTA"),
    ].join("\n");

    return { content: [{ type: "text", text }] };
  }
);

// ─── HTTP SERVER ───────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "tokko-mcp-server", version: "1.0.0" });
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

const PORT = parseInt(process.env.PORT || "3000");
app.listen(PORT, () => {
  console.error(`Tokko MCP server running on port ${PORT}`);
});
