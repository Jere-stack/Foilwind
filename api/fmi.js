const https = require(‘https’);

/* Kaikki tuetut asemat — weather + maritime */
const STATIONS = [
{ place: ‘kaisaniemi’, name: ‘Helsinki Kaisaniemi’,      lat: 60.17523, lng: 24.94459, fmisid: null,   type: ‘weather’ },
{ place: ‘kumpula’,    name: ‘Helsinki Kumpula’,         lat: 60.20307, lng: 24.96131, fmisid: null,   type: ‘weather’ },
{ place: ‘harmaja’,    name: ‘Helsinki Harmaja’,         lat: 60.10512, lng: 24.97539, fmisid: null,   type: ‘weather’ },
{ place: ‘tapiola’,    name: ‘Espoo Tapiola’,            lat: 60.17510, lng: 24.80590, fmisid: null,   type: ‘weather’ },
{ place: ‘malmi’,      name: ‘Helsinki Malmi’,           lat: 60.25299, lng: 25.04549, fmisid: null,   type: ‘weather’ },
{ place: ‘vantaa’,     name: ‘Vantaa Helsinki-Vantaa’,   lat: 60.31700, lng: 24.96300, fmisid: null,   type: ‘weather’ },
/* Merisääasemat — käyttävät fmisid:tä ja maritime storedquerya */
{ place: ‘vuosaari’,   name: ‘Helsinki Vuosaari satama’, lat: 60.20900, lng: 25.19660, fmisid: ‘100540’, type: ‘maritime’ },
{ place: ‘sipoo’,      name: ‘Sipoo Itätoukki’,          lat: 60.26300, lng: 25.28900, fmisid: ‘101023’, type: ‘maritime’ },
];

function km(a,b,c,d){var R=6371,dL=(c-a)*Math.PI/180,dG=(d-b)*Math.PI/180;return R*2*Math.asin(Math.sqrt(Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dG/2)**2));}

function nearest(lat, lng) {
return STATIONS.slice().sort(function(a,b){ return km(lat,lng,a.lat,a.lng)-km(lat,lng,b.lat,b.lng); })[0];
}

function isDst(d) {
var mar = new Date(d.getFullYear(),2,31); mar.setDate(31-mar.getDay());
var oct = new Date(d.getFullYear(),9,31); oct.setDate(31-oct.getDay());
return d >= mar && d < oct;
}

function toFiTime(iso) {
if (!iso) return ‘’;
var d = new Date(iso);
d = new Date(d.getTime() + (isDst(d)?3:2)*3600000);
return (‘0’+d.getUTCHours()).slice(-2)+’:’+(‘0’+d.getUTCMinutes()).slice(-2);
}

function fetchUrl(url) {
return new Promise(function(resolve, reject) {
https.get(url, function(res) {
var body=’’;
res.on(‘data’,function(c){body+=c;});
res.on(‘error’,reject);
res.on(‘end’,function(){resolve(body);});
}).on(‘error’,reject);
});
}

/* Weather storedquery (maasääasemat) */
function fetchWeather(place, params, starttime) {
var url = ‘https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0’
+’&request=getFeature’
+’&storedquery_id=fmi::observations::weather::timevaluepair’
+’&place=’+encodeURIComponent(place)
+’&parameters=’+params
+’&timestep=10’
+’&starttime=’+starttime;
return fetchUrl(url);
}

/* Maritime storedquery (meriasemat) — käyttää fmisid:tä */
function fetchMaritime(fmisid, params, starttime) {
var url = ‘https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0’
+’&request=getFeature’
+’&storedquery_id=fmi::observations::weather::timevaluepair’
+’&fmisid=’+fmisid
+’&parameters=’+params
+’&timestep=10’
+’&starttime=’+starttime;
return fetchUrl(url);
}

function parseLatest(xml) {
var result={};
var re=/gml:id=”[^”]*-([a-zA-Z]+)”[\s\S]*?(<wml2:point[\s\S]*?</wml2:MeasurementTimeseries>)/g;
var m;
while((m=re.exec(xml))!==null){
var param=m[1].toLowerCase(), block=m[2], pairs=[];
var tvRe=/<wml2:time>([^<]+)</wml2:time>\s*<wml2:value>([^<]+)</wml2:value>/g, tv;
while((tv=tvRe.exec(block))!==null){var v=parseFloat(tv[2]);if(!isNaN(v))pairs.push({t:tv[1],v:v});}
if(pairs.length>0)result[param]=pairs[pairs.length-1];
}
return result;
}

function parseHistory(xml) {
var series={};
var re=/gml:id=”[^”]*-([a-zA-Z]+)”[\s\S]*?(<wml2:point[\s\S]*?</wml2:MeasurementTimeseries>)/g;
var m;
while((m=re.exec(xml))!==null){
var param=m[1].toLowerCase(), block=m[2], points=[];
var tvRe=/<wml2:time>([^<]+)</wml2:time>\s*<wml2:value>([^<]+)</wml2:value>/g, tv;
while((tv=tvRe.exec(block))!==null){var v=parseFloat(tv[2]);if(!isNaN(v))points.push({t:tv[1],v:v});}
series[param]=points;
}
return series;
}

/* Hae XML asemalle — kokeilee weather- tai maritime-querya tyypin mukaan */
function fetchForStation(station, params, starttime) {
if (station.type === ‘maritime’ && station.fmisid) {
return fetchMaritime(station.fmisid, params, starttime);
}
return fetchWeather(station.place, params, starttime);
}

module.exports = async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’,’*’);

var lat=parseFloat(req.query.lat), lng=parseFloat(req.query.lng);
var placeParam=req.query.place;
var station;
if(placeParam){
station=STATIONS.find(function(s){return s.place===placeParam;});
if(!station && !isNaN(lat) && !isNaN(lng)) station=nearest(lat,lng);
if(!station) station=STATIONS[0];
} else if(!isNaN(lat)&&!isNaN(lng)){
station=nearest(lat,lng);
} else {
station=STATIONS[0];
}

if(req.query.history===‘1’){
res.setHeader(‘Cache-Control’,‘public, s-maxage=600, stale-while-revalidate=120’);
var start=new Date(Date.now()-24*3600000).toISOString().slice(0,16)+‘Z’;
try {
var xml=await fetchForStation(station,‘WindSpeedMS,WindGust’,start);
var series=parseHistory(xml);
var ws=series[‘windspeedms’]||[], wg=series[‘windgust’]||[];
return res.status(200).json({
station:station.name, place:station.place,
ws:ws.map(function(p){return{t:toFiTime(p.t),v:p.v};}),
wg:wg.map(function(p){return{t:toFiTime(p.t),v:p.v};}),
});
} catch(err){return res.status(500).json({error:err.message});}
}

res.setHeader(‘Cache-Control’,‘public, s-maxage=300, stale-while-revalidate=60’);
var start2=new Date(Date.now()-60*60000).toISOString().slice(0,16)+‘Z’;
try {
var xml2=await fetchForStation(station,‘WindSpeedMS,WindDirection,WindGust,Temperature,DewPoint’,start2);
var d=parseLatest(xml2);
var ws2=d[‘windspeedms’]||null, wd=d[‘winddirection’]||null;
var wg2=d[‘windgust’]||null, t=d[‘temperature’]||null, dp=d[‘dewpoint’]||null;
return res.status(200).json({
station:station.name, place:station.place,
ws:ws2?ws2.v:null, wd:wd?wd.v:null, wg:wg2?wg2.v:null,
tmp:t?t.v:null, dew:dp?dp.v:null,
time:ws2?toFiTime(ws2.t):null,
});
} catch(err){return res.status(500).json({error:err.message});}
};