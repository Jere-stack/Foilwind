const https = require('https');

const STATIONS = [
  { place: 'kaisaniemi', name: 'Helsinki Kaisaniemi',      lat: 60.17523, lng: 24.94459, type: 'weather' },
  { place: 'kumpula',    name: 'Helsinki Kumpula',         lat: 60.20307, lng: 24.96131, type: 'weather' },
  { place: 'harmaja',    name: 'Helsinki Harmaja',         lat: 60.10512, lng: 24.97539, type: 'weather' },
  { place: 'tapiola',    name: 'Espoo Tapiola',            lat: 60.17510, lng: 24.80590, type: 'weather' },
  { place: 'malmi',      name: 'Helsinki Malmi',           lat: 60.25299, lng: 25.04549, type: 'weather' },
  { place: 'vantaa',     name: 'Vantaa Helsinki-Vantaa',   lat: 60.31700, lng: 24.96300, type: 'weather' },
  { place: 'vuosaari',   name: 'Helsinki Vuosaari satama', lat: 60.20900, lng: 25.19660, type: 'maritime' },
  /* Sipoo Itätoukki — koordinaatit WGS84/EUREF-FIN: 60°09'29"N 25°19'34"E */
  { place: 'sipoo',      name: 'Sipoo Itätoukki',          lat: 60.15806, lng: 25.32611, type: 'maritime' },
];

function km(a,b,c,d){var R=6371,dL=(c-a)*Math.PI/180,dG=(d-b)*Math.PI/180;return R*2*Math.asin(Math.sqrt(Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dG/2)**2));}
function nearest(lat,lng){return STATIONS.slice().sort(function(a,b){return km(lat,lng,a.lat,a.lng)-km(lat,lng,b.lat,b.lng);})[0];}
function isDst(d){var mar=new Date(d.getFullYear(),2,31);mar.setDate(31-mar.getDay());var oct=new Date(d.getFullYear(),9,31);oct.setDate(31-oct.getDay());return d>=mar&&d<oct;}
function toFiTime(iso){if(!iso)return'';var d=new Date(iso);d=new Date(d.getTime()+(isDst(d)?3:2)*3600000);return('0'+d.getUTCHours()).slice(-2)+':'+('0'+d.getUTCMinutes()).slice(-2);}

function fetchUrl(url){
  return new Promise(function(resolve,reject){
    https.get(url,function(res){var body='';res.on('data',function(c){body+=c;});res.on('error',reject);res.on('end',function(){resolve(body);});}).on('error',reject);
  });
}

/* Alkuperäinen toimiva parseri */
function parseLatest(xml){
  var result={};
  var re=/gml:id="[^"]*-([a-zA-Z]+)"[\s\S]*?(<wml2:point[\s\S]*?<\/wml2:MeasurementTimeseries>)/g;
  var m;
  while((m=re.exec(xml))!==null){
    var param=m[1].toLowerCase(),block=m[2],pairs=[];
    var tvRe=/<wml2:time>([^<]+)<\/wml2:time>\s*<wml2:value>([^<]+)<\/wml2:value>/g,tv;
    while((tv=tvRe.exec(block))!==null){var v=parseFloat(tv[2]);if(!isNaN(v))pairs.push({t:tv[1],v:v});}
    if(pairs.length>0)result[param]=pairs[pairs.length-1];
  }
  return result;
}
function parseHistory(xml){
  var series={};
  var re=/gml:id="[^"]*-([a-zA-Z]+)"[\s\S]*?(<wml2:point[\s\S]*?<\/wml2:MeasurementTimeseries>)/g;
  var m;
  while((m=re.exec(xml))!==null){
    var param=m[1].toLowerCase(),block=m[2],points=[];
    var tvRe=/<wml2:time>([^<]+)<\/wml2:time>\s*<wml2:value>([^<]+)<\/wml2:value>/g,tv;
    while((tv=tvRe.exec(block))!==null){var v=parseFloat(tv[2]);if(!isNaN(v))points.push({t:tv[1],v:v});}
    series[param]=points;
  }
  return series;
}

function makeBbox(lat,lng,d){return(lng-d).toFixed(4)+','+(lat-d).toFixed(4)+','+(lng+d).toFixed(4)+','+(lat+d).toFixed(4);}

/* Weather-asema: place-parametrilla (toimii varmasti) */
function fetchWeather(place,params,start){
  var url='https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature'
    +'&storedquery_id=fmi::observations::weather::timevaluepair'
    +'&place='+encodeURIComponent(place)+'&parameters='+params+'&timestep=10&starttime='+start;
  return fetchUrl(url);
}

/* Maritime-asema: 3 strategiaa järjestyksessä */
async function fetchMaritime(lat,lng,params,start){
  var BASE='https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature'
    +'&timestep=10&starttime='+start+'&maxlocations=1';

  /* S1: weather storedquery bbox d=0.15° (~11km) */
  try{
    var bb1=makeBbox(lat,lng,0.15);
    var xml1=await fetchUrl(BASE+'&storedquery_id=fmi::observations::weather::timevaluepair&bbox='+bb1+'&parameters='+params);
    var s1=parseHistory(xml1);
    if(s1.windspeedms&&s1.windspeedms.length){console.log('[maritime] S1 weather bbox OK');return xml1;}
    console.log('[maritime] S1 empty');
  }catch(e){console.log('[maritime] S1 error:',e.message);}

  /* S2: maritime storedquery bbox d=0.15° */
  try{
    var bb2=makeBbox(lat,lng,0.15);
    var xml2=await fetchUrl(BASE+'&storedquery_id=fmi::observations::maritime::simple&bbox='+bb2+'&parameters=WindSpeedMS,WindGust,WindDirection');
    var s2=parseHistory(xml2);
    if(s2.windspeedms&&s2.windspeedms.length){console.log('[maritime] S2 maritime bbox OK');return xml2;}
    console.log('[maritime] S2 empty, xml len='+xml2.length);
  }catch(e){console.log('[maritime] S2 error:',e.message);}

  /* S3: tunnetut FMISID:t Sipoo Itätoukki / Vuosaari */
  var FMISIDS=['151048','100928','101023','100540'];
  for(var i=0;i<FMISIDS.length;i++){
    try{
      var xml3=await fetchUrl(BASE+'&storedquery_id=fmi::observations::weather::timevaluepair&fmisid='+FMISIDS[i]+'&parameters='+params);
      var s3=parseHistory(xml3);
      if(s3.windspeedms&&s3.windspeedms.length){console.log('[maritime] S3 fmisid='+FMISIDS[i]+' OK');return xml3;}
    }catch(e){}
  }

  console.log('[maritime] ALL STRATEGIES FAILED lat='+lat+' lng='+lng);
  return '';
}

module.exports = async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  var lat=parseFloat(req.query.lat),lng=parseFloat(req.query.lng);
  var placeParam=req.query.place;
  var station;
  if(placeParam){
    station=STATIONS.find(function(s){return s.place===placeParam;});
    if(!station&&!isNaN(lat)&&!isNaN(lng))station=nearest(lat,lng);
    if(!station)station=STATIONS[0];
  }else if(!isNaN(lat)&&!isNaN(lng)){
    station=nearest(lat,lng);
  }else{
    station=STATIONS[0];
  }

  var isHistory=req.query.history==='1';
  var start=isHistory
    ?new Date(Date.now()-24*3600000).toISOString().slice(0,16)+'Z'
    :new Date(Date.now()-60*60000).toISOString().slice(0,16)+'Z';

  if(isHistory)res.setHeader('Cache-Control','public, s-maxage=600, stale-while-revalidate=120');
  else res.setHeader('Cache-Control','public, s-maxage=300, stale-while-revalidate=60');

  try{
    var xml=station.type==='maritime'
      ?await fetchMaritime(station.lat,station.lng,isHistory?'WindSpeedMS,WindGust':'WindSpeedMS,WindDirection,WindGust,Temperature,DewPoint',start)
      :await fetchWeather(station.place,isHistory?'WindSpeedMS,WindGust':'WindSpeedMS,WindDirection,WindGust,Temperature,DewPoint',start);

    if(isHistory){
      var series=parseHistory(xml);
      var ws=series['windspeedms']||[];
      var wg=series['windgust']||[];
      if(!ws.length)return res.status(200).json({error:'no data',station:station.name,place:station.place,ws:[],wg:[]});
      return res.status(200).json({
        station:station.name,place:station.place,
        ws:ws.map(function(p){return{t:toFiTime(p.t),v:p.v};}),
        wg:wg.map(function(p){return{t:toFiTime(p.t),v:p.v};}),
      });
    }else{
      var d=parseLatest(xml);
      var ws2=d['windspeedms']||null,wd=d['winddirection']||null,wg2=d['windgust']||null;
      var t=d['temperature']||null,dp=d['dewpoint']||null;
      if(!ws2)return res.status(200).json({error:'no data',station:station.name,place:station.place});
      return res.status(200).json({
        station:station.name,place:station.place,
        ws:ws2.v,wd:wd?wd.v:null,wg:wg2?wg2.v:null,
        tmp:t?t.v:null,dew:dp?dp.v:null,
        time:toFiTime(ws2.t),
      });
    }
  }catch(err){return res.status(500).json({error:err.message});}
};
