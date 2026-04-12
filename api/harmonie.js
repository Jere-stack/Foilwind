const https = require('https');

/* FMI HARMONIE 2.5km + Open-Meteo jatko
   - HARMONIE: 2 vrk historiaa + 2 vrk ennustetta
   - Open-Meteo: jatkaa siita eteenpain 14 vrk (16 vrk yhteensa) */

const OM_URL = 'https://api.open-meteo.com/v1/forecast';

function fetchHarmonieXml(lat, lng) {
  return new Promise(function(resolve, reject) {
    var now = new Date();
    var start = new Date(now.getTime() - 48*3600000).toISOString().slice(0,16) + 'Z';
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

function fetchOM(lat, lng) {
  return new Promise(function(resolve, reject) {
    var url = OM_URL + '?latitude=' + lat + '&longitude=' + lng
      + '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,weather_code'
      + '&wind_speed_unit=ms&timezone=auto&forecast_days=16';
    https.get(url, function(res) {
      var body = '';
      res.on('data', function(c) { body += c; });
      res.on('error', reject);
      res.on('end', function() { resolve(JSON.parse(body)); });
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
    /* Hae HARMONIE ja Open-Meteo rinnakkain */
    var results = await Promise.allSettled([
      fetchHarmonieXml(lat.toFixed(4), lng.toFixed(4)),
      fetchOM(lat.toFixed(4), lng.toFixed(4))
    ]);

    var xmlResult = results[0];
    var omResult  = results[1];

    if (xmlResult.status !== 'fulfilled' || !xmlResult.value || xmlResult.value.length < 500) {
      /* HARMONIE ei saatavilla -- palautetaan Open-Meteo sellaisenaan */
      if (omResult.status === 'fulfilled' && omResult.value.hourly) {
        var oh = omResult.value.hourly;
        return res.status(200).json({
          source: 'Open-Meteo fallback',
          hourly: {
            time:              oh.time,
            windspeed_10m:     oh.wind_speed_10m,
            winddirection_10m: oh.wind_direction_10m,
            windgusts_10m:     oh.wind_gusts_10m,
            temperature_2m:    oh.temperature_2m,
            weather_code:      oh.weather_code,
          }
        });
      }
      return res.status(502).json({ error: 'both sources failed' });
    }

    /* Parsitaan HARMONIE */
    var series = parseHarmonie(xmlResult.value);
    var keys = Object.keys(series);
    var wsKey = keys.find(function(k){ return k.includes('windspeedms'); });
    var wdKey = keys.find(function(k){ return k.includes('winddirection'); });
    var wgKey = keys.find(function(k){ return k.includes('windgust'); });
    var tKey  = keys.find(function(k){ return k.includes('temperature'); });
    var wxKey = keys.find(function(k){ return k.includes('weathersymbol'); });

    if (!wsKey || !series[wsKey].length) {
      return res.status(200).json({ error: 'no wind data', debug_keys: keys });
    }

    /* Muodostetaan HARMONIE-aikasarja */
    var hTimes = series[wsKey].map(function(p){ return toLocal(p.t); });
    var hWs    = series[wsKey].map(function(p){ return p.v; });
    var hWd    = wdKey ? series[wdKey].map(function(p){ return p.v; }) : hWs.map(function(){ return 0; });
    var hWg    = wgKey ? series[wgKey].map(function(p){ return p.v; }) : hWs.slice();
    var hT     = tKey  ? series[tKey].map(function(p){ return p.v; })  : null;
    var hWx    = wxKey ? series[wxKey].map(function(p){ return p.v; }) : null;

    /* Jos Open-Meteo saatavilla, liitetaan se HARMONIE:n peraan */
    if (omResult.status === 'fulfilled' && omResult.value.hourly) {
      var oh = omResult.value.hourly;
      /* Loyda HARMONIE:n viimeinen aika -- Open-Meteo alkaa siita */
      var harmLastTime = hTimes[hTimes.length - 1];
      var spliceIdx = -1;
      if (oh.time && harmLastTime) {
        for (var i = 0; i < oh.time.length; i++) {
          /* Muunna Open-Meteo aika samaan muotoon (trimmaa sekunnit) */
          var omT = oh.time[i].slice(0, 16);
          if (omT > harmLastTime) { spliceIdx = i; break; }
        }
      }
      if (spliceIdx >= 0) {
        var omTail = oh.time.slice(spliceIdx).map(function(t){ return t.slice(0,16); });
        hTimes = hTimes.concat(omTail);
        hWs    = hWs.concat(oh.wind_speed_10m.slice(spliceIdx));
        hWd    = hWd.concat(oh.wind_direction_10m.slice(spliceIdx));
        hWg    = hWg.concat(oh.wind_gusts_10m.slice(spliceIdx));
        if (hT && oh.temperature_2m)   hT  = hT.concat(oh.temperature_2m.slice(spliceIdx));
        if (hWx && oh.weather_code)    hWx = hWx.concat(oh.weather_code.slice(spliceIdx));
      }
    }

    return res.status(200).json({
      source:  'FMI HARMONIE 2.5km + Open-Meteo',
      hourly:  {
        time:              hTimes,
        windspeed_10m:     hWs,
        winddirection_10m: hWd,
        windgusts_10m:     hWg,
        temperature_2m:    hT,
        weather_code:      hWx,
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
