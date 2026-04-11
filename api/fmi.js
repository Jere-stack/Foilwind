const https = require(‘https’);

const STATIONS = [
{ id: ‘100539’, name: ‘Harmaja’,         lat: 60.1053, lng: 24.9754 },
{ id: ‘100971’, name: ‘Kaisaniemi’,      lat: 60.1752, lng: 24.9445 },
{ id: ‘101004’, name: ‘Kumpula’,         lat: 60.2039, lng: 24.9608 },
{ id: ‘151028’, name: ‘Vuosaari satama’, lat: 60.2087, lng: 25.1966 },
];

function nearest(lat, lng) {
var best = STATIONS[0], bd = Infinity;
STATIONS.forEach(function(s) {
var d = (s.lat - lat) * (s.lat - lat) + (s.lng - lng) * (s.lng - lng);
if (d < bd) { bd = d; best = s; }
});
return best;
}

function isDst(d) {
var mar = new Date(d.getFullYear(), 2, 31);
mar.setDate(31 - mar.getDay());
var oct = new Date(d.getFullYear(), 9, 31);
oct.setDate(31 - oct.getDay());
return d >= mar && d < oct;
}

function toFiTime(iso) {
if (!iso) return ‘’;
var d = new Date(iso);
var off = isDst(d) ? 3 : 2;
d = new Date(d.getTime() + off * 3600000);
return (‘0’ + d.getUTCHours()).slice(-2) + ‘:’ + (‘0’ + d.getUTCMinutes()).slice(-2);
}

function fetchXml(fmisid) {
return new Promise(function(resolve, reject) {
var start = new Date(Date.now() - 60 * 60000).toISOString().replace(/.\d+Z$/, ‘Z’);
var url = ‘https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0’
+ ‘&request=getFeature’
+ ‘&storedquery_id=fmi::observations::weather::timevaluepair’
+ ‘&fmisid=’ + fmisid
+ ‘&parameters=WindSpeedMS,WindDirection,WindGust,Temperature,DewPoint’
+ ‘&timestep=10’
+ ‘&starttime=’ + start;
https.get(url, function(res) {
var body = ‘’;
res.on(‘data’, function(c) { body += c; });
res.on(‘error’, reject);
res.on(‘end’, function() { resolve(body); });
}).on(‘error’, reject);
});
}

function parseXml(xml) {
var result = {};
var re = /gml:id=”[^”]*-([a-zA-Z]+)”[\s\S]*?(<wml2:point[\s\S]*?</wml2:MeasurementTimeseries>)/g;
var m;
while ((m = re.exec(xml)) !== null) {
var param = m[1].toLowerCase();
var block = m[2];
var pairs = [];
var tvRe = /<wml2:time>([^<]+)</wml2:time>\s*<wml2:value>([^<]+)</wml2:value>/g;
var tv;
while ((tv = tvRe.exec(block)) !== null) {
var v = parseFloat(tv[2]);
if (!isNaN(v)) pairs.push({ t: tv[1], v: v });
}
if (pairs.length > 0) result[param] = pairs[pairs.length - 1];
}
return result;
}

module.exports = async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Cache-Control’, ‘public, s-maxage=300, stale-while-revalidate=60’);

var lat = parseFloat(req.query.lat);
var lng = parseFloat(req.query.lng);
var station = (!isNaN(lat) && !isNaN(lng)) ? nearest(lat, lng) : STATIONS[0];

try {
var xml = await fetchXml(station.id);
var d = parseXml(xml);
var keys = Object.keys(d);
var ws = d[‘windspeedms’] || d[‘ws’] || null;
var wd = d[‘winddirection’] || d[‘wd’] || null;
var wg = d[‘windgust’] || d[‘wg’] || null;
var t  = d[‘temperature’] || null;
var dp = d[‘dewpoint’] || null;

```
return res.status(200).json({
  station:   station.name,
  fmisid:    station.id,
  ws:        ws  ? ws.v  : null,
  wd:        wd  ? wd.v  : null,
  wg:        wg  ? wg.v  : null,
  tmp:       t   ? t.v   : null,
  dew:       dp  ? dp.v  : null,
  time:      ws  ? toFiTime(ws.t) : null,
  debug_keys: keys,
});
```

} catch (err) {
return res.status(500).json({ station: station.name, error: err.message });
}
};