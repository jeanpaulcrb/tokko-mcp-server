import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import { tokkoGet, formatPropText, TokkoListResponse, TokkoProperty } from "./tokko.js";

const API_KEY = process.env.TOKKO_API_KEY || "";
if (!API_KEY) { console.error("ERROR: TOKKO_API_KEY env var is required"); process.exit(1); }

const server = new McpServer({ name: "tokko-mcp-server", version: "1.0.0" });

server.registerTool("tokko_listar_propiedades",{title:"Listar propiedades",description:"Lista las propiedades en Tokko Broker.",inputSchema:{limit:z.number().int().min(1).max(50).default(20),offset:z.number().int().min(0).default(0),operacion:z.enum(["Venta","Alquiler"]).optional()},annotations:{readOnlyHint:true,destructiveHint:false}},async(params)=>{const{limit,offset,operacion}=params as{limit:number;offset:number;operacion?:string};const qp:Record<string,string|number>={limit,offset};if(operacion)qp["operation"]=operacion;const data=await tokkoGet<TokkoListResponse>("property",API_KEY,qp);const props=data.objects;if(!props.length)return{content:[{type:"text" as const,text:"No hay propiedades."}]};const lines=props.map((p)=>{const precio=p.operations?.[0]?.prices?.[0];const ps=precio?precio.currency+" "+Number(precio.price).toLocaleString("es-MX"):"Sin precio";const op=p.operations?.[0]?.operation_type??"x";const extras=[p.total_surface?p.total_surface+"m2":"",p.suite_amount?p.suite_amount+"rec":""].filter(Boolean).join(" ");return "["+p.id+"] "+(p.address||p.fake_address||"Sin dir")+" | "+op+" "+ps+" | "+extras+" | "+(p.status===2?"Activa":"Inactiva");});const text="Total: "+data.meta.total_count+" ("+( offset+1)+"-"+(offset+props.length)+")

"+lines.join("
");return{content:[{type:"text" as const,text}]};});

server.registerTool("tokko_detalle_propiedad",{title:"Detalle de propiedad",description:"Detalle completo de una propiedad por ID.",inputSchema:{id:z.number().int().positive()},annotations:{readOnlyHint:true,destructiveHint:false}},async(params)=>{const{id}=params as{id:number};const prop=await tokkoGet<TokkoProperty>("property/"+id,API_KEY);const text=formatPropText(prop);const fotos=prop.photos?.length?"
Fotos: "+prop.photos.length+" disponibles":"";return{content:[{type:"text" as const,text:text+fotos}]};});

server.registerTool("tokko_buscar_propiedades",{title:"Buscar propiedades",description:"Filtra por precio, tipo, recamaras, operacion.",inputSchema:{precio_max:z.number().optional(),precio_min:z.number().optional(),tipo:z.enum(["Casa","Departamento","Terreno","Local","Bodega"]).optional(),recamaras_min:z.number().int().min(1).max(10).optional(),operacion:z.enum(["Venta","Alquiler"]).optional(),limit:z.number().int().min(1).max(50).default(20)},annotations:{readOnlyHint:true,destructiveHint:false}},async(params)=>{const{precio_max,precio_min,tipo,recamaras_min,operacion,limit}=params as{precio_max?:number;precio_min?:number;tipo?:string;recamaras_min?:number;operacion?:string;limit:number};const qp:Record<string,string|number>={limit:100};if(operacion)qp["operation"]=operacion;const data=await tokkoGet<TokkoListResponse>("property",API_KEY,qp);let props=data.objects;if(precio_max!==undefined)props=props.filter((p)=>(p.operations?.[0]?.prices?.[0]?.price??Infinity)<=precio_max);if(precio_min!==undefined)props=props.filter((p)=>(p.operations?.[0]?.prices?.[0]?.price??0)>=precio_min);if(tipo)props=props.filter((p)=>p.property_type?.name?.toLowerCase().includes(tipo.toLowerCase()));if(recamaras_min!==undefined)props=props.filter((p)=>(p.suite_amount??0)>=recamaras_min);props=props.slice(0,limit);if(!props.length)return{content:[{type:"text" as const,text:"Sin resultados."}]};const lines=props.map((p)=>{const precio=p.operations?.[0]?.prices?.[0];const ps=precio?precio.currency+" "+Number(precio.price).toLocaleString("es-MX"):"Sin precio";const extras=[p.total_surface?p.total_surface+"m2":"",p.suite_amount?p.suite_amount+"rec":""].filter(Boolean).join(" ");return "["+p.id+"] "+(p.address||p.fake_address||"Sin dir")+" | "+(p.operations?.[0]?.operation_type??"-")+" "+ps+" | "+extras;});return{content:[{type:"text" as const,text:props.length+" resultado(s):

"+lines.join("
")}]};});

server.registerTool("tokko_resumen_mercado",{title:"Resumen de mercado",description:"Precio promedio, min y max por operacion.",inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false}},async()=>{const data=await tokkoGet<TokkoListResponse>("property",API_KEY,{limit:100});const props=data.objects;const activas=props.filter((p)=>p.status===2).length;const ventas=props.filter((p)=>p.operations?.[0]?.operation_type==="Venta");const rentas=props.filter((p)=>p.operations?.[0]?.operation_type==="Alquiler");const stats=(list:TokkoProperty[],label:string):string=>{const prices=list.map((p)=>p.operations?.[0]?.prices?.[0]?.price).filter((v):v is number=>typeof v==="number"&&v>0);if(!prices.length)return label+": sin datos";const avg=prices.reduce((a,b)=>a+b,0)/prices.length;return label+" ("+list.length+" props):
  Promedio: $"+Math.round(avg).toLocaleString("es-MX")+"
  Minimo: $"+Math.min(...prices).toLocaleString("es-MX")+"
  Maximo: $"+Math.max(...prices).toLocaleString("es-MX");};const text=["=== RESUMEN TOKKO ===","Total: "+data.meta.total_count+" | Activas: "+activas+" | Muestra: "+props.length,"",stats(ventas,"VENTA"),"",stats(rentas,"RENTA")].join("
");return{content:[{type:"text" as const,text}]};});

const app=express();
app.use(express.json());
app.get("/health",(_req,res)=>{res.json({status:"ok"});});
app.post("/mcp",async(req,res)=>{const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});res.on("close",()=>transport.close());await server.connect(transport);await transport.handleRequest(req,res,req.body);});
const PORT=parseInt(process.env.PORT||"3000");
app.listen(PORT,()=>{console.error("Tokko MCP server running on port "+PORT);});
