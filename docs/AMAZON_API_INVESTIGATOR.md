# Arquitectura Oficial del Subagente Investigador (Amazon PA-API / Creators API)

Esta infraestructura sustituye y erradica por completo cualquier mecanismo de **web scraping**, **Puppeteer**, **navegadores headless** o **evasión de captchas**, adoptando la arquitectura REST oficial de Amazon.

---

## 1. Principios de la Nueva Arquitectura

1. **Cero Scraping & Cero Evasión de Captchas:**
   - No se realizan peticiones HTML no autorizadas contra `amazon.es/s?k=...` o páginas de producto directas.
   - No se ejecutan navegadores automatizados que consuman memoria o puedan ser interceptados por WAF/CloudFront.
   - Todas las llamadas se realizan a los endpoints REST oficiales provistos por Amazon para Afiliados y Creadores.

2. **Autenticación Oficial OAuth 2.0 (Login with Amazon - LwA):**
   - Intercambio de credenciales `client_credentials` contra los servidores de autorización de Amazon (`api.amazon.co.uk` / `api.amazon.com`).
   - Caching inteligente de tokens en memoria durante el período de validez (3.600 segundos), renovándose automáticamente antes de expirar.

3. **Cumplimiento Estricto de Límites de Tasa (Rate Limiting):**
   - **Tasa máxima permitida:** 1 TPS (1 transacción por segundo).
   - **Throttler activo:** Se aplica un retardo mínimo programado de 1.200 ms entre cada solicitud consecutiva.
   - **Retroceso Exponencial con Jitter:** En caso de recibir un código `429 Too Many Requests` o `503 Service Unavailable`, el cliente efectúa hasta 3 reintentos con cálculo de backoff (`1000 * 2^intento + jitter`).

4. **Optimización de Cuota por Lotes (Batch Queries):**
   - El endpoint `/getItems` permite consultar hasta **10 ASINs en una única llamada REST**.
   - Para cada post en `amazonlinks.csv` (`asin_1`, `asin_2`, `asin_3`), se realiza **1 sola petición agrupada**, reduciendo el consumo de cuota un 66% y acelerando el procesamiento.

---

## 2. Variables de Entorno Requeridas (.env)

El cliente lee automáticamente las siguientes variables (protegidas en `.gitignore`):

| Variable | Descripción | Formato de Ejemplo |
| :--- | :--- | :--- |
| `AMAZON_CLIENT_ID` | LwA Client ID registrado en Associates Central | `amzn1.application-oa2-client.xxxxxxxx` |
| `AMAZON_CLIENT_SECRET` | LwA Client Secret | `amzn1.oa2-cs.v1.xxxxxxxx` |
| `AMAZON_STORE_ID` | Tag de Afiliado (PartnerTag / Store ID) | `compramaes09a-21` |
| `AMAZON_MARKETPLACE` | *(Opcional)* Marketplace objetivo (defecto: `www.amazon.es`) | `www.amazon.es` |

---

## 3. Endpoints Utilizados

- **Autenticación (OAuth 2.0 Token Exchange):**
  - `POST https://api.amazon.co.uk/auth/o2/token`
  - `POST https://api.amazon.com/auth/o2/token`
  - Scope: `creatorsapi::default`
- **Catálogo de Productos:**
  - `POST https://creatorsapi.amazon/catalog/v1/getItems`
  - `POST https://creatorsapi.amazon/catalog/v1/searchItems`

---

## 4. Ejecución del Subagente

### Diagnóstico de Conexión y Credenciales
Comprueba la validez de los tokens y la respuesta de la API:
```bash
npm run investigate:diag
```

### Investigar un Post Específico
Consulta y actualiza los ASINs de una comparativa concreta de `amazonlinks.csv`:
```bash
node scripts/amazon-investigator.mjs --post cafeteras-superautomaticas
```

### Procesar Todos los Registros
Ejecuta la extracción de los 62 posts de `amazonlinks.csv` respetando el Rate Limiting:
```bash
npm run investigate:all
```

---

## 5. Nota sobre la Elegibilidad de la Cuenta (AssociateNotEligible)

Amazon exige como directiva de negocio que una cuenta de Afiliados mantenga un histórico de **al menos 10 ventas cualificadas y enviadas en los últimos 30 días** para habilitar las respuestas en vivo del catálogo.

- Cuando la cuenta cumple este requisito, la API devuelve en milisegundos los títulos, especificaciones técnicas, precios en tiempo real, descuentos e imágenes de alta resolución.
- Si la cuenta se encuentra en fase de validación o sin el umbral de 10 ventas, el sistema lo identifica con el estado `ACCOUNT_ELIGIBILITY_PENDING`, emitiendo un diagnóstico claro y preservando la integridad de los enlaces y la estructura del proyecto sin romper la compilación ni recurrir a scrapers no autorizados.
