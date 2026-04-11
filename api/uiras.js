/**

- UiRas Historia Proxy — Vercel Serverless Function
- 
- Käyttö: GET /api/uiras?id=70B3D57050001AB9
- 
- Hakee 2025 + 2026 CSV.gz-tiedostot iot.fvh.fi:stä,
- suodattaa yhden aseman rivit ja palauttaa kevyen JSON-taulukon.
- 
- Tiedosto sijainti: api/uiras.js (projektin juuressa)
  */

import zlib from ‘zlib’;
import { pipeline } from ‘stream/promises’;
import { Readable } from ‘stream’;

const BASE = ‘https://iot.fvh.fi/opendata/uiras/’;
const YEARS = [2025, 2026];
const CACHE_SECONDS = 3600; // 1h cache Vercel CDN:ssä

export default async function handler(req, res) {
// CORS — sallii FoilSpotin tehdä kutsuja
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Access-Control-Allow-Methods’, ‘GET’);
res.setHeader(‘Cache-Control’, `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=300`);

const id = req.query.id;
if (!id || !/^[A-F0-9]{16}$/i.test(id)) {
return res.status(400).json({ error: ‘Puuttuva tai virheellinen id-parametri’ });
}

try {
// Hae molemmat vuodet rinnakkain
const results = await Promise.allSettled(
YEARS.map(year => fetchAndParseYear(year, id))
);

```
// Yhdistä onnistuneet tulokset
let allPoints = [];
results.forEach((r, i) => {
  if (r.status === 'fulfilled') {
    allPoints = allPoints.concat(r.value);
  } else {
    console.warn(`Vuosi ${YEARS[i]} epäonnistui:`, r.reason?.message);
  }
});

// Järjestä aikajärjestykseen ja poista duplikaatit
allPoints.sort((a, b) => a.t < b.t ? -1 : 1);
const seen = new Set();
allPoints = allPoints.filter(p => {
  if (seen.has(p.t)) return false;
  seen.add(p.t);
  return true;
});

res.setHeader('Content-Type', 'application/json');
return res.status(200).json({
  id,
  count: allPoints.length,
  years: YEARS,
  data: allPoints
});
```

} catch (err) {
console.error(‘UiRas proxy virhe:’, err);
return res.status(500).json({ error: err.message });
}
}

/**

- Hakee yhden vuoden CSV.gz-tiedoston ja parsii sen.
- CSV-rakenne: time,dev_id,batt,temp_in,temp_water
  */
  async function fetchAndParseYear(year, targetId) {
  const url = `${BASE}uiras-all-${year}.csv.gz`;
  const response = await fetch(url, {
  headers: { ‘Accept-Encoding’: ‘identity’ } // haetaan gz sellaisenaan
  });

if (!response.ok) throw new Error(`HTTP ${response.status} vuodelle ${year}`);

// Pura gzip Node.js:n zlib:llä
const buffer = Buffer.from(await response.arrayBuffer());
const csvText = await gunzipBuffer(buffer);

// Parsii CSV rivi kerrallaan — ei ladota kaikkea muistiin kerralla
const lines = csvText.split(’\n’);
const header = lines[0].split(’,’).map(h => h.trim().replace(/”/g, ‘’));

const timeIdx    = header.indexOf(‘time’);
const devIdIdx   = header.indexOf(‘dev_id’);
const tempWIdx   = header.indexOf(‘temp_water’);

if (timeIdx < 0 || devIdIdx < 0 || tempWIdx < 0) {
throw new Error(`CSV-otsikot puuttuu vuodelta ${year}: ${header.join(',')}`);
}

const points = [];
for (let i = 1; i < lines.length; i++) {
const line = lines[i];
if (!line.trim()) continue;

```
const cols = line.split(',');
const devId = (cols[devIdIdx] || '').trim().replace(/"/g, '');
if (devId !== targetId) continue;

const t = (cols[timeIdx] || '').trim().replace(/"/g, '');
const v = parseFloat((cols[tempWIdx] || '').trim());

if (t && !isNaN(v)) {
  points.push({ t, v });
}
```

}

return points;
}

/** Pura gzip-buffer Promise-muotoon */
function gunzipBuffer(buffer) {
return new Promise((resolve, reject) => {
zlib.gunzip(buffer, (err, result) => {
if (err) reject(err);
else resolve(result.toString(‘utf-8’));
});
});
}