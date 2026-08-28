require('dotenv').config();

const http = require('node:http');
const crypto = require('node:crypto');
const nodemailer = require('nodemailer');

const port = Number.parseInt(process.env.PORT || '3000', 10);
const users = new Map();
const verificationCodes = new Map();
const sessions = new Map();
const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const demoMode = !smtpConfigured;
const mailTransport = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number.parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    })
  : null;

function sendJson(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10_000) reject(new Error('Request body is too large'));
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const [name, ...value] = part.trim().split('=');
    return [name, decodeURIComponent(value.join('='))];
  }));
}

function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function passwordMatches(password, storedHash) {
  const [salt, expected] = storedHash.split(':');
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function emailFromPayload(payload) {
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function htmlPage(title, content, script = '') {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:620px;margin:40px auto;padding:20px;background:#f5f7fb;color:#172033}main{background:white;padding:28px;border-radius:12px;box-shadow:0 8px 28px #17203318}label,input,button{display:block;width:100%;box-sizing:border-box;margin:10px 0;padding:11px;font-size:1rem}button{cursor:pointer;background:#155eef;color:white;border:0;border-radius:6px}output{display:block;margin-top:16px}a{color:#155eef}</style></head><body><main>${content}</main><script>${script}</script></body></html>`;
}

function renderHome() {
  const modeText = demoMode ? 'وضع التجربة: سيظهر كود التأكيد على الشاشة.' : 'سيصلك كود التأكيد عبر البريد الإلكتروني.';
  return htmlPage('AI Hub Auth', `<h1>🛡️ AI Hub Auth</h1><p>${modeText}</p><h2>إنشاء حساب</h2><form id="register"><input name="email" type="email" placeholder="البريد الإلكتروني" required><input name="password" type="password" placeholder="كلمة المرور (6 أحرف على الأقل)" minlength="6" required><button>سجّل حسابًا</button></form><h2>تسجيل الدخول</h2><form id="login"><input name="email" type="email" placeholder="البريد الإلكتروني" required><input name="password" type="password" placeholder="كلمة المرور" required><button>تسجيل الدخول</button></form><output id="result" aria-live="polite"></output>`, `async function submit(form, url){const result=document.getElementById('result');const data=Object.fromEntries(new FormData(form));const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const body=await response.json();result.innerHTML=body.error||body.message||'';if(body.code)result.innerHTML+=' الكود: <strong>'+body.code+'</strong>';if(body.next)result.innerHTML+='<br><a href="'+body.next+'">متابعة</a>';if(response.ok&&url.endsWith('login'))location.href='/dashboard';}document.getElementById('register').onsubmit=e=>{e.preventDefault();submit(e.target,'/api/auth/register')};document.getElementById('login').onsubmit=e=>{e.preventDefault();submit(e.target,'/api/auth/login')};`);
}

function issueCode(email) {
  const code = crypto.randomInt(100000, 1000000).toString();
  verificationCodes.set(email, { code, expiresAt: Date.now() + 10 * 60 * 1000 });
  return code;
}

async function sendVerification(email, code) {
  if (demoMode) return;
  await mailTransport.sendMail({ from: process.env.SMTP_USER, to: email, subject: 'كود تأكيد AI Hub', text: `كود تأكيد حسابك في AI Hub هو: ${code}` });
}

const server = http.createServer((request, response) => {
  const path = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
  if (request.method === 'GET' && path === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(renderHome());
    return;
  }
  if (request.method === 'GET' && path === '/dashboard') {
    const session = sessions.get(parseCookies(request).session);
    if (!session) return sendJson(response, 401, { error: 'يجب تسجيل الدخول أولًا.' });
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(htmlPage('لوحة AI Hub', `<h1>لوحة التحكم جاهزة</h1><p>مرحبًا بك، ${session.email}</p><p>تم تسجيل الدخول بنجاح.</p><a href="/">العودة</a>`));
    return;
  }
  if (request.method === 'GET' && path === '/api/health') return sendJson(response, 200, { name: 'ai-hub', status: 'ok', demoMode });
  if (request.method === 'POST' && ['/api/auth/register', '/api/auth/verify', '/api/auth/login'].includes(path)) {
    readBody(request).then(async (body) => {
      let payload;
      try { payload = JSON.parse(body); } catch { return sendJson(response, 400, { error: 'JSON غير صالح.' }); }
      const email = emailFromPayload(payload);
      if (!email) return sendJson(response, 400, { error: 'أدخل بريدًا إلكترونيًا صحيحًا.' });

      if (path === '/api/auth/register') {
        if (users.has(email)) return sendJson(response, 409, { error: 'الحساب موجود مسبقًا.' });
        if (typeof payload.password !== 'string' || payload.password.length < 6) return sendJson(response, 400, { error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.' });
        users.set(email, { password: passwordHash(payload.password), verified: false });
        const code = issueCode(email);
        await sendVerification(email, code);
        const result = { message: 'تم إنشاء الحساب. أدخل كود التأكيد.', next: `/verify?email=${encodeURIComponent(email)}` };
        if (demoMode) result.code = code;
        return sendJson(response, 200, result);
      }
      if (path === '/api/auth/verify') {
        const user = users.get(email);
        const stored = verificationCodes.get(email);
        if (!user || !stored || stored.expiresAt < Date.now() || stored.code !== String(payload.code || '')) return sendJson(response, 400, { error: 'كود التأكيد غير صحيح أو منتهي.' });
        user.verified = true;
        verificationCodes.delete(email);
        return sendJson(response, 200, { message: 'تم تأكيد الحساب. يمكنك تسجيل الدخول.' });
      }
      const user = users.get(email);
      if (!user || !user.verified || typeof payload.password !== 'string' || !passwordMatches(payload.password, user.password)) return sendJson(response, 401, { error: 'بيانات الدخول غير صحيحة أو الحساب غير مؤكد.' });
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { email, createdAt: Date.now() });
      return sendJson(response, 200, { message: 'تم تسجيل الدخول.', next: '/dashboard' }, { 'Set-Cookie': `session=${token}; HttpOnly; SameSite=Lax; Path=/` });
    }).catch(() => sendJson(response, 400, { error: 'تعذر قراءة الطلب.' }));
    return;
  }
  if (request.method === 'GET' && path === '/verify') {
    const email = new URL(request.url, `http://${request.headers.host || 'localhost'}`).searchParams.get('email') || '';
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(htmlPage('تأكيد الحساب', `<h1>تأكيد الحساب</h1><form id="verify"><input name="email" type="email" value="${email}" required><input name="code" inputmode="numeric" placeholder="كود التأكيد" required><button>تأكيد</button></form><output id="result"></output>`, `document.getElementById('verify').onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));const r=await fetch('/api/auth/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const b=await r.json();document.getElementById('result').innerHTML=b.error||b.message+(r.ok?' <a href="/">تسجيل الدخول</a>':'')}`));
    return;
  }
  sendJson(response, 404, { error: 'Not found' });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`🛡️ AI Hub Auth server يعمل على http://localhost:${port}`);
  if (demoMode) console.log('🔧 وضع التجربة (بدون SMTP): كود التأكيد سيُعرض على الشاشة...');
});
