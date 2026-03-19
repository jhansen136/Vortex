/**
 * import-cities.mjs
 * Downloads GeoNames US cities data and outputs a CSV for Supabase import.
 *
 * Usage:
 *   node import-cities.mjs
 *
 * Output: cities.csv (import this into Supabase → cities table)
 *
 * Requires Node 18+ (built-in fetch + fs)
 */

import { createWriteStream, createReadStream } from 'fs';
import { unlink, writeFile } from 'fs/promises';
import { createInterface } from 'readline';
import { pipeline } from 'stream/promises';
import { createUnzip } from 'zlib';

const ZIP_URL   = 'https://download.geonames.org/export/dump/US.zip';
const ZIP_FILE  = 'US.zip';
const TXT_FILE  = 'US.txt';
const OUT_FILE  = 'cities.csv';
const MIN_POP   = 500;

// GeoNames feature codes for populated places to include
const KEEP_CODES = new Set([
  'PPL',   // populated place
  'PPLA',  // seat of a first-order administrative division (state capital)
  'PPLA2', // seat of a second-order administrative division
  'PPLA3', // seat of a third-order administrative division
  'PPLC',  // capital of a political entity
  'PPLG',  // seat of government
  'PPLX',  // section of populated place
]);

// US state FIPS code → abbreviation map
const FIPS_TO_STATE = {
  '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT',
  '10':'DE','11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL',
  '18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD',
  '25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE',
  '32':'NV','33':'NH','34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND',
  '39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD',
  '47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV',
  '55':'WI','56':'WY',
};

// GeoNames admin1 code → state abbreviation (for US)
const ADMIN1_TO_STATE = {
  'AL':'AL','AK':'AK','AZ':'AZ','AR':'AR','CA':'CA','CO':'CO','CT':'CT',
  'DE':'DE','DC':'DC','FL':'FL','GA':'GA','HI':'HI','ID':'ID','IL':'IL',
  'IN':'IN','IA':'IA','KS':'KS','KY':'KY','LA':'LA','ME':'ME','MD':'MD',
  'MA':'MA','MI':'MI','MN':'MN','MS':'MS','MO':'MO','MT':'MT','NE':'NE',
  'NV':'NV','NH':'NH','NJ':'NJ','NM':'NM','NY':'NY','NC':'NC','ND':'ND',
  'OH':'OH','OK':'OK','OR':'OR','PA':'PA','RI':'RI','SC':'SC','SD':'SD',
  'TN':'TN','TX':'TX','UT':'UT','VT':'VT','VA':'VA','WA':'WA','WV':'WV',
  'WI':'WI','WY':'WY',
};

async function downloadZip() {
  console.log(`Downloading ${ZIP_URL}...`);
  const res = await fetch(ZIP_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(ZIP_FILE));
  console.log('Downloaded.');
}

async function extractTxt() {
  console.log('Extracting US.txt...');
  const { default: AdmZip } = await import('adm-zip').catch(() => {
    throw new Error('Run: npm install adm-zip');
  });
  const zip = new AdmZip(ZIP_FILE);
  zip.extractEntryTo('US.txt', '.', false, true);
  console.log('Extracted.');
}

async function parseToCsv() {
  console.log(`Parsing US.txt (min population: ${MIN_POP})...`);
  const rl = createInterface({ input: createReadStream(TXT_FILE), crlfDelay: Infinity });
  const rows = ['name,state_abbr,lat,lng,population'];
  let total = 0, kept = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    const f = line.split('\t');
    // GeoNames tab-delimited fields:
    // 0:geonameid 1:name 2:asciiname 3:alternatenames 4:latitude 5:longitude
    // 6:feature_class 7:feature_code 8:country 9:cc2
    // 10:admin1 11:admin2 12:admin3 13:admin4 14:population 15:elevation
    // 16:dem 17:timezone 18:modification_date
    total++;
    const featureClass = f[6];
    const featureCode  = f[7];
    const pop          = parseInt(f[14], 10) || 0;
    const admin1       = f[10]; // state abbreviation in GeoNames for US

    if (featureClass !== 'P') continue;
    if (!KEEP_CODES.has(featureCode)) continue;
    if (pop < MIN_POP) continue;

    const name  = f[2].replace(/,/g, '').replace(/"/g, '');  // use ascii name, strip commas/quotes
    const state = ADMIN1_TO_STATE[admin1] || admin1;
    const lat   = parseFloat(f[4]).toFixed(4);
    const lng   = parseFloat(f[5]).toFixed(4);

    rows.push(`"${name}","${state}",${lat},${lng},${pop}`);
    kept++;
  }

  await writeFile(OUT_FILE, rows.join('\n'));
  console.log(`Done. ${kept} cities kept out of ${total} total records.`);
  console.log(`Output: ${OUT_FILE}`);
}

async function cleanup() {
  try { await unlink(ZIP_FILE); } catch {}
  try { await unlink(TXT_FILE); } catch {}
}

(async () => {
  try {
    await downloadZip();
    await extractTxt();
    await parseToCsv();
    await cleanup();
    console.log('\n✅ Import cities.csv into Supabase:');
    console.log('   Dashboard → Table Editor → cities → Import data from CSV');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
