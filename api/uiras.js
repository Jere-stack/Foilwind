const zlib = require('zlib');
const https = require('https');

const BASE = 'https://iot.fvh.fi/opendata/uiras/';
const YEARS = [2025, 2026];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=3600');

  const id = (req.query.id || '').trim().toUpperCase();
  if (!id || !/^[A-F0-9]{16}$/.test(id)) {
    return res.status(400).json({ error: 'invalid id: ' + id });
  }

  try {
    const results = await Promise.allSettled(YEARS.map(y => fetchYear(y, id)));
    let pts = [];
    const debug = [];
    results.forEach(function(r, i) {
      if (r.status === 'fulfilled') {
        pts = pts.concat(r.value.pts);
        debug.push({ year: YEARS[i], found: r.value.pts.length, header: r.value.header, sample_ids: r.value.sampleIds });
      } else {
        debug.push({ year: YEARS[i], error: r.reason && r.reason.message });
      }
    });

    pts.sort(function(a, b) { return a.t < b.t ? -1 : 1; });

    const seen = new Set();
    pts = pts.filter(function(p) {
      if (seen.has(p.t)) return false;
      seen.add(p.t);
      return true;
    });

    return res.status(200).json({ id: id, count: pts.length, debug: debug, data: pts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

function fetchYear(year, targetId) {
  return new Promise(function(resolve, reject) {
    var url = BASE + 'uiras-all-' + year + '.csv.gz';
    https.get(url, function(response) {
      if (response.statusCode !== 200) {
        return reject(new Error('HTTP ' + response.statusCode));
      }
      var chunks = [];
      response.on('data', function(c) { chunks.push(c); });
      response.on('error', reject);
      response.on('end', function() {
        zlib.gunzip(Buffer.concat(chunks), function(err, buf) {
          if (err) return reject(err);
          var csv = buf.toString('utf-8');
          var lines = csv.split('\n');
          var header = lines[0].split(',').map(function(x) {
            return x.trim().replace(/\r/g, '').replace(/"/g, '');
          });

          var timeIdx = -1, devIdx = -1, tempIdx = -1;
          header.forEach(function(h, i) {
            var hl = h.toLowerCase();
            if (hl === 'time' || hl === 'timestamp') timeIdx = i;
            if (hl === "dev_id" || hl === "dev-id" || hl === "device_id" || hl === "devid" || hl === "id") devIdx = i;
            if (hl === 'temp_water' || hl === 'water_temperature' || hl === 'temperature') tempIdx = i;
          });

          var sampleIds = [];
          for (var s = 1; s < Math.min(5, lines.length); s++) {
            var sc = lines[s].split(',');
            if (sc[devIdx]) sampleIds.push((sc[devIdx] || '').trim().replace(/"/g, '').toUpperCase());
          }

          if (timeIdx < 0 || devIdx < 0 || tempIdx < 0) {
            return resolve({ pts: [], header: header, sampleIds: sampleIds });
          }

          var pts = [];
          for (var i = 1; i < lines.length; i++) {
            var cols = lines[i].split(',');
            if (cols.length < 3) continue;
            var devId = (cols[devIdx] || '').trim().replace(/"/g, '').toUpperCase();
            if (devId !== targetId) continue;
            var t = (cols[timeIdx] || '').trim().replace(/"/g, '');
            var v = parseFloat((cols[tempIdx] || '').trim());
            if (t && !isNaN(v)) pts.push({ t: t, v: v });
          }

          resolve({ pts: pts, header: header, sampleIds: sampleIds });
        });
      });
    }).on('error', reject);
  });
}
