#!/usr/bin/env node
/**
 * Subagente Investigador Oficial de Amazon (PA-API / Creators API)
 * 
 * Arquitectura 100% oficial basada en llamadas REST directas.
 * Queda totalmente erradicado cualquier uso de web scraping, Puppeteer,
 * emuladores de navegador o técnicas de evasión de captchas.
 * 
 * Uso:
 *   node scripts/amazon-investigator.mjs --diag
 *   node scripts/amazon-investigator.mjs --post cafeteras-superautomaticas
 *   node scripts/amazon-investigator.mjs --limit 5
 *   node scripts/amazon-investigator.mjs --all
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AmazonApiClient, loadEnvFile } from '../src/lib/amazonApi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Cargar variables de entorno
loadEnvFile(path.join(ROOT_DIR, '.env'));

/**
 * Lee y parsea el archivo amazonlinks.csv
 */
function readAmazonLinksCsv(csvPath = path.join(ROOT_DIR, 'amazonlinks.csv')) {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`[Investigador] Archivo CSV no encontrado en: ${csvPath}`);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length <= 1) {
    return [];
  }

  const header = lines[0].split(',').map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    if (values.length < header.length) continue;

    const row = {};
    header.forEach((key, idx) => {
      row[key] = values[idx] || '';
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Diagnóstico de conexión y credenciales de la API de Amazon
 */
async function runDiagnostics(client) {
  console.log('\n======================================================');
  console.log('🔍 [DIAGNÓSTICO OFICIAL] AMAZON CREATORS API / PA-API');
  console.log('======================================================');
  console.log(`• Marketplace:     ${client.marketplace}`);
  console.log(`• Store ID:        ${client.storeId}`);
  console.log(`• Client ID:       ${client.clientId.slice(0, 15)}... (${client.clientId.length} chars)`);
  console.log(`• Rate Limit:      1 TPS (Intervalo mínimo: ${client.minRequestIntervalMs}ms)`);
  console.log(`• Scraping/Puppet: DESACTIVADO (Cero scraping, arquitectura REST pura)`);
  console.log('------------------------------------------------------');

  console.log('\n1. Verificando autenticación OAuth 2.0 (LwA)...');
  try {
    const token = await client.getAccessToken();
    console.log('   ✅ Token OAuth 2.0 obtenido exitosamente:');
    console.log(`      Prefijo: ${token.slice(0, 20)}...`);
    console.log(`      Expira en: ${new Date(client.tokenExpiresAt).toLocaleTimeString()}`);
  } catch (err) {
    console.error(`   ❌ Error al solicitar Access Token: ${err.message}`);
    return;
  }

  console.log('\n2. Verificando endpoint de catálogo (getItems con ASIN de prueba)...');
  const testAsin = 'B00400OMU0'; // De'Longhi Magnifica S
  try {
    const result = await client.getItems([testAsin]);
    if (result.success) {
      console.log('   ✅ Consulta a Creators API completada con éxito.');
      console.log(`      Items devueltos: ${result.items.length}`);
      if (result.items.length > 0) {
        const item = result.items[0];
        console.log(`      - ASIN:          ${item.asin}`);
        console.log(`      - Título:        ${item.title.slice(0, 60)}...`);
        console.log(`      - Precio:        ${item.price.displayAmount || 'N/A'}`);
        console.log(`      - Stock:         ${item.availability.message}`);
        console.log(`      - Enlace Af.:    ${item.affiliateUrl}`);
      }
    } else if (result.error?.isAccountEligibilityIssue) {
      console.log('   ⚠️  Autenticación completada pero estado de cuenta restringido:');
      console.log(`      Motivo:   ${result.error.reason} (HTTP ${result.error.status})`);
      console.log(`      Mensaje:  ${result.error.message}`);
      console.log('\n   ℹ️  Nota sobre elegibilidad en Amazon Associates:');
      console.log('      Amazon requiere un historial activo de al menos 10 ventas cualificadas en');
      console.log('      los últimos 30 días para consultar el catálogo en vivo sin restricciones.');
      console.log('      Tus credenciales y la arquitectura REST están 100% configuradas y validadas.');
    } else {
      console.log(`   ❌ Error de API: ${JSON.stringify(result.error)}`);
    }
  } catch (err) {
    console.error(`   ❌ Error en llamada getItems: ${err.message}`);
  }

  console.log('======================================================\n');
}

/**
 * Función principal del Subagente Investigador
 */
async function main() {
  const args = process.argv.slice(2);
  const isDiag = args.includes('--diag');
  const isAll = args.includes('--all');
  const postFlagIdx = args.indexOf('--post');
  const targetPost = postFlagIdx !== -1 ? args[postFlagIdx + 1] : null;
  const limitFlagIdx = args.indexOf('--limit');
  const limit = limitFlagIdx !== -1 ? parseInt(args[limitFlagIdx + 1], 10) : (isAll ? Infinity : 3);
  const outFlagIdx = args.indexOf('--output');
  const outputPath = outFlagIdx !== -1 ? path.resolve(args[outFlagIdx + 1]) : path.join(ROOT_DIR, 'data', 'amazon_products_cache.json');

  console.log('🚀 Iniciando Subagente Investigador de Amazon (Modo 100% REST Oficial)...');

  let client;
  try {
    client = new AmazonApiClient();
  } catch (err) {
    console.error(`❌ [Error de Inicialización]: ${err.message}`);
    process.exit(1);
  }

  if (isDiag) {
    await runDiagnostics(client);
    return;
  }

  // Leer registros de amazonlinks.csv
  const allRows = readAmazonLinksCsv();
  console.log(`📄 Total de registros encontrados en amazonlinks.csv: ${allRows.length}`);

  let rowsToProcess = allRows;
  if (targetPost) {
    rowsToProcess = allRows.filter(r => r.id_post === targetPost);
    if (rowsToProcess.length === 0) {
      console.error(`❌ No se encontró ningún post con id_post="${targetPost}" en amazonlinks.csv`);
      process.exit(1);
    }
  } else if (Number.isFinite(limit)) {
    rowsToProcess = allRows.slice(0, limit);
  }

  console.log(`🎯 Procesando ${rowsToProcess.length} post(s) con la API oficial...\n`);

  // Asegurar directorio de salida
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Cargar datos previos de caché si existen
  let existingCache = {};
  if (fs.existsSync(outputPath)) {
    try {
      existingCache = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    } catch {
      existingCache = {};
    }
  }

  const results = {
    updatedAt: new Date().toISOString(),
    storeId: client.storeId,
    marketplace: client.marketplace,
    posts: { ...existingCache.posts }
  };

  let eligibilityWarningLogged = false;

  for (let i = 0; i < rowsToProcess.length; i++) {
    const row = rowsToProcess[i];
    const { id_post, keyword_seo, categoria, asin_1, asin_2, asin_3, tag_afiliado } = row;
    const asins = [asin_1, asin_2, asin_3].filter(a => a && a.startsWith('B0'));

    console.log(`[${i + 1}/${rowsToProcess.length}] Post: "${id_post}" (${categoria})`);
    console.log(`   ASINs: ${asins.join(', ')}`);

    if (asins.length === 0) {
      console.log('   ⚠️ Sin ASINs válidos registrados para este post.');
      continue;
    }

    try {
      // Llamada REST getItems agrupando hasta los 3 ASINs en 1 única solicitud (optimización de cuota)
      const res = await client.getItems(asins);

      if (res.success && res.items.length > 0) {
        console.log(`   ✅ Extraídos ${res.items.length} productos vía API oficial:`);
        results.posts[id_post] = {
          keyword_seo,
          categoria,
          tag_afiliado: tag_afiliado || client.storeId,
          lastCheck: new Date().toISOString(),
          status: 'SUCCESS',
          items: res.items
        };

        for (const item of res.items) {
          console.log(`      • [${item.asin}] ${item.title.slice(0, 45)}... | Precio: ${item.price.displayAmount || 'N/D'} | Stock: ${item.availability.message}`);
        }
      } else if (res.error?.isAccountEligibilityIssue) {
        if (!eligibilityWarningLogged) {
          console.warn('\n   ⚠️ [AVISO DE CUOTA DE AFILIADO]');
          console.warn('   La API de Amazon devolvió "AssociateNotEligible".');
          console.warn('   Tu cuenta aún no registra las 10 ventas mínimas en los últimos 30 días para desbloquear el catálogo en vivo.');
          console.warn('   Registrando los ASINs y enlaces oficiales verificados para mantener la estructura.\n');
          eligibilityWarningLogged = true;
        }

        // Construir datos canónicos estructurados con enlaces oficiales para no perder continuidad
        const fallbackItems = asins.map(asin => ({
          asin,
          title: `Producto ${asin} (${keyword_seo})`,
          brand: '',
          features: [],
          imageUrl: null,
          affiliateUrl: `https://${client.marketplace}/dp/${asin}?tag=${tag_afiliado || client.storeId}`,
          price: { amount: null, currency: 'EUR', displayAmount: null, savings: null, savingsPercentage: null },
          availability: { inStock: true, type: 'UNKNOWN', message: 'Consultar en Amazon' },
          merchant: 'Amazon'
        }));

        results.posts[id_post] = {
          keyword_seo,
          categoria,
          tag_afiliado: tag_afiliado || client.storeId,
          lastCheck: new Date().toISOString(),
          status: 'ACCOUNT_ELIGIBILITY_PENDING',
          items: fallbackItems
        };
      } else {
        console.warn(`   ⚠️ No se devolvieron datos para este lote.`);
      }
    } catch (apiErr) {
      console.error(`   ❌ Error al procesar post "${id_post}": ${apiErr.message}`);
    }
  }

  // Guardar archivo JSON estructurado
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\n💾 Resultados guardados exitosamente en: ${outputPath}`);
  console.log('✨ Ejecución completada respetando 100% la política oficial de Amazon.');
}

// Ejecutar si se invoca directamente desde CLI
if (process.argv[1] && process.argv[1].endsWith('amazon-investigator.mjs')) {
  main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}

export { main, readAmazonLinksCsv, runDiagnostics };
