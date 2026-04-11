const zlib = require('zlib');
const https = require('https');
const BASE = 'https://iot.fvh.fi/opendata/uiras/';
const YEARS = [2025, 2026];
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=3600');
  const id = (req.query.id || '').trim();
  if (!id || !/^[A-F0-9]{16}$/i.test(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }
  try {
    const results = await Promise.allSettled(YEARS.map(y => fetchYear(y, id)));
    let pts = [];
    results.forEach(r => { if (r.status === 'fulfilled') pts = pts.concat(r.value); });
    pts.sort((a, b) => a.t < b.t ? -1 : 1);
    const seen = new Set();
    pts = pts.filter(p => { if (seen.has(p.t)) return false; seen.add(p.t); return true; });
    return res.status(200).json({ id, count: pts.length, data: pts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
function fetchYear(year, id) {
  return new Promise((resolve, reject) => {
    https.get(BASE + 'uiras-all-' + year + '.csv.gz', function(res) {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('error', reject);
      res.on('end', function() {
        zlib.gunzip(Buffer.concat(chunks), function(err, buf) {
          if (err) return reject(err);
          var lines = buf.toString('utf-8').split('\n');
          var h = lines[0].split(',').map(function(x) { return x.trim().replace(/"/g, ''); });
          var ti = h.indexOf('time'), di = h.indexOf('dev_id'), vi = h.indexOf('temp_water');
          if (ti < 0 || di < 0 || vi < 0) return reject(new Error('bad csv header'));
          var pts = [];
          for (var i = 1; i < lines.length; i++) {
            var c = lines[i].split(',');
            if ((c[di] || '').trim().replace(/"/g, '') !== id) continue;
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
