"""
板上的小 HTTP 服务 —— 手机打开就是控制台。

存在的理由很实在：板子只有一路 HDMI，已经给了投影仪，
所以控制界面没有别的地方可去。

  /              控制页（标定四角、切场景、看状态）
  /preview.jpg   当前相机帧 + 识别叠加（调试用）
  /stream.mjpg   桌面画面推流（对端拿这个看你桌上在干嘛）
  /state         JSON 状态
  /config        POST 配置
"""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np

PAGE = """<!doctype html><html><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,user-scalable=no">
<title>BySide 控制台</title><style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:#14171b;color:#c3c9d2;font:15px -apple-system,system-ui,sans-serif}
.wrap{max-width:640px;margin:0 auto;padding:14px}
h1{font-size:17px;color:#f0f1f3;margin:4px 0 12px;font-weight:600}
.card{background:#1c2026;border:1px solid #2e343c;border-radius:10px;padding:14px;margin-bottom:12px}
.lbl{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#6a7380;margin-bottom:9px}
#stage{position:relative;width:100%;background:#000;border-radius:8px;overflow:hidden;touch-action:none}
#pv{display:block;width:100%}
.h{position:absolute;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;
   border:2px solid #e5a947;background:rgba(229,169,71,.18);touch-action:none}
.h.on{background:rgba(229,169,71,.5)}
.h i{position:absolute;left:50%;top:50%;width:2px;height:14px;margin:-7px 0 0 -1px;background:#e5a947}
.h i.b{width:14px;height:2px;margin:-1px 0 0 -7px}
.h b{position:absolute;left:50%;top:-19px;transform:translateX(-50%);font:10px monospace;color:#e5a947}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
button{flex:1;min-width:88px;padding:12px 10px;border-radius:8px;border:1px solid #2e343c;
  background:#22272e;color:#f0f1f3;font-size:14px}
button.on{background:#e5a947;color:#14171b;border-color:#e5a947;font-weight:600}
button:active{opacity:.6}
.st{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:13px}
.st div span{color:#6a7380;display:block;font-size:11px}
.st b{color:#f0f1f3;font-weight:500;font-variant-numeric:tabular-nums}
.ok{color:#7fd1a8}.bad{color:#e0705a}
</style></head><body><div class=wrap>
<h1>BySide 控制台</h1>

<div class=card><div class=lbl>标定 · 把四个角拖到投影出来的靶心</div>
<div id=stage><img id=pv src="/preview.jpg"></div>
<div class=row>
  <button onclick="mode('calib')" id=bc>显示标定图</button>
  <button onclick="mode('play')" id=bp>开始游戏</button>
  <button onclick="save()">保存标定</button>
</div></div>

<div class=card><div class=lbl>投影方框 · 投不全就调这里</div>
<div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;margin-bottom:10px">
  <span style="font-size:12px;color:#6a7380">大小</span>
  <input type=range id=mg min=2 max=42 step=1 oninput="setMargin(this.value)">
  <span id=mgv style="font-family:monospace;font-size:12px;min-width:34px;text-align:right">—</span>
</div>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-width:220px;margin:0 auto">
  <span></span><button onclick="nudge(0,-1)">↑</button><span></span>
  <button onclick="nudge(-1,0)">←</button><button onclick="nudge(0,0)">居中</button><button onclick="nudge(1,0)">→</button>
  <span></span><button onclick="nudge(0,1)">↓</button><span></span>
</div></div>

<div class=card><div class=lbl>场景</div><div class=row>
  <button onclick="scene('gomoku')" id=sg>下棋</button>
  <button onclick="scene('draw')" id=sd>画画</button>
</div></div>

<div class=card><div class=lbl>状态</div><div class=st id=stat></div></div>

<div class=card><div class=lbl>对方桌面</div>
<img id=rv style="width:100%;border-radius:8px;background:#000" src="">
<div class=row><button onclick="toggleRemote()" id=br>连接对端画面</button></div></div>

</div><script>
let Q=[[.2,.2],[.8,.2],[.8,.8],[.2,.8]],drag=-1,st={};
const stage=document.getElementById('stage'),pv=document.getElementById('pv');
function mk(){for(let k=0;k<4;k++){const d=document.createElement('div');d.className='h';d.dataset.k=k;
 d.innerHTML='<i></i><i class=b></i><b>'+(k+1)+'</b>';stage.appendChild(d);}pos();}
function pos(){[...stage.querySelectorAll('.h')].forEach((d,k)=>{
 d.style.left=(Q[k][0]*pv.clientWidth)+'px';d.style.top=(Q[k][1]*pv.clientHeight)+'px';});}
function xy(e){const r=pv.getBoundingClientRect();const t=e.touches?e.touches[0]:e;
 return [Math.max(0,Math.min(1,(t.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(t.clientY-r.top)/r.height))];}
function down(e){const t=e.target.closest('.h');if(!t)return;drag=+t.dataset.k;t.classList.add('on');e.preventDefault();}
function move(e){if(drag<0)return;Q[drag]=xy(e);pos();e.preventDefault();}
function up(){if(drag>=0){stage.querySelectorAll('.h').forEach(d=>d.classList.remove('on'));
 fetch('/config',{method:'POST',body:JSON.stringify({quad:Q})});}drag=-1;}
stage.addEventListener('touchstart',down,{passive:false});
stage.addEventListener('touchmove',move,{passive:false});
stage.addEventListener('touchend',up);
stage.addEventListener('mousedown',down);window.addEventListener('mousemove',move);window.addEventListener('mouseup',up);
function setMargin(v){document.getElementById('mgv').textContent=(v/100).toFixed(2);
 fetch('/config',{method:'POST',body:JSON.stringify({margin:v/100})});}
function nudge(dx,dy){const o=(dx||dy)?[(st.offset?st.offset[0]:0)+dx*0.01,(st.offset?st.offset[1]:0)+dy*0.01]:[0,0];
 st.offset=o;fetch('/config',{method:'POST',body:JSON.stringify({offset:o})});}
function mode(m){fetch('/config',{method:'POST',body:JSON.stringify({mode:m})});}
function scene(s){fetch('/config',{method:'POST',body:JSON.stringify({scene:s})});}
function save(){fetch('/config',{method:'POST',body:JSON.stringify({save:1})}).then(()=>alert('已保存'));}
let remoteOn=false;
function toggleRemote(){remoteOn=!remoteOn;
 document.getElementById('rv').src=remoteOn?(st.peer||'')+'/stream.mjpg':'';
 document.getElementById('br').classList.toggle('on',remoteOn);}
function tick(){
 pv.src='/preview.jpg?t='+Date.now();
 fetch('/state').then(r=>r.json()).then(s=>{st=s;
  if(!drag&&s.quad){Q=s.quad;pos();}
  const mg=document.getElementById('mg');
  if(document.activeElement!==mg&&s.margin!=null){mg.value=Math.round(s.margin*100);
   document.getElementById('mgv').textContent=s.margin.toFixed(2);}
  document.getElementById('bc').classList.toggle('on',s.mode=='calib');
  document.getElementById('bp').classList.toggle('on',s.mode=='play');
  document.getElementById('sg').classList.toggle('on',s.scene=='gomoku');
  document.getElementById('sd').classList.toggle('on',s.scene=='draw');
  document.getElementById('stat').innerHTML=
   '<div><span>相机</span><b class="'+(s.fps>5?'ok':'bad')+'">'+s.fps.toFixed(1)+' fps</b></div>'+
   '<div><span>识别耗时</span><b>'+s.ms.toFixed(0)+' ms</b></div>'+
   '<div><span>桌上棋子</span><b>'+s.stones+'</b></div>'+
   '<div><span>遮挡</span><b class="'+(s.occluded?'bad':'ok')+'">'+(s.occluded?'有手':'无')+'</b></div>'+
   '<div><span>格距</span><b>'+s.cell.toFixed(1)+' px</b></div>'+
   '<div><span>温度</span><b>'+s.temp+' °C</b></div>';
 }).catch(()=>{});
}
mk();window.addEventListener('resize',pos);pv.onload=pos;setInterval(tick,700);tick();
</script></body></html>"""


class _H(BaseHTTPRequestHandler):
    app = None
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, ctype, body, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        a = self.app
        path = self.path.split("?")[0]
        if path == "/":
            self._send(200, "text/html; charset=utf-8", PAGE.encode())
        elif path == "/preview.jpg":
            jpg = a.preview_jpeg()
            self._send(200, "image/jpeg", jpg) if jpg else self._send(503, "text/plain", b"no frame")
        elif path == "/state":
            self._send(200, "application/json", json.dumps(a.state_dict()).encode())
        elif path == "/stream.mjpg":
            self._stream(a)
        else:
            self._send(404, "text/plain", b"404")

    def _stream(self, a):
        """给对端看桌面用的 MJPEG 流。分辨率和帧率都压低——
        识别优先，视频随时可以降级，它掉了不影响下棋画画。"""
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=f")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        try:
            while True:
                jpg = a.stream_jpeg()
                if jpg:
                    self.wfile.write(b"--f\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                     + str(len(jpg)).encode() + b"\r\n\r\n" + jpg + b"\r\n")
                time.sleep(1.0 / a.stream_fps)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        try:
            cfg = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            cfg = {}
        self.app.apply_config(cfg)
        self._send(200, "application/json", b'{"ok":1}')


def serve(app, port=8080):
    _H.app = app
    srv = ThreadingHTTPServer(("0.0.0.0", port), _H)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv
