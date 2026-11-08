# Mi Fitbit: conector MCP

Conector personal y de **solo lectura** que lleva los datos de tu Fitbit (Fitbit Air incluida) a Claude y a *Semanas contadas*, usando la **Google Health API**. Esta API reemplazó a la API web de Fitbit, que se apagó el 2 de noviembre de 2026.

## Qué entrega

| Herramienta | Qué hace |
|---|---|
| `resumen_del_dia(fecha)` | Sueño de la noche que terminó ese día (horas, hora de acostarse y despertar, etapas, siestas), pasos, minutos en zona activa, minutos activos por nivel, ejercicios y pulso en reposo. |
| `resumen_de_dias(desde, hasta)` | Lo mismo para un rango de hasta 31 días, para ver tendencias. |

Un valor `null` significa que no hay dato (por ejemplo, no llevabas puesta la pulsera). `noDisponible` dice qué dato no se pudo leer y por qué.

## Cómo funciona

- Servidor MCP sin dependencias, desplegado como funciones de Vercel (`api/mcp.js`, `api/oauth.js`).
- claude.ai se conecta con OAuth. El conector hace de intermediario con el inicio de sesión de Google y **solo acepta tu cuenta** (`ALLOWED_EMAIL`).
- No hay base de datos. Los tokens que entrega el conector están cifrados (AES-256-GCM con `TOKEN_SECRET`) y solo él puede leerlos. Los datos de salud no se guardan: se piden a Google en cada consulta.
- Pide solo permisos de lectura: `googlehealth.sleep.readonly`, `googlehealth.activity_and_fitness.readonly` y `googlehealth.health_metrics_and_measurements.readonly`.

## Puesta en marcha

### 1. Vincula tu Fitbit a Google Health
En el teléfono, abre la app **Google Health** (o Fitbit), inicia sesión con tu cuenta de Google y completa la migración de tu cuenta Fitbit si te la pide. Sin esto, la API responde `ACCOUNT_NOT_LINKED`.

### 2. Google Cloud (unos 10 minutos)
1. En [console.cloud.google.com](https://console.cloud.google.com), crea un proyecto (por ejemplo, `mi-fitbit`).
2. Activa **Google Health API** en *APIs y servicios → Biblioteca*.
3. En *Google Auth Platform*:
   - **Branding**: nombre de la app "Mi Fitbit" y tu correo.
   - **Audience**: tipo *External*, estado *Testing*. En **Test users**, añade tu correo.
   - **Data Access**: añade los tres permisos `googlehealth.*.readonly` de arriba.
   - **Clients**: crea un cliente OAuth de tipo *Web application*. En *Authorized redirect URIs*, pon `https://TU-DOMINIO/callback`, donde TU-DOMINIO es el de Vercel.
4. Copia el **Client ID** y el **Client secret**.

### 3. Vercel
Crea un proyecto desde este repositorio con **Root Directory** = `conector-fitbit` y estas variables de entorno:

| Variable | Valor |
|---|---|
| `GOOGLE_CLIENT_ID` | El Client ID de Google |
| `GOOGLE_CLIENT_SECRET` | El Client secret de Google (secreto) |
| `TOKEN_SECRET` | Texto aleatorio de 32 caracteres o más, por ejemplo la salida de `openssl rand -base64 48` (secreto) |
| `ALLOWED_EMAIL` | Tu correo de Google |
| `BASE_URL` | Opcional: `https://TU-DOMINIO` si usas un dominio propio |

Los dos valores secretos se escriben directamente en Vercel; no hace falta pegarlos en ningún chat.

### 4. claude.ai
En *Configuración → Conectores → Añadir conector personalizado*:
- Nombre: **Mi Fitbit** (*Semanas contadas* lo busca con este nombre exacto).
- URL: `https://TU-DOMINIO/mcp`

Pulsa **Conectar** y acepta los permisos en Google.

> Mientras la app de Google esté en modo *Testing*, Google puede caducar la autorización a los 7 días. Si pasa, claude.ai te pedirá volver a conectar: es un clic.

## Pruebas

```bash
npm test
```

Recorre todo el flujo con Google simulado: descubrimiento OAuth, registro, PKCE, cuenta no autorizada, renovación de tokens y lectura y conversión de los datos de sueño, pasos, zona activa, ejercicio y pulso.
