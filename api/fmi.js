const https = require('https');

const STATIONS = [
  { place: 'kaisaniemi', name: 'Helsinki Kaisaniemi',      lat: 60.17523, lng: 24.94459, type: 'weather' },
  { place: 'kumpula',    name: 'Helsinki Kumpula',         lat: 60.20307, lng: 24.96131, type: 'weather' },
  { place: 'harmaja',    name: 'Helsinki Harmaja',         lat: 60.10512, lng: 24.97539, type: 'weather' },
  { place: 'tapiola',    name: 'Espoo Tapiola',            lat: 60.17510, lng: 24.80590, type: 'weather' },
  { place: 'malmi',      name: 'Helsinki Malmi',           lat: 60.25299, lng: 25.04549, type: 'weather' },
  { place: 'vantaa',     name: 'Vantaa Helsinki-Vantaa',   lat: 60.31700, lng: 24.96300, type: 'weather' },
  { place: 'vuosaari',   name: 'Helsinki Vuosaari satama', lat: 60.20900, lng: 25.19660, type: 'maritime' },
  { place: 'sipoo',      name: 'Sipoo Itätoukki',          lat: 60.26300, lng: 25.28900, type: 'maritime' },
];

function km(a,b,c,d){
  var R=6371,dL=(c-a)*Math.PI/180,dG=(d-b)*Math.PI/180;
  return R*2*Math.asin(Math.sqrt(Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dG/2)**2));
}
function nearest(lat,lng){
  return STATIONS.slice().sort(function(a,b){return km(lat,lng,a.lat,a.lng)-km(lat,lng,b.lat,b.lng);})[0];
}
function isDst(d){
  var mar=new Date(d.getFullYear(),2,31);mar.setDate(31-mar.getDay());
  var oct=new Date(d.getFullYear(),9,31);oct.setDate(31-oct.getDay());
  return d>=mar&&d<oct;
}
function toFiTime(iso){
  if(!iso)return'';
  var d=new Date(iso);
  d=new Date(d.getTime()+(isDst(d)?3:2)*3600000);
  return('0'+d.getUTCHours()).slice(-2)+':'+('0'+d.getUTCMinutes()).slice(-2);
}
function fetchUrl(url){
  return new Promise(function(resolve,reject){
    https.get(url,function(res){
      var body='';
      res.on('data',function(c){body+=c;});
      res.on('error',reject);
      res.on('end',function(){resolve(body);});
    }).on('error',reject);
  });
}
function bbox(lat,lng,d){d=d||0.06;return(lng-d).toFixed(4)+','+(lat-d).toFixed(4)+','+(lng+d).toFixed(4)+','+(lat+d).toFixed(4);}

/* Parseri: tukee sekä weather että maritime parametrinimiä */
function parseWmlSeries(xml){
  var series={};
  /* Matchaa kaikki MeasurementTimeseries-lohkot */
  var re=/gml:id="([^"]+)"[\s\S]*?(<wml2:point[\s\S]*?<\/wml2:MeasurementTimeseries>)/g;
  var m;
  while((m=re.exec(xml))!==null){
    var id=m[1], block=m[2];
    /* id on tyyppiä "obs-obs-1-1-WindSpeedMS" — ota viimeinen osa */
    var parts=id.split('-');
    var param=parts[parts.length-1].toLowerCase();
    var points=[];
    var tvRe=/<wml2:time>([^<]+)<\/wml2:time>\s*<wml2:value>([^<]+)<\/wml2:value>/g,tv;
    while((tv=tvRe.exec(block))!==null){var v=parseFloat(tv[2]);if(!isNaN(v))points.push({t:tv[1],v:v});}
    if(points.length) series[param]=points;
  }
  return series;
}

/* Normalisoi parametrinimet → windspeedms, windgust, winddirection, temperature, dewpoint */
function normalize(series){
  var map={'ws_10min':'windspeedms','wg_10min':'windgust','wd_10min':'winddirection',
           'ws':'windspeedms','wg':'windgust','wd':'winddirection',
           't2m':'temperature','td':'dewpoint','t':'temperature'};
  var out={};
  Object.keys(series).forEach(function(k){
    var nk=map[k]||k;
    if(!out[nk]) out[nk]=series[k];
  });
  return out;
}

/* Hae weather-asema (place-parametrilla) */
function fetchWeather(place,params,start){
  var url='https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature'
    +'&storedquery_id=fmi::observations::weather::timevaluepair'
    +'&place='+encodeURIComponent(place)+'&parameters='+params+'&timestep=10&starttime='+start;
  return fetchUrl(url);
}

/* Hae maritime-asema: ensin weather bbox, sitten maritime bbox */
async function fetchMaritime(lat,lng,params,start){
  var bb=bbox(lat,lng,0.05);
  /* Yritys 1: weather storedquery bbox — jotkut satamat ovat mukana */
  var url1='https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature'
    +'&storedquery_id=fmi::observations::weather::timevaluepair'
    +'&bbox='+bb+'&parameters='+params+'&timestep=10&starttime='+start+'&maxlocations=1';
  var xml1=await fetchUrl(url1);
  var s1=normalize(parseWmlSeries(xml1));
  if(s1.windspeedms&&s1.windspeedms.length) return xml1;

  /* Yritys 2: maritime storedquery — merisäähavaintoasemat */
  var url2='https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature'
    +'&storedquery_id=fmi::observations::maritime::simple'
    +'&bbox='+bb+'&parameters=WindSpeedMS,WindGust,WindDirection&timestep=10&starttime='+start+'&maxlocations=1';
  var xml2=await fetchUrl(url2);
  return xml2;
}

module.exports = async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  var lat=parseFloat(req.query.lat),lng=parseFloat(req.query.lng);
  var placeParam=req.query.place;
  var station;
  if(placeParam){
    station=STATIONS.find(function(s){return s.place===placeParam;});
    if(!station&&!isNaN(lat)&&!isNaN(lng)) station=nearest(lat,lng);
    if(!station) station=STATIONS[0];
  } else if(!isNaN(lat)&&!isNaN(lng)){
    station=nearest(lat,lng);
  } else {
    station=STATIONS[0];
  }

  var isHistory=req.query.history==='1';
  var start=isHistory
    ? new Date(Date.now()-24*3600000).toISOString().slice(0,16)+'Z'
    : new Date(Date.now()-60*60000).toISOString().slice(0,16)+'Z';

  if(isHistory) res.setHeader('Cache-Control','public, s-maxage=600, stale-while-revalidate=120');
  else          res.setHeader('Cache-Control','public, s-maxage=300, stale-while-revalidate=60');

  try {
    var histParams='WindSpeedMS,WindGust';
    var latParams='WindSpeedMS,WindDirection,WindGust,Temperature,DewPoint';
    var params=isHistory?histParams:latParams;

    var xml;
    if(station.type==='maritime'){
      xml=await fetchMaritime(station.lat,station.lng,params,start);
    } else {
      xml=await fetchWeather(station.place,params,start);
    }

    var raw=parseWmlSeries(xml);
    var series=normalize(raw);

    if(isHistory){
      var ws=series['windspeedms']||[];
      var wg=series['windgust']||[];
      if(!ws.length) return res.status(200).json({error:'no data',station:station.name,place:station.place,ws:[],wg:[]});
      return res.status(200).json({
        station:station.name,place:station.place,
        ws:ws.map(function(p){return{t:toFiTime(p.t),v:p.v};}),
        wg:wg.map(function(p){return{t:toFiTime(p.t),v:p.v};}),
      });
    } else {
      var ws2=series['windspeedms'],wd=series['winddirection'],wg2=series['windgust'];
      var t=series['temperature'],dp=series['dewpoint'];
      var wsLast=ws2&&ws2.length?ws2[ws2.length-1]:null;
      if(!wsLast) return res.status(200).json({error:'no data',station:station.name,place:station.place});
      return res.status(200).json({
        station:station.name,place:station.place,
        ws:wsLast.v,
        wd:wd&&wd.length?wd[wd.length-1].v:null,
        wg:wg2&&wg2.length?wg2[wg2.length-1].v:null,
        tmp:t&&t.length?t[t.length-1].v:null,
        dew:dp&&dp.length?dp[dp.length-1].v:null,
        time:toFiTime(wsLast.t),
      });
    }
  } catch(err){return res.status(500).json({error:err.message});}
};
