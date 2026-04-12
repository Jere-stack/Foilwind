const https = require('https');

/* FMI HARMONIE piste-ennuste
   storedquery: fmi::forecast::harmonie::surface::point::timevaluepair
   Resoluutio:  2.5 km, paivittyy ~3h valein
   Cache:       1h Vercel CDN */

function fetchHarmonie(lat, lng) {
  return new Promise(function(resolve, reject) {
    var now = new Date();
    var start = now.toISOString().slice(0,16) + 'Z';
    var end = new Date(now.getTime() + 48*3600000).toISOString().slice(0,16) + 'Z';
    var url = 'https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0'
      + '&request=getFeature'
      + '&storedquery_id=fmi::forecast::harmonie::surface::point::timevaluepair'
      + '&latlon=' + lat + ',' + lng
      + '&parameters=WindSpeedMS,WindDirection,WindGust,Temperature,WeatherSymbol3'
      + '&timestep=60'
      + '&starttime=' + start
      + '&endtime=' + end;
    https.get(url, function(res) {
      var body = '';
      res.on('data', function(c) { body += c; });
      res.on('error', reject);
      res.on('end', function() { resolve(body); });
    }).on('error', reject);
  });
}

function isDst(d) {
  var mar = new Date(d.getFullYear(), 2, 31);
  mar.setDate(31 - mar.getDay());
  var oct = new Date(d.getFullYear(), 9, 31);
  oct.setDate(31 - oct.getDay());
  return d >= mar && d < oct;
}

function toLocal(iso) {
  var d = new Date(iso);
  d = new Date(d.getTime() + (isDst(d) ? 3 : 2) * 3600000);
  return d.toISOString().slice(0, 16);
}

function parseHarmonie(xml) {
  var series = {};
  var re = /gml:id="[^"]*-([a-zA-Z0-9]+)"[\s\S]*?(<wml2:point[\s\S]*?<\/wml2:MeasurementTimeseries>)/g;
  var m;
  while ((m = re.exec(xml)) !== null) {
    var param = m[1].toLowerCase();
    var block = m[2];
    var pairs = [];
    var tvRe = /<wml2:time>([^<]+)<\/wml2:time>\s*<wml2:value>([^<]+)<\/wml2:value>/g;
    var tv;
    while ((tv = tvRe.exec(block)) !== null) {
      var v = parseFloat(tv[2]);
      if (!isNaN(v)) pairs.push({ t: tv[1], v: v });
    }
    if (pairs.length) series[param] = pairs;
  }
  return series;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=300');

  var lat = parseFloat(req.query.lat);
  var lng = parseFloat(req.query.lng);
  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'lat/lng required' });
  }

  try {
    var xml = await fetchHarmonie(lat.toFixed(4), lng.toFixed(4));

    if (!xml || xml.length < 500) {
      return res.status(502).json({ error: 'empty response from FMI' });
    }

    var series = parseHarmonie(xml);
    var keys = Object.keys(series);

    var wsKey = keys.find(function(k){ return k.includes('windspeedms') || k === 'ws'; });
    var wdKey = keys.find(function(k){ return k.includes('winddirection') || k === 'wd'; });
    var wgKey = keys.find(function(k){ return k.includes('windgust') || k === 'wg'; });
    var tKey  = keys.find(function(k){ return k.includes('temperature'); });
    var wxKey = keys.find(function(k){ return k.includes('weathersymbol'); });

    if (!wsKey || !series[wsKey].length) {
      return res.status(200).json({ error: 'no wind data', debug_keys: keys });
    }

    var times = series[wsKey].map(function(p){ return toLocal(p.t); });
    var ws    = series[wsKey].map(function(p){ return p.v; });
    var wd    = wdKey ? series[wdKey].map(function(p){ return p.v; }) : ws.map(function(){ return 0; });
    var wg    = wgKey ? series[wgKey].map(function(p){ return p.v; }) : ws.slice();
    var t2m   = tKey  ? series[tKey].map(function(p){ return p.v; })  : null;
    var wx3   = wxKey ? series[wxKey].map(function(p){ return p.v; }) : null;

    return res.status(200).json({
      source:  'FMI HARMONIE 2.5km',
      hourly:  {
        time:              times,
        windspeed_10m:     ws,
        winddirection_10m: wd,
        windgusts_10m:     wg,
        temperature_2m:    t2m,
        weather_code:      wx3,
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
