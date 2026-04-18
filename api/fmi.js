const https = require('https');

const STATIONS = [
  { place: 'kaisaniemi', name: 'Helsinki Kaisaniemi',      lat: 60.17523, lng: 24.94459, type: 'weather', fmisid: null },
  { place: 'kumpula',    name: 'Helsinki Kumpula',         lat: 60.20307, lng: 24.96131, type: 'weather', fmisid: null },
  { place: 'harmaja',    name: 'Helsinki Harmaja',         lat: 60.10512, lng: 24.97539, type: 'weather', fmisid: null },
  { place: 'tapiola',    name: 'Espoo Tapiola',            lat: 60.17510, lng: 24.80590, type: 'weather', fmisid: null },
  { place: 'malmi',      name: 'Helsinki Malmi',           lat: 60.25299, lng: 25.04549, type: 'weather', fmisid: null },
  { place: 'vantaa',     name: 'Vantaa Helsinki-Vantaa',   lat: 60.31700, lng: 24.96300, type: 'weather', fmisid: null },
  /* Vuosaari satama — fmisid haetaan bbox:lla */
  { place: 'vuosaari',   name: 'Helsinki Vuosaari satama', lat: 60.20900, lng: 25.19660, type: 'maritime', fmisid: null },
  /* Sipoo Itätoukki — FMISID 105392 (vahvistettu 18.4.2026: ws=4.1 wg=4.4) */
  { place: 'sipoo',      name: 'Sipoo Itätoukki',          lat: 60.15806, lng: 25.32611, type: 'fmisid',   fmisid: '105392' },
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

/* Maritime-asema: käytä fmisid suoraan jos tiedossa, muuten bbox */
async function fetchMaritime(lat,lng,params,start,fmisid){
  var BASE='https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature'
    +'&storedquery_id=fmi::observations::weather::timevaluepair'
    +'&timestep=10&starttime='+start;

  /* S1: suora FMISID-haku jos asemalla on tunnettu ID */
  if(fmisid){
    try{
      var xml1=await fetchUrl(BASE+'&fmisid='+fmisid+'&parameters='+params);
      var s1=parseHistory(xml1);
      if(s1.windspeedms&&s1.windspeedms.length){
        console.log('[maritime] S1 fmisid='+fmisid+' OK, n='+s1.windspeedms.length);
        return xml1;
      }
      console.log('[maritime] S1 fmisid='+fmisid+' empty');
    }catch(e){console.log('[maritime] S1 error:',e.message);}
  }

  /* S2: weather bbox — pieni säde jotta ei osu väärään asemaan */
  try{
    var bb=makeBbox(lat,lng,0.08);
    var xml2=await fetchUrl(BASE+'&bbox='+bb+'&parameters='+params+'&maxlocations=1');
    var s2=parseHistory(xml2);
    if(s2.windspeedms&&s2.windspeedms.length){
      console.log('[maritime] S2 weather bbox OK, n='+s2.windspeedms.length);
      return xml2;
    }
    console.log('[maritime] S2 bbox empty');
  }catch(e){console.log('[maritime] S2 error:',e.message);}

  console.log('[maritime] ALL FAILED lat='+lat+' lng='+lng+' fmisid='+fmisid);
  return '';
}

module.exports = async function handler(req,res){
  /* FINDSTATION: testaa FMISID:t oikealla datalla */
  if(req.query.findstation==='1'){
    res.setHeader('Access-Control-Allow-Origin','*');
    var target_ws=parseFloat(req.query.ws||'4.1');
    var target_date=req.query.date||'2026-04-18';
    var startT=target_date+'T07:00:00Z', endT=target_date+'T08:30:00Z';
    var BASE2='https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature'
      +'&storedquery_id=fmi::observations::weather::timevaluepair'
      +'&parameters=WindSpeedMS,WindGust&timestep=10&starttime='+startT+'&endtime='+endT;
    function isDst2(d){var mar=new Date(d.getFullYear(),2,31);mar.setDate(31-mar.getDay());var oct=new Date(d.getFullYear(),9,31);oct.setDate(31-oct.getDay());return d>=mar&&d<oct;}
    function toFi2(iso){var d=new Date(iso);d=new Date(d.getTime()+(isDst2(d)?3:2)*3600000);return('0'+d.getUTCHours()).slice(-2)+':'+('0'+d.getUTCMinutes()).slice(-2);}
    var testIds=['151028','151048','100928','101023','105392','100540'];
    var results={date:target_date,target_ws:target_ws,fmisids:{}};
    for(var ii=0;ii<testIds.length;ii++){
      var fid=testIds[ii];
      try{
        var xf=await fetchUrl(BASE2+'&fmisid='+fid);
        var sf=parseHistory(xf);
        var wsArr=(sf.windspeedms||[]).map(function(p){return{t:toFi2(p.t),v:p.v};});
        var wgArr=(sf.windgust||[]).map(function(p){return{t:toFi2(p.t),v:p.v};});
        var ws10=wsArr.find(function(p){return p.t==='10:00';});
        var wg10=wgArr.find(function(p){return p.t==='10:00';});
        results.fmisids[fid]={ws_at_10:ws10?ws10.v:null,wg_at_10:wg10?wg10.v:null,n:wsArr.length,match:ws10&&Math.abs(ws10.v-target_ws)<0.5};
      }catch(e){results.fmisids[fid]={error:e.message};}
    }
    /* Testaa myös place=sipoo */
    try{
      var xp=await fetchUrl(BASE2+'&place=sipoo');
      var sp=parseHistory(xp);
      var wsp=(sp.windspeedms||[]).map(function(p){return{t:toFi2(p.t),v:p.v};});
      var wgp=(sp.windgust||[]).map(function(p){return{t:toFi2(p.t),v:p.v};});
      results.place_sipoo={ws_at_10:wsp.find(function(p){return p.t==='10:00';}),wg_at_10:wgp.find(function(p){return p.t==='10:00';}),n:wsp.length};
    }catch(e){results.place_sipoo={error:e.message};}
    return res.status(200).json(results);
  }

  /* STATIONCOORD: hae aseman koordinaatit FMISID:llä */
  if(req.query.stationcoord==='1'){
    res.setHeader('Access-Control-Allow-Origin','*');
    var fid=req.query.fmisid||'105392';
    var start=new Date(Date.now()-2*3600000).toISOString().slice(0,16)+'Z';
    var url='https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature'
      +'&storedquery_id=fmi::observations::weather::timevaluepair'
      +'&fmisid='+fid+'&parameters=WindSpeedMS&timestep=60&starttime='+start;
    try{
      var xml=await fetchUrl(url);
      /* Koordinaatit ovat gml:pos tai gml:coordinates tagissa */
      var pos=xml.match(/gml:pos[^>]*>([^<]+)/);
      var name=xml.match(/gmd:name>([^<]+)/);
      var fmisidMatch=xml.match(/fmisid[^>]*>(\d+)/);
      return res.status(200).json({
        fmisid:fid,
        name:name?name[1]:null,
        pos:pos?pos[1]:null,
        fmisid_found:fmisidMatch?fmisidMatch[1]:null,
        xml_snippet:xml.slice(0,800)
      });
    }catch(e){return res.status(500).json({error:e.message});}
  }

  /* DEBUG: listaa kaikki asemat alueelta */
  if(req.query.debug==='1'){
    res.setHeader('Access-Control-Allow-Origin','*');
    var dlat=parseFloat(req.query.lat)||60.158, dlng=parseFloat(req.query.lng)||25.326;
    var dd=parseFloat(req.query.d)||0.20;
    var bb=makeBbox(dlat,dlng,dd);
    var start=new Date(Date.now()-2*3600000).toISOString().slice(0,16)+'Z';
    var results={bbox:bb,lat:dlat,lng:dlng,strategies:{}};
    try{
      var x1=await fetchUrl('https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature'
        +'&storedquery_id=fmi::observations::weather::timevaluepair&bbox='+bb
        +'&parameters=WindSpeedMS&timestep=60&starttime='+start+'&maxlocations=5');
      var ids1=[...x1.matchAll(/gml:id="([^"]+)"/g)].map(m=>m[1]).filter(id=>id.includes('obs'));
      results.strategies.weather_bbox={ids:ids1,len:x1.length,hasData:x1.includes('wml2:value')};
    }catch(e){results.strategies.weather_bbox={error:e.message};}
    try{
      var x2=await fetchUrl('https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature'
        +'&storedquery_id=fmi::observations::maritime::simple&bbox='+bb
        +'&parameters=WindSpeedMS&timestep=60&starttime='+start+'&maxlocations=5');
      var ids2=[...x2.matchAll(/gml:id="([^"]+)"/g)].map(m=>m[1]).filter(id=>id.includes('obs'));
      results.strategies.maritime_bbox={ids:ids2,len:x2.length,hasData:x2.includes('wml2:value')};
    }catch(e){results.strategies.maritime_bbox={error:e.message};}
    /* Kokeile eri FMISID:jä */
    var testIds=['151048','100928','101023','100540','100971','101004'];
    results.fmisids={};
    for(var fid of testIds){
      try{
        var xf=await fetchUrl('https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature'
          +'&storedquery_id=fmi::observations::weather::timevaluepair&fmisid='+fid
          +'&parameters=WindSpeedMS&timestep=60&starttime='+start);
        var sf=parseHistory(xf);
        results.fmisids[fid]={hasData:!!(sf.windspeedms&&sf.windspeedms.length),len:xf.length};
      }catch(e){results.fmisids[fid]={error:e.message};}
    }
    return res.status(200).json(results);
  }
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
    var histParams='WindSpeedMS,WindGust';
    var latParams='WindSpeedMS,WindDirection,WindGust,Temperature,DewPoint';
    var params=isHistory?histParams:latParams;
    var xml;
    if(station.type==='fmisid'&&station.fmisid){
      /* Suora FMISID-haku — varmin tapa tunnetuille asemille */
      var BASE_F='https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature'
        +'&storedquery_id=fmi::observations::weather::timevaluepair'
        +'&fmisid='+station.fmisid+'&parameters='+params+'&timestep=10&starttime='+start;
      xml=await fetchUrl(BASE_F);
    }else if(station.type==='maritime'){
      xml=await fetchMaritime(station.lat,station.lng,params,start,station.fmisid);
    }else{
      xml=await fetchWeather(station.place,params,start);
    }

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
