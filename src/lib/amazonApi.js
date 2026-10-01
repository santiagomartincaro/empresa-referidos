import fs from 'fs';
import path from 'path';

/**
 * Carga variables de entorno desde un archivo .env si no están presentes en process.env.
 * Evita dependencias externas innecesarias como dotenv.
 */
export function loadEnvFile(envPath = '.env') {
  try {
    const resolvedPath = path.resolve(process.cwd(), envPath);
    if (!fs.existsSync(resolvedPath)) {
      return {};
    }
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const parsed = {};
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      let value = line.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      parsed[key] = value;
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
    return parsed;
  } catch (err) {
    console.warn(`[AmazonApiClient] Advertencia al leer .env: ${err.message}`);
    return {};
  }
}

/**
 * Cliente REST oficial para Amazon PA-API / Creators API v1
 * Reemplaza al 100% cualquier lógica de scraping, Puppeteer y evasión de captchas.
 */
export class AmazonApiClient {
  /**
   * @param {Object} [config]
   * @param {string} [config.clientId] - LwA Client ID (AMAZON_CLIENT_ID)
   * @param {string} [config.clientSecret] - LwA Client Secret (AMAZON_CLIENT_SECRET)
   * @param {string} [config.storeId] - Associate Partner Tag / Store ID (AMAZON_STORE_ID)
   * @param {string} [config.marketplace] - Target marketplace (default: 'www.amazon.es')
   * @param {number} [config.minRequestIntervalMs] - Delay mínimo entre peticiones (default: 1200ms)
   */
  constructor(config = {}) {
    loadEnvFile();

    this.clientId = config.clientId || process.env.AMAZON_CLIENT_ID;
    this.clientSecret = config.clientSecret || process.env.AMAZON_CLIENT_SECRET;
    this.storeId = config.storeId || process.env.AMAZON_STORE_ID;
    this.marketplace = config.marketplace || process.env.AMAZON_MARKETPLACE || 'www.amazon.es';
    this.minRequestIntervalMs = config.minRequestIntervalMs || 1200; // 1.2s para respetar 1 TPS

    // Validación de presencia de credenciales oficiales
    if (!this.clientId || !this.clientSecret || !this.storeId) {
      const missing = [];
      if (!this.clientId) missing.push('AMAZON_CLIENT_ID');
      if (!this.clientSecret) missing.push('AMAZON_CLIENT_SECRET');
      if (!this.storeId) missing.push('AMAZON_STORE_ID');
      throw new Error(`[AmazonApiClient] Credenciales oficiales de Amazon ausentes: ${missing.join(', ')}. Verifica tu archivo .env.`);
    }

    // Endpoints oficiales
    this.tokenEndpoints = [
      'https://api.amazon.co.uk/auth/o2/token', // Principal para Europa (España, UK, Alemania, etc.)
      'https://api.amazon.com/auth/o2/token'    // Fallback global
    ];
    this.apiBaseUrl = 'https://creatorsapi.amazon/catalog/v1';

    // Caché de token en memoria
    this.cachedToken = null;
    this.tokenExpiresAt = 0;

    // Control de tasa de peticiones (Rate Limiter)
    this.lastRequestTime = 0;
  }

  /**
   * Obtiene y renueva automáticamente el Access Token de OAuth 2.0 (LwA)
   * Reutiliza el token existente en memoria hasta 2 minutos antes de su expiración.
   */
  async getAccessToken() {
    const now = Date.now();
    if (this.cachedToken && this.tokenExpiresAt > now + 120_000) {
      return this.cachedToken;
    }

    let lastError = null;
    for (const endpoint of this.tokenEndpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            grant_type: 'client_credentials',
            client_id: this.clientId,
            client_secret: this.clientSecret,
            scope: 'creatorsapi::default'
          })
        });

        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`HTTP ${response.status} en ${endpoint}: ${errBody}`);
        }

        const data = await response.json();
        if (!data.access_token) {
          throw new Error(`Respuesta de token sin access_token en ${endpoint}`);
        }

        this.cachedToken = data.access_token;
        const expiresInSec = data.expires_in || 3600;
        this.tokenExpiresAt = now + expiresInSec * 1000;
        return this.cachedToken;
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(`[AmazonApiClient] Fallo al autenticar en los endpoints de OAuth de Amazon: ${lastError?.message}`);
  }

  /**
   * Garantiza el cumplimiento estricto del Rate Limit de la API (1 TPS)
   */
  async throttle() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minRequestIntervalMs) {
      const waitTime = this.minRequestIntervalMs - elapsed;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Ejecuta una petición REST autenticada con reintentos y backoff exponencial ante 429 / 503
   */
  async executeRestCall(path, payload, maxRetries = 3) {
    const url = `${this.apiBaseUrl}${path}`;
    let attempt = 0;

    while (attempt <= maxRetries) {
      await this.throttle();
      const token = await this.getAccessToken();

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'x-marketplace': this.marketplace
          },
          body: JSON.stringify(payload)
        });

        if (response.status === 429) {
          // Rate limit excedido -> Espera con retroceso exponencial y jitter
          attempt++;
          const backoffMs = Math.min(1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 500), 10000);
          console.warn(`[AmazonApiClient] [429 Too Many Requests] Intento ${attempt}/${maxRetries}. Reintentando en ${backoffMs}ms...`);
          if (attempt > maxRetries) {
            throw new Error(`[AmazonApiClient] Límite de tasa (429) excedido tras ${maxRetries} reintentos.`);
          }
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }

        if (response.status === 403) {
          const errData = await response.json().catch(() => ({}));
          const reason = errData.reason || 'Forbidden';
          const msg = errData.message || 'AccessDeniedException';
          
          return {
            success: false,
            error: {
              status: 403,
              reason,
              message: msg,
              isAccountEligibilityIssue: reason === 'AssociateNotEligible'
            },
            items: []
          };
        }

        if (!response.ok) {
          const errText = await response.text();
          attempt++;
          if (response.status >= 500 && attempt <= maxRetries) {
            const backoffMs = 1500 * attempt;
            console.warn(`[AmazonApiClient] Error de servidor HTTP ${response.status}. Reintentando en ${backoffMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            continue;
          }
          throw new Error(`[AmazonApiClient] Error HTTP ${response.status} en ${path}: ${errText}`);
        }

        const data = await response.json();
        return {
          success: true,
          data,
          items: this.normalizeItems(data)
        };
      } catch (networkErr) {
        attempt++;
        if (attempt > maxRetries) {
          throw networkErr;
        }
        const backoffMs = 1000 * attempt;
        console.warn(`[AmazonApiClient] Error de red (${networkErr.message}). Reintentando en ${backoffMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  /**
   * Consulta detalles de hasta 10 ASINs en una sola llamada REST oficial (getItems)
   * @param {string[]} itemIds - Array de hasta 10 ASINs (ej. ['B00400OMU0', 'B08C7KCJF5'])
   * @param {Object} [options]
   */
  async getItems(itemIds, options = {}) {
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return { success: true, items: [] };
    }

    // Amazon acepta un máximo de 10 itemIds por petición getItems
    const validIds = itemIds.slice(0, 10);

    const payload = {
      itemIds: validIds,
      itemIdType: 'ASIN',
      marketplace: this.marketplace,
      partnerTag: this.storeId,
      partnerType: 'Associates',
      resources: options.resources || [
        'itemInfo.title',
        'itemInfo.byLineInfo',
        'itemInfo.features',
        'itemInfo.productInfo',
        'itemInfo.technicalInfo',
        'images.primary.large',
        'offersV2.listings.price',
        'offersV2.listings.availability',
        'offersV2.listings.merchantInfo'
      ]
    };

    return await this.executeRestCall('/getItems', payload);
  }

  /**
   * Búsqueda en el catálogo oficial de Amazon mediante palabras clave (searchItems)
   * @param {string} keywords - Consulta de búsqueda (ej. 'mejores cafeteras superautomaticas')
   * @param {Object} [options]
   */
  async searchItems(keywords, options = {}) {
    if (!keywords || typeof keywords !== 'string') {
      throw new Error('[AmazonApiClient] Se requiere el parámetro "keywords"');
    }

    const payload = {
      keywords: keywords.trim(),
      marketplace: this.marketplace,
      partnerTag: this.storeId,
      partnerType: 'Associates',
      itemCount: Math.min(options.itemCount || 3, 10),
      resources: options.resources || [
        'itemInfo.title',
        'itemInfo.byLineInfo',
        'itemInfo.features',
        'images.primary.large',
        'offersV2.listings.price',
        'offersV2.listings.availability'
      ]
    };

    if (options.searchIndex) {
      payload.searchIndex = options.searchIndex;
    }

    return await this.executeRestCall('/searchItems', payload);
  }

  /**
   * Normaliza los resultados heterogéneos de la API en objetos estandarizados y limpios
   */
  normalizeItems(apiResponse) {
    const rawItems = apiResponse?.itemsResult?.items || 
                     apiResponse?.searchResult?.items || 
                     [];

    return rawItems.map(item => {
      const asin = item.asin || '';
      const title = item.itemInfo?.title?.displayValue || '';
      const brand = item.itemInfo?.byLineInfo?.brand?.displayValue || 
                    item.itemInfo?.byLineInfo?.manufacturer?.displayValue || 
                    '';
      const features = item.itemInfo?.features?.displayValues || [];
      const imageUrl = item.images?.primary?.large?.url || null;

      // Extracción de oferta principal
      const primaryOffer = item.offersV2?.listings?.[0] || null;
      const priceAmount = primaryOffer?.price?.money?.amount ?? null;
      const currency = primaryOffer?.price?.money?.currency ?? 'EUR';
      const displayAmount = primaryOffer?.price?.displayAmount ?? (priceAmount ? `${priceAmount} ${currency}` : null);
      const savings = primaryOffer?.price?.savings?.money?.amount ?? null;
      const savingsPercentage = primaryOffer?.price?.savings?.percentage ?? null;

      // Disponibilidad en tiempo real
      const availabilityType = primaryOffer?.availability?.type || 'UNKNOWN';
      const availabilityMessage = primaryOffer?.availability?.message || (availabilityType === 'NOW' ? 'En stock' : 'Consultar en Amazon');
      const inStock = availabilityType === 'NOW';

      // Enlace oficial de afiliado
      const affiliateUrl = item.detailPageUrl || `https://${this.marketplace}/dp/${asin}?tag=${this.storeId}`;

      return {
        asin,
        title,
        brand,
        features,
        imageUrl,
        affiliateUrl,
        price: {
          amount: priceAmount,
          currency,
          displayAmount,
          savings,
          savingsPercentage
        },
        availability: {
          inStock,
          type: availabilityType,
          message: availabilityMessage
        },
        merchant: primaryOffer?.merchantInfo?.name || 'Amazon'
      };
    });
  }
}
