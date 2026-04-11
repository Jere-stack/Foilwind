const https = require(‘https’);

/* FMI stations most relevant for foilers in Helsinki area */
const STATIONS = {
harmaja:   { id: ‘100539’, name: ‘Harmaja’,        lat: 60.1053, lng: 24.9754 },
kaisaniemi:{ id: ‘100971’, name: ‘Kaisaniemi’,     lat: 60.1752, lng: 24.9445 },
kumpula:   { id: ‘101004’, name: ‘Kumpula’,        lat: 60.2039, lng: 24.9608 },
vuosaari:  { id: ‘151028’, name: ‘Vuosaari satama’,lat: 60.2087, lng: 25.1966 },
};

/* Nearest station for spot by coordinates */
function nearest(lat, lng) {
var best = null, bd = Infinity;
Object.values(STATIONS).forEach(function(s) {
var d = Math.pow(s.lat - lat, 2) + Math.pow(s.lng - lng, 2);
if (d < bd) { bd = d; best = s; }
});
return best || STATIONS.harmaja;
}

/* Fetch FMI WFS XML and parse wind */
function fetchFmi(fmisid) {
return new Promise(function(resolve, reject) {
var url = ‘https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0’
+ ‘&request=getFeature’
+ ‘&storedquery_id=fmi::observations::weather::timevaluepair’
+ ‘&fmisid=’ + fmisid
+ ‘&parameters=WindSpeedMS,WindDirection,WindGust’
+ ‘&timestep=10’
+ ‘&starttime=’ + new Date(Date.now() - 30 * 60000).toISOString().slice(0, 16) + ‘Z’;

```
https.get(url, function(res) {
  if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
  var body = '';
  res.on('data', function(c) { body += c; });
  res.on('error', reject);
  res.on('end', function() { resolve(body); });
}).on('error', reject);
```

});
}

/* Parse XML timevaluepair ? {ws, wd, wg, time} */
function parseXml(xml) {
/* Collect all (time, value) pairs per parameter */
var blocks = xml.split(’<wml2:MeasurementTimeseries’);
var params = {};

blocks.slice(1).forEach(function(block) {
/* Parameter name */
var nameMatch = block.match(/gml:id=“obs-obs-1-1-([^”]+)”/);
var param = nameMatch ? nameMatch[1].toLowerCase() : null;
if (!param) return;

```
/* Last (newest) value */
var points = block.split('<wml2:MeasurementTVP>');
var last = points[points.length - 1];
if (!last) return;

var tMatch = last.match(/<wml2:time>([^<]+)<\/wml2:time>/);
var vMatch = last.match(/<wml2:value>([^<]+)<\/wml2:value>/);
if (tMatch && vMatch && vMatch[1] !== 'NaN') {
  params[param] = { t: tMatch[1], v: parseFloat(vMatch[1]) };
}
```

});

/* Keys may be windspeedms / windgust / winddirection */
var ws = (params[‘windspeedms’] || params[‘ws’] || {}).v;
var wd = (params[‘winddirection’] || params[‘wd’] || {}).v;
var wg = (params[‘windgust’] || params[‘wg’] || {}).v;
var t  = (params[‘windspeedms’] || params[‘ws’] || {}).t;

if (ws == null) return null;

/* Time HH:MM in Finnish timezone */
var timeStr = ‘’;
if (t) {
var d = new Date(t);
d.setHours(d.getHours() + (isDst(d) ? 3 : 2));
timeStr = (‘0’ + d.getHours()).slice(-2) + ‘:’ + (‘0’ + d.getMinutes()).slice(-2);
}

return { ws: ws, wd: wd != null ? wd : null, wg: wg != null ? wg : null, time: timeStr };
}

/* Simple DST check for Finland */
function isDst(d) {
var mar = new Date(d.getFullYear(), 2, 31);
mar.setDate(31 - mar.getDay());
var oct = new Date(d.getFullYear(), 9, 31);
oct.setDate(31 - oct.getDay());
return d >= mar && d < oct;
}

/* Vercel serverless handler */
module.exports = async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ’*’);
res.setHeader(‘Cache-Control’, ‘public, s-maxage=300, stale-while-revalidate=60’);

var lat = parseFloat(req.query.lat);
var lng = parseFloat(req.query.lng);
var stationKey = req.query.station;

var station;
if (stationKey && STATIONS[stationKey]) {
station = STATIONS[stationKey];
} else if (!isNaN(lat) && !isNaN(lng)) {
station = nearest(lat, lng);
} else {
station = STATIONS.harmaja;
}

try {
var xml = await fetchFmi(station.id);
var data = parseXml(xml);
if (!data) return res.status(200).json({ station: station.name, error: ‘no data’ });

```
return res.status(200).json({
  station: station.name,
  fmisid:  station.id,
  ws:      data.ws,
  wd:      data.wd,
  wg:      data.wg,
  time:    data.time,
});
```

} catch (err) {
return res.status(500).json({ station: station.name, error: err.message });
}
};