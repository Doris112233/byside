/* ArUco 五子棋 —— 静态服务 + WebSocket 对局同步（零依赖，只用 Node 内置模块）
 *   HTTP  :8778  给本机用（localhost 本身就是安全上下文，摄像头可用）
 *   HTTPS :8443  给局域网另一台机器用（非 localhost 必须 HTTPS 才能开摄像头）
 * 两个监听共用同一个中继，所以两台机器分别走哪个端口进来都在同一局。
 */
'use strict';
const http=require('http'), https=require('https'), fs=require('fs'),
      path=require('path'), crypto=require('crypto'), os=require('os'), zlib=require('zlib');

const ROOT=__dirname;
const HTTP_PORT=+(process.env.HTTP_PORT||8778);
const HTTPS_PORT=+(process.env.HTTPS_PORT||8443);

/* ---------------- 静态文件 ---------------- */
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml',
  '.ico':'image/x-icon','.json':'application/json'};
function serve(req,res){
  let p=decodeURIComponent((req.url||'/').split('?')[0]);
  if(p==='/'||p==='') p='/index.html';
  if(p==='/app'||p==='/app/') p='/app/index.html';
  const file=path.join(ROOT,path.normalize(p).replace(/^(\.\.[/\\])+/,''));
  if(!file.startsWith(ROOT)){ res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file,(err,buf)=>{
    if(err){ res.writeHead(404,{'content-type':'text/plain; charset=utf-8'}).end('not found'); return; }
    res.writeHead(200,{'content-type':MIME[path.extname(file).toLowerCase()]||'application/octet-stream',
                       'cache-control':'no-store'});
    res.end(buf);
  });
}


/* ---------------- 声网 token（AccessToken2 / 007）----------------
   项目开了 App 证书就必须带 token 才能进频道。证书是密钥，只能在服务器上：
   网页进了会话后问中继要 token，中继确认「你确实在这个会话房间里」才签。
   这样拿到 token 的只有这一局的两个人，而证书从头到尾不出服务器。

   签名算法照声网官方参考实现逐字移植（AgoraIO/Tools · AccessToken2.js），
   零依赖。和官方实现在同一 issueTs/salt 下逐字节比对过。
   配置从环境变量或 agora.env 读（agora.env 在 .gitignore 里）。 */
function agoraConfig(){
  const cfg={appId:process.env.AGORA_APP_ID||'', cert:process.env.AGORA_APP_CERT||''};
  if(!cfg.appId||!cfg.cert){
    try{
      for(const line of fs.readFileSync(path.join(ROOT,'agora.env'),'utf8').split('\n')){
        const m=line.match(/^\s*(AGORA_APP_ID|AGORA_APP_CERT)\s*=\s*([0-9a-fA-F]{32})\s*$/);
        if(m){ if(m[1]==='AGORA_APP_ID'&&!cfg.appId) cfg.appId=m[2]; if(m[1]==='AGORA_APP_CERT'&&!cfg.cert) cfg.cert=m[2]; }
      }
    }catch(e){}
  }
  return cfg;
}
const AGORA=agoraConfig();
const le16=n=>{ const b=Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const le32=n=>{ const b=Buffer.alloc(4); b.writeUInt32LE(n>>>0); return b; };
const packBytes=buf=>Buffer.concat([le16(buf.length),buf]);
const packStr=s=>packBytes(Buffer.from(String(s),'utf8'));
const hmac=(key,msg)=>crypto.createHmac('sha256',key).update(msg).digest();

/** 发布者 token：进频道 + 发音频 + 发视频 + 发数据流。expire 是从现在起的秒数。 */
function rtcToken(appId,cert,channel,uid,expire,issueTs,salt){
  issueTs=issueTs||Math.floor(Date.now()/1000);
  salt=salt||Math.floor(Math.random()*99999999)+1;
  const privs=[1,2,3,4];                                   // join / audio / video / data
  const rtc=Buffer.concat([le16(1),                        // service type = RTC
    le16(privs.length), ...privs.flatMap(p=>[le16(p),le32(expire)]),
    packStr(channel), packStr(uid?String(uid):'')]);
  const info=Buffer.concat([packStr(appId),le32(issueTs),le32(expire),le32(salt),le16(1),rtc]);
  let signing=hmac(le32(issueTs),cert);                    // 注意：证书按字符串参与，不是解码后的十六进制
  signing=hmac(le32(salt),signing);
  const sig=hmac(signing,info);
  return '007'+zlib.deflateSync(Buffer.concat([packBytes(sig),info])).toString('base64');
}
const TOKEN_TTL=2*3600;   // 两小时。一起吃饭可能更久，网页会在快过期时来续

/* ---------------- 极简 WebSocket（RFC6455 的够用子集） ---------------- */
const GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/* 房间：每个家庭一个房间，房间之间完全看不见对方。
   以前是一个全局 clients 广播给所有人 —— 演示时被自己的测试标签页干扰过，
   根源就在这里。现在连接必须带 ?room=，不带的进 default，
   但 default 也只是「另一个房间」，不再是「所有人共享一条总线」。 */
const rooms=new Map();
let cid=0;

/* 人和房间是两回事。
   房间  一局游戏的状态同步（落子、折纸步骤），有序号、能重放
   人    好友码。邀请、来电、信令是「找人」，不是「找房间」——
         对方在大厅还是在别的局里，都要能送到。
   一个人可以有多个连接：网页 + 板子。人走进一个会话房间时，他的板子跟着进去，
   这样桌上的投影和识别自动接到这一局。 */
const users=new Map();      // code → Set<conn>
const subs=new Map();       // code → Set<conn>  谁在关心这个人在不在
const meta=new Map();       // code → {name, busy}

/* 消息分两条通路：
   慢通路  落子/悔棋/重开/全量状态 —— 分配序号、存进日志、断线能重放
   快通路  ROI 预览帧、笔迹点流、心跳 —— 转发即忘，丢了就丢了
   画画的笔迹必须走快通路：等不起稳定判定，也不该把每个点都塞进日志。 */
const FAST=new Set(['frame','ink','ping','pong','cursor','point']);
const LOG_MAX=500;

function room(name){
  let r=rooms.get(name);
  if(!r){ r={name, clients:new Set(), seq:0, log:[], snapshot:null}; rooms.set(name,r); }
  return r;
}

function encode(str,op){
  const payload=Buffer.from(str||'','utf8'), len=payload.length;
  let head;
  if(len<126){ head=Buffer.alloc(2); head[1]=len; }
  else if(len<65536){ head=Buffer.alloc(4); head[1]=126; head.writeUInt16BE(len,2); }
  else { head=Buffer.alloc(10); head[1]=127; head.writeBigUInt64BE(BigInt(len),2); }
  head[0]=0x80|(op||0x1);
  return Buffer.concat([head,payload]);
}
function sendTo(c,text){ try{ c.socket.write(encode(text,0x1)); }catch(e){ close(c); } }

function onUpgrade(req,socket){
  const key=req.headers['sec-websocket-key'];
  const u=new URL(req.url||'/', 'http://x');
  if(!key||u.pathname!=='/ws'){ socket.destroy(); return; }
  const accept=crypto.createHash('sha1').update(key+GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\n'+
               'Upgrade: websocket\r\nConnection: Upgrade\r\n'+
               'Sec-WebSocket-Accept: '+accept+'\r\n\r\n');
  socket.setNoDelay(true);

  const code=(u.searchParams.get('user')||'').toUpperCase().replace(/[^0-9A-Z]/g,'').slice(0,12);
  const kind=(u.searchParams.get('kind')==='board')?'board':'web';
  const rname=(u.searchParams.get('room')||(code?'u:'+code:'default')).slice(0,64);
  const since=Math.max(0, +(u.searchParams.get('since')||0) || 0);
  const seat=(u.searchParams.get('seat')||(code?code+(kind==='board'?'#board':''):'?')).slice(0,24);
  const name=(u.searchParams.get('name')||'').slice(0,16);
  const c={socket, id:++cid, alive:true, room:null, seat, code, kind, watching:new Set()};
  if(code){
    if(!users.has(code)) users.set(code,new Set());
    users.get(code).add(c);
    const m=meta.get(code)||{name:'',busy:false};
    if(name) m.name=name;
    meta.set(code,m);
  }
  enter(c, rname, since);
  log('#'+c.id+' 接入 '+(code?code+'('+kind+') ':'')+'房间「'+rname+'」');
  if(code) notifyPresence(code);

  let buf=Buffer.alloc(0), frags=[], fragOp=0;
  socket.on('data',chunk=>{
    buf=Buffer.concat([buf,chunk]);
    for(;;){
      if(buf.length<2) return;
      const fin=(buf[0]&0x80)!==0, op=buf[0]&0x0f, masked=(buf[1]&0x80)!==0;
      let len=buf[1]&0x7f, off=2;
      if(len===126){ if(buf.length<4) return; len=buf.readUInt16BE(2); off=4; }
      else if(len===127){ if(buf.length<10) return; len=Number(buf.readBigUInt64BE(2)); off=10; }
      if(len>1<<20){ close(c); return; }                       // 单帧上限 1MB
      let mask=null;
      if(masked){ if(buf.length<off+4) return; mask=buf.subarray(off,off+4); off+=4; }
      if(buf.length<off+len) return;
      let payload=Buffer.from(buf.subarray(off,off+len));
      if(masked) for(let i=0;i<payload.length;i++) payload[i]^=mask[i%4];
      buf=buf.subarray(off+len);

      if(op===0x8){ close(c); return; }                        // close
      if(op===0x9){ try{socket.write(encode(payload.toString('utf8'),0xA));}catch(e){} continue; }
      if(op===0xA){ c.alive=true; continue; }                  // pong
      if(op===0x0){ frags.push(payload); }                     // 分片续帧
      else { frags=[payload]; fragOp=op; }
      if(!fin) continue;
      const full=Buffer.concat(frags); frags=[];
      if(fragOp===0x1) handle(c, full.toString('utf8'));
    }
  });
  socket.on('error',()=>close(c));
  socket.on('close',()=>close(c));
  /* http 服务器默认 allowHalfOpen —— 对端发 FIN 只触发 end，close 永远不来。
     浏览器会先发关闭帧所以没踩到；但板子、被杀掉的标签页直接断 TCP，
     不接 end 的话对方会一直看到「在线」，要等心跳超时十秒才清掉。 */
  socket.on('end',()=>close(c));
}

/* 进房间：补齐快照和增量。客户端带 since 回来时只补缺的那段；
   补不上（日志太老）就靠快照兜底。 */
function enter(c, rname, since){
  const r=room(rname);
  c.room=r; r.clients.add(c);
  let from=since||0;
  const out=[];
  if(r.snapshot && r.snapshot.seq>from){ out.push(r.snapshot.text); from=r.snapshot.seq; }
  for(const e of r.log) if(e.seq>from) out.push(e.text);
  /* _joined 必须先到：序号是按房间计的，客户端得先知道「换了房间」、
     把自己的 lastSeq 清零，再收重放 —— 顺序反了，旧房间的大序号会
     把新房间的小序号全吞掉，断线重连时就补不回来。 */
  sendTo(c, JSON.stringify({t:'_joined', room:rname, seat:c.seat, head:r.seq,
                            peers:r.clients.size, replayed:out.length}));
  for(const x of out) sendTo(c, x);
  announce(r);
}
function leaveRoom(c){
  const r=c.room; if(!r) return;
  r.clients.delete(c); c.room=null;
  if(r.clients.size===0) r.emptyAt=Date.now(); else announce(r);
}

function presenceOf(code){
  const set=users.get(code)||new Set(), m=meta.get(code)||{};
  let web=false, board=false;
  for(const c of set){ if(c.kind==='board') board=true; else web=true; }
  return {t:'presence', code, online:web, desk:board, name:m.name||'', busy:!!m.busy};
}
function notifyPresence(code){
  const w=subs.get(code); if(!w||!w.size) return;
  const msg=JSON.stringify(presenceOf(code));
  for(const c of w) sendTo(c,msg);
}

function handle(from,text){
  let m=null;
  try{ m=JSON.parse(text); }catch(e){}
  const t=m&&m.t;

  if(t==='ping'){ sendTo(from, '{"t":"pong"}'); return; }

  /* 点名消息：跨房间，按好友码投递给那个人的所有网页连接。
     邀请、接受、挂断、音视频信令、加好友都走这里——它们是找人，不是找房间，
     也不进日志：来电被重放到断线前，就是幽灵来电。 */
  if(m&&m.to&&from.code){
    const to=String(m.to).toUpperCase();
    m.from=from.code; m.name=(meta.get(from.code)||{}).name||m.name||'';
    const out=JSON.stringify(m);
    let n=0;
    for(const c of users.get(to)||[]) if(c.kind==='web'&&c!==from){ sendTo(c,out); n++; }
    if(n===0&&t!=='rtc') sendTo(from, JSON.stringify({t:'_undelivered', to, of:t}));
    return;
  }

  /* 在线订阅：告诉我这些人在不在，之后变了也推给我 */
  if(t==='who'&&Array.isArray(m.codes)){
    for(const raw of m.codes.slice(0,200)){
      const code=String(raw).toUpperCase(); if(!code) continue;
      if(!subs.has(code)) subs.set(code,new Set());
      subs.get(code).add(from); from.watching.add(code);
      sendTo(from, JSON.stringify(presenceOf(code)));
    }
    return;
  }

  if(t==='rtctoken'){
    const ch=String(m.channel||'');
    const inRoom=from.room&&from.room.name===ch&&ch.startsWith('s-');
    if(!AGORA.appId||!AGORA.cert){ sendTo(from,JSON.stringify({t:'rtctoken',channel:ch,error:'no-cert'})); return; }
    if(!inRoom){ sendTo(from,JSON.stringify({t:'rtctoken',channel:ch,error:'not-in-room'})); return; }
    const token=rtcToken(AGORA.appId,AGORA.cert,ch,0,TOKEN_TTL);
    sendTo(from,JSON.stringify({t:'rtctoken',channel:ch,appId:AGORA.appId,token,ttl:TOKEN_TTL}));
    log(from.code+' 领了会话「'+ch+'」的声网 token');
    return;
  }

  if(t==='busy'&&from.code){
    const mm=meta.get(from.code)||{}; mm.busy=!!m.on; meta.set(from.code,mm);
    notifyPresence(from.code); return;
  }
  if(t==='rename'&&from.code&&m.name){
    const mm=meta.get(from.code)||{}; mm.name=String(m.name).slice(0,16); meta.set(from.code,mm);
    notifyPresence(from.code); return;
  }

  /* 换房间。all=true 时这个人的所有连接一起走 —— 网页进了会话，
     桌上的板子跟着进去，投影和识别自动接到这一局。 */
  if(t==='join'&&m.room){
    const target=String(m.room).slice(0,64);
    const movers=(m.all&&from.code)?[...(users.get(from.code)||[])]:[from];
    for(const c of movers){ if(c.room&&c.room.name===target) continue; leaveRoom(c); enter(c,target,0); }
    log(from.code+' → 房间「'+target+'」（'+movers.length+' 个连接）');
    return;
  }

  const r=from.room;

  if(!t || FAST.has(t)){ relay(r, from, text); return; }       // 快通路：转发即忘

  /* 慢通路：分配房间内全局序号。客户端重连时带上 since=最后收到的 seq，
     服务端据此补发 —— 这就是「回合跳动、断线丢子」不再复现的原因。 */
  m.seq=++r.seq;
  const out=JSON.stringify(m);
  r.log.push({seq:m.seq, text:out});
  if(r.log.length>LOG_MAX) r.log.shift();
  if(t==='state'||t==='reset'){ r.snapshot={seq:m.seq, text:out}; r.log.length=0; }
  relay(r, from, out);
}

function relay(r,from,text){
  const frame=encode(text,0x1);
  for(const c of r.clients){
    if(c===from) continue;
    try{ c.socket.write(frame); }catch(e){ close(c); }
  }
}
function announce(r){
  const msg=JSON.stringify({t:'_peers', n:r.clients.size,
                            seats:[...r.clients].map(x=>x.seat)});
  if(!r.clients.size) return;
  for(const c of r.clients) sendTo(c,msg);
}
function close(c){
  if(c.closed) return; c.closed=true;
  const r=c.room;
  try{ c.socket.destroy(); }catch(e){}
  if(r){
    r.clients.delete(c); c.room=null;
    log('#'+c.id+' 离开房间「'+r.name+'」（房内剩 '+r.clients.size+' 人）');
    /* 房间空了但不立刻删 —— 两边都在重连时，状态要还在。十分钟没人再回收。 */
    if(r.clients.size===0) r.emptyAt=Date.now(); else announce(r);
  }
  for(const code of c.watching){ const w=subs.get(code); if(w){ w.delete(c); if(!w.size) subs.delete(code); } }
  if(c.code){
    const set=users.get(c.code);
    if(set){ set.delete(c); if(!set.size){ users.delete(c.code); const mm=meta.get(c.code); if(mm) mm.busy=false; } }
    notifyPresence(c.code);
  }
}
setInterval(()=>{
  const now=Date.now();
  for(const [name,r] of rooms){
    for(const c of r.clients){
      if(!c.alive){ close(c); continue; }
      c.alive=false;
      try{ c.socket.write(encode('',0x9)); }catch(e){ close(c); }
    }
    if(r.clients.size===0 && r.emptyAt && now-r.emptyAt>600000){
      rooms.delete(name); log('房间「'+name+'」空置十分钟，回收');
    }
  }
},5000);

/* ---------------- 启动 ---------------- */
function log(m){ console.log('['+new Date().toTimeString().slice(0,8)+'] '+m); }
function lanIPs(){
  const out=[];
  for(const list of Object.values(os.networkInterfaces()||{}))
    for(const n of list||[]) if(n.family==='IPv4'&&!n.internal) out.push(n.address);
  return out;
}

const httpSrv=http.createServer(serve);
httpSrv.on('upgrade',onUpgrade);
httpSrv.listen(HTTP_PORT,'0.0.0.0',()=>{
  log('HTTP  监听 '+HTTP_PORT);
  log(AGORA.appId&&AGORA.cert?'声网 token 签发已启用（App ID '+AGORA.appId.slice(0,6)+'…）':'未配置声网证书 —— 网页将退回原生 WebRTC');
});
module.exports={rtcToken};

let key,cert;
try{ key=fs.readFileSync(path.join(ROOT,'key.pem')); cert=fs.readFileSync(path.join(ROOT,'cert.pem')); }catch(e){}
if(key&&cert){
  const httpsSrv=https.createServer({key,cert},serve);
  httpsSrv.on('upgrade',onUpgrade);
  httpsSrv.listen(HTTPS_PORT,'0.0.0.0',()=>{
    log('HTTPS 监听 '+HTTPS_PORT);
    for(const ip of lanIPs()) log('  另一台电脑打开： https://'+ip+':'+HTTPS_PORT+'/?seat=white&room=home');
  });
}else{
  log('未找到 key.pem / cert.pem，只启了 HTTP —— 局域网上的另一台机器将无法使用摄像头');
}
