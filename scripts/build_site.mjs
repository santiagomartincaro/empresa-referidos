import { build } from 'astro';

console.log('Building Astro site...');
try {
  await build({});
  console.log('ASTRO_BUILD_SUCCESS');
} catch (err) {
  console.error('ASTRO_BUILD_ERROR:', err);
  process.exit(1);
}
