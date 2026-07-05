const https = require('https');

const CSV_URL = 'https://swell.fmi.fi/Marinehelsinki/csv/kruunuvuorenselka_weatherdata.csv';
const STATION = { name: 'Kruunuvuorenselkä', place: 'kruunuvuorenselka', lat: 60.163, lng: 24.997 };
const HISTORY_HOURS = 30; /* pidetään historia samaa suuruusluokkaa kuin muilla asemilla (24h + marginaali) */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=300'); /* data päivittyy n. 10min välein */

  try {
    const csvText = await fetchText(CSV_URL);
    const rawLines = csvText.split('\n');

    /* Ohita '#'-kommenttirivit ja tyhjät rivit, poimi otsikko + datarivit */
    const lines = rawLines.map(function (l) { return l.trim(); })
      .filter(function (l) { return l.length && l.charAt(0) !== '#'; });

    if (lines.length < 2) {
      return res.status(200).json({ error: 'no data', station: STATION.name });
    }

    const dataLines = lines.slice(1); /* rivi 0 = otsikko "Localtime","UTC","Ws",... */
    const cutoffMs = Date.now() - HISTORY_HOURS * 3600000;

    const wsHist = [];
    const wgHist = [];
    let latest = null;
    let latestMs = -Infinity;
    let latestValid = null;     /* uusin rivi jossa ws ei ole NaN — käytetään näytölle */
    let latestValidMs = -Infinity;

    for (let i = 0; i < dataLines.length; i++) {
      const cols = dataLines[i].split(',').map(function (s) {
        return s.trim().replace(/^"|"$/g, '');
      });
      if (cols.length < 7) continue;

      const localtime = cols[0];  /* "2026-05-25T12:10:00" — Suomen aika */
      const utcTime   = cols[1];  /* "2026-05-25T09:10:00Z" — yksiselitteinen */
      const ws   = parseNum(cols[2]);
      const gust = parseNum(cols[3]);
      const wdir = parseNum(cols[4]);
      const ta   = parseNum(cols[5]);
      const tw   = parseNum(cols[6]);

      /* "HH:MM" Localtime-sarakkeesta — sama formaatti kuin muualla apissa
         (_renderLiveHistory ja _histValueAt käyttävät tätä muotoa suoraan) */
      const hhmm = localtime.length >= 16 ? localtime.slice(11, 16) : null;
      if (!hhmm) continue;

      const utcMs = Date.parse(utcTime);
      if (isNaN(utcMs)) continue;

      if (utcMs >= cutoffMs) {
        wsHist.push({ t: hhmm, v: ws, d: wdir, iso: utcTime });
        wgHist.push({ t: hhmm, v: gust, iso: utcTime });
      }

      /* Uusin havainto = suurin UTC-aikaleima — ei oleteta rivijärjestystä */
      if (utcMs > latestMs) {
        latestMs = utcMs;
        latest = { ws: ws, wg: gust, wd: wdir, ta: ta, tw: tw, hhmm: hhmm, utcTime: utcTime };
      }
      /* Erikseen: uusin rivi jossa tuulilukema on oikeasti olemassa (ei anturikatko) */
      if (ws != null && utcMs > latestValidMs) {
        latestValidMs = utcMs;
        latestValid = { ws: ws, wg: gust, wd: wdir, ta: ta, tw: tw, hhmm: hhmm, utcTime: utcTime };
      }
    }

    if (!latest) {
      return res.status(200).json({ error: 'no valid rows', station: STATION.name });
    }

    /* Näytölle: käytä viimeisintä validia tuulilukemaa jos sellainen löytyy,
       muuten kaikkein uusinta riviä (voi olla null-arvoinen anturikatko) */
    const display = latestValid || latest;

    return res.status(200).json({
      station: STATION.name,
      place: STATION.place,
      lat: STATION.lat,
      lng: STATION.lng,
      ws: display.ws,
      wg: display.wg,
      wd: display.wd,
      ta: latest.ta,
      tw: latest.tw,
      time: display.hhmm,
      utcTime: display.utcTime,
      history: { ws: wsHist, wg: wgHist }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, station: STATION.name });
  }
};

function parseNum(s) {
  if (s == null || s === '') return null;
  const v = parseFloat(s);
  return isNaN(v) ? null : v;
}

function fetchText(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, function (response) {
      if (response.statusCode !== 200) {
        return reject(new Error('HTTP ' + response.statusCode));
      }
      const chunks = [];
      response.on('data', function (c) { chunks.push(c); });
      response.on('error', reject);
      response.on('end', function () {
        resolve(Buffer.concat(chunks).toString('utf-8'));
      });
    }).on('error', reject);
  });
}
