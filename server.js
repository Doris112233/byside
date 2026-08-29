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
const clients=new Set();
let seq=0;

function encode(str,op){
  const payload=Buffer.from(str||'','utf8'), len=payload.length;
  let head;
  if(len<126){ head=Buffer.alloc(2); head[1]=len; }
  else if(len<65536){ head=Buffer.alloc(4); head[1]=126; head.writeUInt16BE(len,2); }
  else { head=Buffer.alloc(10); head[1]=127; head.writeBigUInt64BE(BigInt(len),2); }
  head[0]=0x80|(op||0x1);
  return Buffer.concat([head,payload]);
}

function onUpgrade(req,socket){
  const key=req.headers['sec-websocket-key'];
  if(!key||(req.url||'').split('?')[0]!=='/ws'){ socket.destroy(); return; }
  const accept=crypto.createHash('sha1').update(key+GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\n'+
               'Upgrade: websocket\r\nConnection: Upgrade\r\n'+
               'Sec-WebSocket-Accept: '+accept+'\r\n\r\n');
  socket.setNoDelay(true);

  const c={socket, id:++seq, alive:true};
  clients.add(c);
  log('客户端 #'+c.id+' 接入（当前 '+clients.size+' 个）');

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
      if(op===0x9){ try{socket.write(encode(payload.toString('utf8'),0xA));}catch(e){} continue; }  // ping→pong
      if(op===0xA){ c.alive=true; continue; }                  // pong
      if(op===0x0){ frags.push(payload); }                     // 分片续帧
      else { frags=[payload]; fragOp=op; }
      if(!fin) continue;
      const full=Buffer.concat(frags); frags=[];
      if(fragOp===0x1) relay(c, full.toString('utf8'));
    }
  });
  socket.on('error',()=>close(c));
  socket.on('close',()=>close(c));
}
function close(c){
  if(!clients.has(c)) return;
  clients.delete(c);
  try{ c.socket.destroy(); }catch(e){}
  log('客户端 #'+c.id+' 断开（剩 '+clients.size+' 个）');
}
/** 中继：转发给除自己以外的所有客户端 */
function relay(from,text){
  const frame=encode(text,0x1);
  for(const c of clients){
    if(c===from) continue;
    try{ c.socket.write(frame); }catch(e){ close(c); }
  }
}
// 心跳，清理掉线的连接
setInterval(()=>{
  for(const c of clients){
    if(!c.alive){ close(c); continue; }
    c.alive=false;
    try{ c.socket.write(encode('',0x9)); }catch(e){ close(c); }
  }
},20000);

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
    for(const ip of lanIPs()) log('  另一台电脑打开： https://'+ip+':'+HTTPS_PORT+'/?seat=white');
  });
}else{
  log('未找到 key.pem / cert.pem，只启了 HTTP —— 局域网上的另一台机器将无法使用摄像头');
}
