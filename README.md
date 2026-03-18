# Tokko MCP Server — Renova Finarca

MCP server para conectar Claude con la API de Tokko Broker.

## Herramientas disponibles

| Tool | Descripción |
|------|-------------|
| `tokko_listar_propiedades` | Lista el inventario completo con paginación |
| `tokko_detalle_propiedad` | Ficha completa de una propiedad por ID |
| `tokko_buscar_propiedades` | Búsqueda filtrada por precio, tipo, recámaras, operación |
| `tokko_resumen_mercado` | Estadísticas: precio promedio/min/max por operación |

---

## Deploy en Railway

### 1. Crear proyecto en Railway

1. Ir a [railway.app](https://railway.app) → New Project → Deploy from GitHub Repo
2. O usar Railway CLI: `railway init`

### 2. Configurar variable de entorno

En Railway > Variables, agregar:
```
TOKKO_API_KEY=tu_api_key_de_tokko
```

### 3. Railway detecta automáticamente el `package.json`

El build command es `npm run build` y el start es `npm start`.
Railway lo detecta solo.

### 4. Obtener la URL pública

Railway asigna una URL tipo:
```
https://tokko-mcp-server-production.up.railway.app
```

---

## Conectar a Claude.ai

En Claude.ai > Settings > Connectors > Add MCP Server:

```
URL: https://tu-app.up.railway.app/mcp
Name: Tokko Broker
```

---

## Desarrollo local

```bash
npm install
TOKKO_API_KEY=tu_key npm run dev
```

Health check: `GET http://localhost:3000/health`
