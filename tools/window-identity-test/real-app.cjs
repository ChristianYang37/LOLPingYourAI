// Manual real-app integration harness: only bound, disposable windows may be acted on.
const {app,BrowserWindow}=require('electron');
const {spawn}=require('node:child_process');
const fs=require('node:fs'), path=require('node:path'), http=require('node:http');
const root=path.resolve(__dirname,'../..'), dir=path.join(root,'.local/real-app-test');
fs.mkdirSync(dir,{recursive:true,mode:0o700});
const bound=new Map(); let busy=false, controller;
function native(op,args={}) { return new Promise((resolve,reject)=>{
 const p=spawn(path.join(root,'native/desktop/build/desktop-helper'),[op],{stdio:['pipe','pipe','pipe']}); let out='';
 const timer=setTimeout(()=>p.kill(),12000); p.stdout.on('data',d=>out+=d);p.on('error',reject);
 p.on('close',()=>{clearTimeout(timer);try{const r=JSON.parse(out);r.error?reject(Error(r.error)):resolve(r)}catch(e){reject(e)}});p.stdin.end(JSON.stringify(args));
}) }
async function execute(job) {
 if(job.op==='bind') { const w=await native('resolve',job.args); if(!['Safari','Safari浏览器','Google Chrome','TextEdit','文本编辑'].includes(w.app))throw Error('Unsupported test app'); bound.set(w.id,w);return w; }
 if(['doctor','windows','target'].includes(job.op))return native(job.op,job.args);
 if(!bound.has(job.args?.id))throw Error('Bind the disposable test window first');
 return native(job.op,job.args);
}
app.whenReady().then(async()=>{
 controller=new BrowserWindow({width:640,height:200,show:false});
 await controller.loadURL('data:text/html,<h2>LOLPing real-app test host</h2><p>Disposable windows only. Close this window to stop the host.</p>');
 const server=http.createServer((req,res)=>{
  if(req.method==='POST'&&req.url==='/events'){let text='';req.on('data',d=>{text+=d;if(text.length>20000)req.destroy()});req.on('end',()=>{try{const event=JSON.parse(text);fs.appendFileSync(path.join(dir,'events.jsonl'),JSON.stringify({at:Date.now(),...event})+'\n')}catch{}res.end('ok')});return}
  const label=decodeURIComponent(req.url.slice(1)); if(!/^[A-Z][A-Z0-9-]{0,20}$/.test(label)){res.writeHead(404);res.end();return}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<title>LOLPing real-app test</title><style>body{font:22px sans-serif;padding:30px}textarea{width:85%;height:180px;font-size:24px}</style><h1>Disposable test ${label}</h1><textarea autofocus>${label}</textarea><p><button onclick="alert('Disposable modal ${label}')">Open test dialog</button></p><script>const t=document.querySelector('textarea');function emit(){fetch('/events',{method:'POST',body:JSON.stringify({label:'${label}',value:t.value})})}t.addEventListener('input',emit);emit();</script>`);
 });server.listen(8766,'127.0.0.1');
 fs.writeFileSync(path.join(dir,'doctor.json'),JSON.stringify(await native('doctor')));
 setInterval(async()=>{const file=path.join(dir,'job.json');if(busy||!fs.existsSync(file))return;busy=true;let job;try{job=JSON.parse(fs.readFileSync(file));fs.unlinkSync(file);const result=await execute(job);fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({id:job.id,result}));}catch(e){fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({id:job?.id,error:e.message}));}finally{busy=false}},150);
});
app.on('window-all-closed',()=>app.quit());
