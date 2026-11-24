// Cidade online v3: senha, missões com moedas e pedidos de resgate (pago manualmente pelo organizador)
// Rodar: npm install && ADMIN_KEY=uma-chave-longa node server.js
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),{WebSocketServer}=require('ws');
const PORT=process.env.PORT||3000,PER=63,DB=process.env.DB_FILE||'data.json',ADMIN=process.env.ADMIN_KEY||'';
const COIN_BRL=+process.env.COIN_BRL||0.01,MIN_OUT=+process.env.MIN_PAYOUT_COINS||1000; // 1000 moedas = R$ 10,00 por padrão
let db={players:{},prog:{},req:[]};try{Object.assign(db,JSON.parse(fs.readFileSync(DB,'utf8')))}catch{}
const save=()=>fs.writeFile(DB,JSON.stringify(db),()=>{});
const online=new Map(),city=hi=>Math.floor(hi/PER),out=(w,o)=>w.readyState===1&&w.send(JSON.stringify(o));
const toCity=(c,o)=>{for(const [w,q] of online)if(city(q.hi)===c)out(w,o)};
const esc=s=>String(s).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),hash=(pw,salt)=>crypto.scryptSync(pw,salt,32).toString('hex');
// casas (mesma ordem do cliente) para detectar visitas no servidor
const fronts=[];for(let bi=0;bi<4;bi++)for(let bj=0;bj<4;bj++)for(const [a,b] of [[1.3,1.3],[3.7,1.3],[1.3,3.7],[3.7,3.7]]){if(bi===3&&bj===3&&a>3&&b>3)continue;fronts.push({x:bi*5+a+(a<2.5?-.85:.85),z:bj*5+b})}
const co=new Map(),addOwner=(h,hi)=>{const c=city(hi);if(!co.has(c))co.set(c,[]);co.get(c).push(h)};
for(const [h,r] of Object.entries(db.players))addOwner(h,r.hi);
const MIS=[{id:'emoji',t:'Mande emoji ou campainha a 5 pessoas diferentes',n:5,r:20},{id:'visit',t:'Visite 3 casas diferentes',n:3,r:30},{id:'say',t:'Converse: envie 5 mensagens',n:5,r:15},{id:'give',t:'Doe 1 ponto ao hospital',n:1,r:25},{id:'rec',t:'Grave um vídeo de 10 segundos',n:1,r:40}];
const MAX_DEV=+process.env.MAX_ACCOUNTS_PER_DEVICE||10,MAX_IP_NEW=+process.env.MAX_NEW_ACCOUNTS_PER_IP_DAY||5,MAX_OUT=+process.env.MAX_PAYOUT_COINS||5000,MIN_AGE_H=+process.env.MIN_ACCOUNT_AGE_HOURS||24,ipNew=new Map();
const today=()=>new Date().toISOString().slice(0,10);
const daily=r=>r.m&&r.m.day===today()?r.m:(r.m={day:today(),p:{},done:{},seen:[]});
const push=(ws,r)=>{const m=daily(r);out(ws,{t:'mis',coins:r.coins||0,list:MIS.map(d=>({t:d.t,n:d.n,r:d.r,p:Math.min(d.n,m.p[d.id]||0),done:!!m.done[d.id]}))})};
function mis(ws,r,id){const m=daily(r),d=MIS.find(x=>x.id===id);if(m.done[id])return;m.p[id]=(m.p[id]||0)+1;if(m.p[id]>=d.n){m.done[id]=1;r.coins=(r.coins||0)+d.r}save();push(ws,r)}

const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://x');
 if(u.pathname.startsWith('/admin')){
  if(!ADMIN||u.searchParams.get('key')!==ADMIN){res.statusCode=403;return res.end('negado')}
  if(u.pathname==='/admin/pay'){const r=db.req.find(x=>x.id===u.searchParams.get('id'));if(r){r.paid=true;save()}res.writeHead(302,{location:'/admin?key='+encodeURIComponent(ADMIN)});return res.end()}
  res.setHeader('content-type','text/html; charset=utf-8');
  return res.end('<meta name=viewport content="width=device-width"><h2>Pedidos de resgate</h2>'+db.req.slice().reverse().map(r=>'<p>'+(r.paid?'✅':'⏳')+' <b>'+esc(r.n)+'</b> · R$ '+r.brl.toFixed(2)+' · Pix: '+esc(r.pix)+(r.dup?' ⚠️ repetido':'')+' · conta '+r.age+'h, '+r.devN+' no aparelho · '+new Date(r.t).toLocaleString('pt-BR')+(r.paid?'':' · <a href="/admin/pay?key='+encodeURIComponent(ADMIN)+'&id='+r.id+'">marcar como pago</a>')+'</p>').join(''))}
 fs.readFile(['index.html','public/index.html'].map(f=>path.join(__dirname,f)).find(f=>fs.existsSync(f)),(e,d)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end(d)})});
const wss=new WebSocketServer({server});
wss.on('connection',(ws,req)=>{const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',')[0].trim();
 let P=null,last=0,fails=0,t0=0;
 ws.on('message',raw=>{
  let m;try{m=JSON.parse(raw)}catch{return}
  if(m.t==='join'&&!P){
   const name=String(m.name||'').trim().replace(/\s+/g,' ').slice(0,20),key=name.toLowerCase(),pw=String(m.pass||'');
   if(!name||['__proto__','constructor','prototype'].includes(key))return out(ws,{t:'err',msg:'Digite um nome'});
   if(pw.length<4||pw.length>64)return out(ws,{t:'err',msg:'A senha precisa ter de 4 a 64 caracteres'});
   if([...online.values()].some(p=>p.h===key))return out(ws,{t:'err',msg:'Esse nome já está online agora'});
   let rec=db.players[key];
   if(rec){if(!crypto.timingSafeEqual(Buffer.from(hash(pw,rec.salt),'hex'),Buffer.from(rec.ph,'hex'))){if(++fails>=5)ws.close();return out(ws,{t:'err',msg:'Senha errada'})}}
   else{const dev=String(m.dev||'').slice(0,64),k=ip+today();
    if(dev.length<8)return out(ws,{t:'err',msg:'Atualize a página e tente de novo'});
    if(Object.values(db.players).filter(r=>r.dev===dev).length>=MAX_DEV)return out(ws,{t:'err',msg:'Limite de contas neste aparelho'});
    if((ipNew.get(k)||0)>=MAX_IP_NEW)return out(ws,{t:'err',msg:'Muitas contas criadas hoje nesta rede. Tente amanhã'});
    if(ipNew.size>1e5)ipNew.clear();ipNew.set(k,(ipNew.get(k)||0)+1);
    const used=new Set(Object.values(db.players).map(p=>p.hi));let hi=0;while(used.has(hi))hi++;const salt=crypto.randomBytes(8).toString('hex');
    rec=db.players[key]={n:name,hi,pts:3,coins:0,c:0,salt,ph:hash(pw,salt),created:Date.now(),dev,ip};addOwner(key,hi)}
   if(Number.isInteger(m.c)&&m.c>=0&&m.c<8)rec.c=m.c;save();
   P={h:key,hi:rec.hi,x:0,z:0,hx:1,hz:0,ready:false};online.set(ws,P);
   out(ws,{t:'hello',h:key,n:rec.n,c:rec.c,hi:rec.hi,pts:rec.pts,cfg:{brl:COIN_BRL,min:MIN_OUT}});return push(ws,rec)}
  if(!P)return;const rec=db.players[P.h],c=city(P.hi);
  if(m.t==='pos'){const nx=+m.x||0,nz=+m.z||0,now=Date.now();
   if(P.ready&&Math.hypot(nx-P.x,nz-P.z)>4*(now-P.tt)/1000+1.5)return out(ws,{t:'snap',x:P.x,z:P.z}); // teletransporte = ignorado
   P.x=nx;P.z=nz;P.tt=now;P.hx=+m.hx||0;P.hz=+m.hz||0;P.ready=true;const d=daily(rec);
   for(const h of co.get(c)||[]){if(h===P.h||d.seen.includes(h))continue;const f=fronts[db.players[h].hi%PER];if(Math.hypot(P.x-f.x,P.z-f.z)<1.3){d.seen.push(h);mis(ws,rec,'visit')}}}
  else if(m.t==='say'&&Date.now()-last>400){last=Date.now();const text=String(m.text||'').slice(0,60);if(text){toCity(c,{t:'say',from:P.h,text});if(text!==rec.ls){rec.ls=text;mis(ws,rec,'say')}}}
  else if((m.t==='emoji'||m.t==='bell')&&typeof m.to==='string'&&db.players[m.to]&&m.to!==P.h&&Date.now()-last>1000){
   last=Date.now();rec.pts+=.1;out(ws,{t:'pts',pts:rec.pts});toCity(c,{t:'fx',k:m.t,from:P.h,to:m.to});const d=daily(rec);d.te=d.te||[];if(!d.te.includes(m.to)){d.te.push(m.to);mis(ws,rec,'emoji')}}
  else if(m.t==='give'&&rec.pts>=1&&(db.prog[c]||0)<10){rec.pts-=1;db.prog[c]=(db.prog[c]||0)+1;out(ws,{t:'pts',pts:rec.pts});mis(ws,rec,'give')}
  else if(m.t==='recstart')t0=Date.now();
  else if(m.t==='recstop'&&t0&&Date.now()-t0>=9500){t0=0;mis(ws,rec,'rec')}
  else if(m.t==='redeem'){const pix=String(m.pix||'').trim().slice(0,80),e2=msg=>out(ws,{t:'err2',msg}),
   age=Math.floor((Date.now()-(rec.created||0))/36e5),busy=db.req.some(r=>r.h===P.h&&(!r.paid||Date.now()-r.t<864e5));
   if((rec.coins||0)<MIN_OUT||pix.length<5)return e2('Faltam moedas ou a chave Pix é inválida');
   if(age<MIN_AGE_H)return e2('Sua conta precisa ter '+MIN_AGE_H+' h para resgatar');
   if(busy)return e2('Você já pediu um resgate nas últimas 24 h');
   const coins=Math.min(rec.coins,MAX_OUT),brl=coins*COIN_BRL;
   db.req.push({id:crypto.randomUUID(),h:P.h,n:rec.n,pix,coins,brl,age,t:Date.now(),paid:false,
    devN:Object.values(db.players).filter(r=>r.dev&&r.dev===rec.dev).length,dup:db.req.some(r=>r.pix===pix&&r.h!==P.h)});
   rec.coins-=coins;save();push(ws,rec);e2('Pedido enviado! R$ '+brl.toFixed(2)+' serão pagos pelo organizador.')}});
 ws.on('close',()=>online.delete(ws))});
setInterval(()=>{
 const byH=new Map([...online.values()].map(p=>[p.h,p]));
 for(const c of new Set([...online.values()].map(p=>city(p.hi)))){
  const all=(co.get(c)||[]).map(h=>{const r=db.players[h],o=byH.get(h),on=!!o&&o.ready;return{h,n:r.n,c:r.c,hi:r.hi%PER,on,x:on?o.x:0,z:on?o.z:0,hx:on?o.hx:0,hz:on?o.hz:0}});
  toCity(c,{t:'state',all,prog:db.prog[c]||0})}},100);
server.listen(PORT,()=>console.log('http://localhost:'+PORT));
