const zlib = require('zlib');
const https = require('https');

const BASE = 'https://iot.fvh.fi/opendata/uiras/';
const YEARS = [2025, 2026];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=3600');

  const id = (req.query.id || '').trim().toUpperCase();
  if (!id || !/^[A-F0-9]{16}$/.test(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }

  try {
    const results = await Promise.allSettled(YEARS.map(function(y) { return fetchYear(y, id); }));
    var pts = [];
    results.forEach(function(r) {
      if (r.status === 'fulfilled') pts = pts.concat(r.value);
    });

    pts.sort(function(a, b) { return a.t < b.t ? -1 : 1; });
    var seen = new Set();
    pts = pts.filter(function(p) {
      if (seen.has(p.t)) return false;
      seen.add(p.t);
      return true;
    });

    return res.status(200).json({ id: id, count: pts.length, data: pts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

function fetchYear(year, targetId) {
  return new Promise(function(resolve, reject) {
    https.get(BASE + 'uiras-all-' + year + '.csv.gz', function(response) {
      if (response.statusCode !== 200) return reject(new Error('HTTP ' + response.statusCode));
      var chunks = [];
      response.on('data', function(c) { chunks.push(c); });
      response.on('error', reject);
      response.on('end', function() {
        zlib.gunzip(Buffer.concat(chunks), function(err, buf) {
          if (err) return reject(err);
          var lines = buf.toString('utf-8').split('\n');
          var header = lines[0].split(',').map(function(x) {
            return x.trim().replace(/\r/g, '').replace(/"/g, '').toLowerCase();
          });
          var ti = header.indexOf('time');
          var di = header.indexOf('dev-id');
          if (di < 0) di = header.indexOf('dev_id');
          var vi = header.indexOf('temp_water');
          if (ti < 0 || di < 0 || vi < 0) return resolve([]);
          var pts = [];
          for (var i = 1; i < lines.length; i++) {
            var c = lines[i].split(',');
            if (c.length < 3) continue;
            if ((c[di] || '').trim().replace(/"/g, '').toUpperCase() !== targetId) continue;
            var t = (c[ti] || '').trim().replace(/"/g, '');
            var v = parseFloat(c[vi]);
            if (t && !isNaN(v)) pts.push({ t: t, v: v });
          }
          resolve(pts);
        });
      });
    }).on('error', reject);
  });
}
