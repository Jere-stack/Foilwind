const https = require('https');

function fetchHarmonie(lat, lng) {
  return new Promise(function(resolve, reject) {
    var now = new Date();
    var start = new Date(now.getTime() - 2*3600000).toISOString().slice(0,16) + 'Z';
    var end   = new Date(now.getTime() + 48*3600000).toISOString().slice(0,16) + 'Z';
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
    var wsKey = keys.find(function(k){ return k.includes('windspeedms'); });
    var wdKey = keys.find(function(k){ return k.includes('winddirection'); });
    var wgKey = keys.find(function(k){ return k.includes('windgust'); });
    var tKey  = keys.find(function(k){ return k.includes('temperature'); });
    var wxKey = keys.find(function(k){ return k.includes('weathersymbol'); });

    if (!wsKey || !series[wsKey].length) {
      return res.status(200).json({ error: 'no wind data', debug_keys: keys });
    }

    /* Suodata menneet tunnit pois -- aloita nykyhetkesta */
    var nowMs = Date.now();
    var wsAll = series[wsKey];
    var startIdx = 0;
    for (var i = 0; i < wsAll.length; i++) {
      if (new Date(wsAll[i].t).getTime() >= nowMs - 3600000) { startIdx = i; break; }
    }

    function sliceVals(key) {
      if (!key || !series[key]) return null;
      return series[key].slice(startIdx).map(function(p){ return p.v; });
    }
    var times = wsAll.slice(startIdx).map(function(p){ return toLocal(p.t); });

    return res.status(200).json({
      source:  'FMI HARMONIE 2.5km',
      hourly:  {
        time:              times,
        windspeed_10m:     sliceVals(wsKey),
        winddirection_10m: wdKey ? sliceVals(wdKey) : times.map(function(){ return 0; }),
        windgusts_10m:     wgKey ? sliceVals(wgKey) : sliceVals(wsKey),
        temperature_2m:    tKey  ? sliceVals(tKey)  : null,
        weather_code:      wxKey ? sliceVals(wxKey) : null,
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
