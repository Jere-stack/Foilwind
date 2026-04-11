/**

- UiRas Historia Proxy — Vercel Serverless Function (CommonJS)
- Käyttö: GET /api/uiras?id=70B3D57050001AB9
  */

const zlib = require(‘zlib’);
const https = require(‘https’);

const BASE = ‘https://iot.fvh.fi/opendata/uiras/’;
const YEARS = [2025, 2026];

module.exports = async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Access-Control-Allow-Methods’, ‘GET’);
res.setHeader(‘Cache-Control’, ‘public, s-maxage=3600, stale-while-revalidate=300’);

const id = (req.query.id || ‘’).trim();
if (!id || !/^[A-F0-9]{16}$/i.test(id)) {
return res.status(400).json({ error: ‘Puuttuva tai virheellinen id’ });
}

try {
const results = await Promise.allSettled(
YEARS.map(year => fetchYear(year, id))
);

```
let allPoints = [];
results.forEach((r, i) => {
  if (r.status === 'fulfilled') {
    allPoints = allPoints.concat(r.value);
  } else {
    console.warn('Vuosi ' + YEARS[i] + ' epaonnistui:', r.reason && r.reason.message);
  }
});

allPoints.sort((a, b) => a.t < b.t ? -1 : 1);
const seen = new Set();
allPoints = allPoints.filter(p => {
  if (seen.has(p.t)) return false;
  seen.add(p.t);
  return true;
});

return res.status(200).json({
  id,
  count: allPoints.length,
  years: YEARS,
  data: allPoints
});
```

} catch (err) {
console.error(‘Proxy virhe:’, err.message);
return res.status(500).json({ error: err.message });
}
};

function fetchYear(year, targetId) {
return new Promise((resolve, reject) => {
const url = BASE + ‘uiras-all-’ + year + ‘.csv.gz’;

```
https.get(url, function(response) {
  if (response.statusCode !== 200) {
    return reject(new Error('HTTP ' + response.statusCode + ' vuodelle ' + year));
  }

  const chunks = [];
  response.on('data', function(chunk) { chunks.push(chunk); });
  response.on('error', reject);
  response.on('end', function() {
    const buffer = Buffer.concat(chunks);
    zlib.gunzip(buffer, function(err, result) {
      if (err) return reject(new Error('Gzip virhe: ' + err.message));

      try {
        const csv = result.toString('utf-8');
        const lines = csv.split('\n');
        const header = lines[0].split(',').map(function(h) {
          return h.trim().replace(/"/g, '');
        });

        const timeIdx = header.indexOf('time');
        const devIdx  = header.indexOf('dev_id');
        const tempIdx = header.indexOf('temp_water');

        if (timeIdx < 0 || devIdx < 0 || tempIdx < 0) {
          return reject(new Error('CSV-otsikot puuttuu: ' + header.join(',')));
        }

        const points = [];
        for (var i = 1; i < lines.length; i++) {
          var line = lines[i];
          if (!line.trim()) continue;
          var cols = line.split(',');
          var devId = (cols[devIdx] || '').trim().replace(/"/g, '');
          if (devId !== targetId) continue;
          var t = (cols[timeIdx] || '').trim().replace(/"/g, '');
          var v = parseFloat((cols[tempIdx] || '').trim());
          if (t && !isNaN(v)) points.push({ t: t, v: v });
        }

        resolve(points);
      } catch (parseErr) {
        reject(new Error('Parsinta epaonnistui: ' + parseErr.message));
      }
    });
  });
}).on('error', reject);
```

});
}