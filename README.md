# AI Hub Auth

خادم مصادقة بسيط لإرسال أكواد التأكيد عبر SMTP.

## التشغيل

```bash
npm install
npm start
```

انسخ `.env.example` إلى `.env` واملأ بيانات صندوق البريد. عند ترك `SMTP_USER` أو `SMTP_PASS` فارغًا يعمل الخادم في وضع التجربة ويعرض الكود في الاستجابة بدل إرساله.

```env
SMTP_HOST=durra.fwh.is
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=info@example.com
SMTP_PASS=كلمة_مرور_صندوق_البريد
```

افتح `http://localhost:3000`، أو استخدم `POST /api/auth/send-code` مع جسم JSON يحتوي على `email`.