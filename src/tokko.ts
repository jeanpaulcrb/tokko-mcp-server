const TOKKO_BASE = "http://www.tokkobroker.com/api/v1";

export interface TokkoProperty {
  id: number;
  address: string;
  fake_address?: string;
  status: number;
  total_surface?: number;
  roofed_surface?: number;
  suite_amount?: number;
  bathroom_amount?: number;
  parking_lot_amount?: number;
  description?: string;
  description_only?: string;
  location?: { name: string; full_location: string };
  property_type?: { id: number; code: string; name: string };
  operations?: Array<{
    operation_type: string;
    prices: Array<{ currency: string; price: number; period?: string }>;
  }>;
  photos?: Array<{ image: string; thumb: string }>;
  tags?: Array<{ id: number; name: string }>;
  created_date?: string;
  updated_date?: string;
  publication_title?: string;
}

export interface TokkoListResponse {
  meta: { total_count: number; limit: number; offset: number; next?: string; previous?: string };
  objects: TokkoProperty[];
}

export async function tokkoGet<T>(
  resource: string,
  apiKey: string,
  params: Record<string, string | number> = {}
): Promise<T> {
  const url = new URL(`${TOKKO_BASE}/${resource}/`);
  url.searchParams.set("format", "json");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("lang", "es_ar");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tokko API error ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export function formatPrice(prop: TokkoProperty): string {
  const ops = prop.operations;
  if (!ops?.length) return "Sin precio";
  const op = ops[0];
  const price = op?.prices?.[0];
  if (!price) return "Consultar";
  return `${price.currency} ${Number(price.price).toLocaleString("es-MX")}`;
}

export function formatPropText(p: TokkoProperty): string {
  const lines: string[] = [
    `ID: ${p.id}`,
    `Dirección: ${p.address || p.fake_address || "Sin dirección"}`,
    `Precio: ${formatPrice(p)}`,
    `Tipo: ${p.property_type?.name ?? "—"}`,
    `Operación: ${p.operations?.[0]?.operation_type ?? "—"}`,
    `Superficie: ${p.total_surface ? `${p.total_surface} m²` : "—"}`,
    `Recámaras: ${p.suite_amount ?? "—"}`,
    `Baños: ${p.bathroom_amount ?? "—"}`,
    `Ubicación: ${p.location?.full_location ?? p.location?.name ?? "—"}`,
    `Estado: ${p.status === 2 ? "Activa" : "Inactiva"}`,
  ];
  if (p.description_only || p.description) {
    const desc = (p.description_only || p.description || "").slice(0, 300);
    lines.push(`Descripción: ${desc}${desc.length >= 300 ? "..." : ""}`);
  }
  return lines.join("\n");
}
