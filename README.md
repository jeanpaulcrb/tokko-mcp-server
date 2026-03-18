# Tokko MCP Server — Renova Finarca

MCP server que conecta Claude con tu CRM Tokko Broker via API REST.

## Deploy en Railway

1. Sube este repo a GitHub
2. En Railway: New Project → Deploy from GitHub
3. En Variables de entorno agrega:
   - `TOKKO_API_KEY` = tu API key de Tokko
   - `PORT` = 3000 (Railway lo setea automático)
4. Una vez deployado, copia la URL pública (ej. `https://tokko-mcp-server.up.railway.app`)

## Conectar en Claude.ai

En Settings → Integrations → Add MCP Server:
- URL: `https://tu-dominio.up.railway.app/mcp`
- Name: `Tokko Broker`

## Herramientas disponibles

- `tokko_list_properties` — Lista todas las propiedades
- `tokko_search_properties` — Busca por precio, tipo, operación
- `tokko_get_property` — Detalle completo de una propiedad por ID
- `tokko_market_summary` — Estadísticas del inventario (precio promedio, m², etc.)
- `tokko_list_developments` — Lista desarrollos/emprendimientos

## Health check

GET `https://tu-dominio.up.railway.app/health`
