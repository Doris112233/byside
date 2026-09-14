/* ArUco 五子棋 —— 静态服务 + WebSocket 对局同步（零依赖，只用 Node 内置模块）
 *   HTTP  :8778  给本机用（localhost 本身就是安全上下文，摄像头可用）
 *   HTTPS :8443  给局域网另一台机器用（非 localhost 必须 HTTPS 才能开摄像头）
 * 两个监听共用同一个中继，所以两台机器分别走哪个端口进来都在同一局。
 */
'use strict';
const http=require('http'), https=require('https'), fs=require('fs'),
      path=require('path'), crypto=require('crypto'), os=require('os');

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
  const file=path.join(ROOT,path.normalize(p).replace(/^(\.\.[/\\])+/,''));
  if(!file.startsWith(ROOT)){ res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file,(err,buf)=>{
    if(err){ res.writeHead(404,{'content-type':'text/plain; charset=utf-8'}).end('not found'); return; }
    res.writeHead(200,{'content-type':MIME[path.extname(file).toLowerCase()]||'application/octet-stream',
                       'cache-control':'no-store'});
    res.end(buf);
  });
}

/* ---------------- 极简 WebSocket（RFC6455 的够用子集） ---------------- */
const GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/* 房间：每个家庭一个房间，房间之间完全看不见对方。
   以前是一个全局 clients 广播给所有人 —— 演示时被自己的测试标签页干扰过，
   根源就在这里。现在连接必须带 ?room=，不带的进 default，
   但 default 也只是「另一个房间」，不再是「所有人共享一条总线」。 */
const rooms=new Map();
let cid=0;

/* 消息分两条通路：
   慢通路  落子/悔棋/重开/全量状态 —— 分配序号、存进日志、断线能重放
   快通路  ROI 预览帧、笔迹点流、心跳 —— 转发即忘，丢了就丢了
   画画的笔迹必须走快通路：等不起稳定判定，也不该把每个点都塞进日志。 */
const FAST=new Set(['frame','ink','ping','pong','cursor']);
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

  const rname=(u.searchParams.get('room')||'default').slice(0,64);
  const since=Math.max(0, +(u.searchParams.get('since')||0) || 0);
  const seat=(u.searchParams.get('seat')||'?').slice(0,16);
  const r=room(rname);
  const c={socket, id:++cid, alive:true, room:r, seat};
  r.clients.add(c);
  log('#'+c.id+' 接入房间「'+rname+'」seat='+seat+'（房内 '+r.clients.size+' 人，共 '+rooms.size+' 个房间）');

  /* 补齐：先给最近一次全量快照，再给快照之后的增量。
     客户端带 since 回来时只补它缺的那段；补不上（日志太老）就靠快照兜底。
     以前没有这一层，断线重连后两边状态可能永久不一致。 */
  let from=since;
  if(r.snapshot && r.snapshot.seq>from){ sendTo(c, r.snapshot.text); from=r.snapshot.seq; }
  let missed=0;
  for(const e of r.log) if(e.seq>from){ sendTo(c, e.text); missed++; }
  sendTo(c, JSON.stringify({t:'_joined', room:rname, seat, seq:r.seq,
                            peers:r.clients.size, replayed:missed}));
  announce(r);

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
}

function handle(from,text){
  const r=from.room;
  let m=null;
  try{ m=JSON.parse(text); }catch(e){}
  const t=m&&m.t;

  if(t==='ping'){ sendTo(from, '{"t":"pong"}'); }

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
  for(const c of r.clients) sendTo(c,msg);
}
function close(c){
  const r=c.room;
  if(!r||!r.clients.has(c)) return;
  r.clients.delete(c);
  try{ c.socket.destroy(); }catch(e){}
  log('#'+c.id+' 离开房间「'+r.name+'」（房内剩 '+r.clients.size+' 人）');
  if(r.clients.size===0){
    /* 房间空了但不立刻删 —— 两边都在重连时，状态要还在。
       十分钟没人再回收。 */
    r.emptyAt=Date.now();
  }else announce(r);
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
httpSrv.listen(HTTP_PORT,'0.0.0.0',()=>log('HTTP  监听 '+HTTP_PORT));

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
