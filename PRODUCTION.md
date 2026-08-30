# PRODUCTION.md — نشر متجرك على الإنترنت (مجاناً 100%)

دليل كامل لنشر `mediator-store` على الإنترنت + تحويله لتطبيق موبايل، بدون أي تكاليف.

---

## 0) خريطة الخيارات السريعة

| الهدف | الخيار | التكلفة | الصعوبة |
|---|---|---|---|
| **استضافة دائمة على الويب** (الأفضل) | **Oracle Cloud Always-Free** (VM) | $0 للأبد | متوسطة |
| استضافة سريعة بدون VM | Render / Railway / Fly.io / Koyeb | $0 (محدود) | سهلة |
| **PWA** (تثبيت كتطبيق على الموبايل) | مدمج في المشروع — لا شيء إضافي | $0 | صفر |
| **تطبيق Android على Google Play** | **Bubblewrap TWA** | $25 مرة واحدة | متوسطة |
| تطبيق APK للتحميل المباشر (بدون Google Play) | **WebIntoApp** أو TWA sideload | $0 | سهلة |

> **التوصية للبداية بدون كارت بنكي**:
> 1. انشر على **Oracle Cloud Free Tier** (مجاني للأبد، 4 أنوية + 24GB RAM)
> 2. فعل **PWA** (دقيقة وحدة، مدمج)
> 3. انشر على **Google Play** بـ **TWA** ($25 مرة واحدة فقط)

---

## 1) نشر الموقع على Oracle Cloud (مجاني للأبد)

### لماذا Oracle Cloud؟
- **Always-Free Tier** = 4 أنوية ARM + 24GB RAM + 200GB storage
- مجاني للأبد، ليس trial
- يدعم Docker، Node.js، قواعد بيانات
- يسجّل بدون كارت بنكي (للـ free tier)

### الخطوات

#### أ) إنشاء حساب
1. روح لـ https://cloud.oracle.com/
2. **Sign Up** → اختر region (مثل Frankfurt أو Amsterdam - قريب من فرنسا)
3. أدخل إيميلك. **لن يطلب كارت بنكي** لـ Always-Free
4. سجّل دخول للـ Console

#### ب) إنشاء VM
1. من القائمة → **Compute → Instances → Create Instance**
2. اختر:
   - **Name**: `mediator-store`
   - **Image**: Ubuntu 22.04 (أو 24.04)
   - **Shape**: `VM.Standard.A1.Flex` (Always Free — ARM)
     - **OCPUs**: 4
     - **Memory**: 24 GB
     - **Boot volume**: 200 GB
   - **Networking**: اعتمد الـ VCN الافتراضي
   - **SSH keys**: ارفع `id_rsa.pub` (أو دعه ينشئ واحد)
3. **Create**. بعد دقيقة، الـ VM تشتغل

#### ج) إعداد الـ VM

اتصل عبر SSH:
```bash
ssh ubuntu@<PUBLIC_IP> -i ~/Downloads/ssh-key.key
```

ثم:
```bash
# تحديث + أساسيات
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx certbot python3-certbot-nginx git

# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# PM2 (process manager)
sudo npm install -g pm2
```

#### د) رفع المشروع

على جهازك (محلياً):
```bash
# في مجلد المشروع
rsync -avz --exclude 'node_modules' --exclude 'data/*.db*' --exclude '.env' \
  ./mediator-store/ ubuntu@<PUBLIC_IP>:~/mediator-store/
```

على الـ VM:
```bash
cd ~/mediator-store
cp .env.example .env
nano .env   # عدّل SESSION_SECRET و ADMIN_PASSWORD
npm install
```

#### هـ) تشغيل التطبيق

```bash
# ابدأ مع PM2
pm2 start server.js --name mediator-store
pm2 startup
pm2 save
```

#### و) Nginx + SSL مجاني

أنشئ `/etc/nginx/sites-available/mediator-store`:
```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    client_max_body_size 20M;   # لرفع صور أكبر

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

فعّل:
```bash
sudo ln -s /etc/nginx/sites-available/mediator-store /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

#### ز) دومين مجاني + SSL

- **Free domain**: https://www.duckdns.org/ (مجاني للأبد) — يعطيك `yourname.duckdns.org`
- أو اشتري دومين من Namecheap (~5$/سنة)

لـ DuckDNS:
1. سجّل، أنشئ subdomain، وجّهه لـ IP السيرفر
2. على الـ VM:
```bash
sudo certbot --nginx -d yourname.duckdns.org
# أدخل إيميلك، وافق على الشروط
```

✅ الآن عندك: `https://yourname.duckdns.org` بشهادة SSL مجانية

#### ح) افتح الـ Port في Oracle Cloud

1. في الـ Console → **Networking → Virtual Cloud Networks**
2. اضغط على الـ VCN → **Subnets** → **Default Security List**
3. **Ingress Rules** → أضف:
   - Source CIDR: `0.0.0.0/0`
   - Protocol: TCP
   - Destination Port: 80, 443

> ⚠️ **مهم**: Oracle Cloud بطبيعته يقفل الـ ports. لو ما فتحت الـ 80/443، الموقع ما يشتغل.

---

## 2) بديل أسهل بدون VM: Docker على Fly.io / Render

### Fly.io (الأسهل للبداية — سجّل بدون كارت)
1. سجّل في https://fly.io
2. ثبّت Fly CLI: `curl -L https://fly.io/install.sh | sh`
3. في مجلد المشروع:
   ```bash
   fly launch --name mediator-store
   fly secrets set SESSION_SECRET=$(openssl rand -hex 32)
   fly secrets set ADMIN_PASSWORD=your-strong-password
   fly deploy
   ```
4. احصل على URL: `https://mediator-store.fly.dev`

### Render.com
1. سجّل في https://render.com
2. **New** → **Web Service** → اربط GitHub repo
3. اختر Docker
4. **Free** plan
5. أضف `SESSION_SECRET` و `ADMIN_PASSWORD` في Environment

> ⚠️ Render المجاني يوقف السيرفر بعد 15 دقيقة بدون زيارة (cold start ~30 ثانية). للمتجر الحقيقي، استخدم Oracle Cloud أو Fly.io.

---

## 3) PWA: تحويله لتطبيق موبايل (بدون Google Play)

التطبيق **جاهز PWA بالفعل** (أضفنا manifest + service worker).

### للمستخدم:
1. افتح `https://your-domain.com` في Chrome على Android (أو Safari على iOS)
2. ستظهر نافذة "Add to Home Screen" أو من القائمة → "Install app"
3. التطبيق يثبت على الشاشة الرئيسية كرأي حقيقي
4. يفتح بملء الشاشة بدون شريط المتصفح
5. يعمل **أوفلاين** (شكراً للـ service worker)

### للـ iOS:
- Safari → زر المشاركة → "Add to Home Screen"

### للتطوير:
- افتح Chrome DevTools → **Application** → **Manifest** لاختبار

---

## 4) Google Play: TWA (Trusted Web Activity)

**$25 مرة واحدة فقط** (حساب Google Play Developer).

### TWA = تطبيق Android "فارغ" يفتح موقعك داخله.
- يثبت كرأي حقيقي من Play Store
- يفتح بـ Chrome (وليس WebView) → نفس أداء الموقع
- يمر من مراجعة Play Store بسهولة
- مجاني بعد الـ $25

### الخطوات

#### أ) انشر موقعك أولاً (يجب أن يكون على HTTPS)

#### ب) أنشئ مشروع Bubblewrap
```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest=https://your-domain.com/manifest.json
```

#### ج) ابنِ الـ APK
```bash
bubblewrap build
```

#### د) أنشئ keystore للتوقيع (مرة واحدة)
```bash
keytool -genkey -v -keystore my-release-key.keystore \
  -alias mediator -keyalg RSA -keysize 2048 -validity 10000
```

#### هـ) وقّع الـ APK
```bash
# في Android Studio: Build → Generate Signed Bundle / APK
# أو يدوياً:
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \
  -keystore my-release-key.keystore \
  app-release-unsigned.apk mediator
```

#### و) ارفع على Google Play
1. ادفع $25 على https://play.google.com/console
2. **Create app** → املأ المعلومات
3. **Production** → **Create release** → ارفع AAB (موصى به) أو APK
4. **Store listing**: لقطات شاشة، وصف، أيقونة
5. **Submit for review**

**مراجعة Google**: عادة 1-3 أيام. غالباً يمر من أول مرة لأن TWA معروف.

### مرجع مفصّل: https://developers.google.com/codelabs/pwa-in-playstore

---

## 5) APK للتحميل المباشر (بدون Google Play) — 100% مجاني

### الطريقة 1: WebIntoApp (أسهل)
1. روح https://webintoapp.com/ (أو مشابه)
2. الصق URL موقعك
3. يولّد APK جاهز للتحميل
4. ارفعه على موقعك أو وزّعه كيف ما تحب

**ملاحظة**: النسخ المجانية من هذه الخدمات محدودة، لكن غالباً تكفي للـ MVP.

### الطريقة 2: نفس TWA لكن بدون Google Play
نفس الخطوات السابقة، لكن:
- وقّع الـ APK بـ keystore
- ارفعه مباشرة على موقعك: `https://your-domain.com/download/mediator.apk`
- المستخدم يحمّل ويفعّل "Install from unknown sources"

### الطريقة 3: عبر F-Droid (بديل مجاني لـ Google Play)
- F-Droid يقبل PWAs و TWAs
- لكن العملية أكثر تعقيداً

---

## 6) Checklist للنشر

قبل ما تنشر، تأكد من:

- [ ] `.env` مضبوط:
  - `SESSION_SECRET` = 64 حرف عشوائي (`openssl rand -hex 32`)
  - `ADMIN_PASSWORD` = كلمة مرور قوية
  - `NODE_ENV=production`
- [ ] غيّرت كلمة مرور الأدمن الافتراضية
- [ ] رفعت صورتك الخاصة في `/admin/settings` (شعار، اتصال)
- [ ] اختبرت على موبايلك
- [ ] SSL يعمل (`https://`)
- [ ] Backup للداتا (SQLite + uploads) كل فترة
  ```bash
  # على الـ VM
  tar -czf backup-$(date +%F).tar.gz data/ uploads/
  ```

---

## 7) تشغيل سريع بـ Docker (محلياً للتجربة)

```bash
# بناء الصورة
docker build -t mediator-store .

# تشغيل
docker run -d --name mediator \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/uploads:/app/uploads \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e ADMIN_PASSWORD=change-me \
  mediator-store
```

أو بـ docker-compose:
```bash
SESSION_SECRET=$(openssl rand -hex 32) \
ADMIN_PASSWORD=change-me \
docker compose up -d
```

---

## 8) التكلفة الإجمالية

| العنصر | التكلفة |
|---|---|
| استضافة Oracle Cloud | **$0 للأبد** |
| دومين DuckDNS | **$0** |
| SSL Let's Encrypt | **$0** |
| PWA (مدمج) | **$0** |
| حساب Google Play (مرة واحدة) | **$25** |
| Apple Developer (اختياري، سنوي) | **$99/سنة** |
| **الإجمالي (بدون iOS)** | **$25 مرة واحدة** |
| **الإجمالي (iOS App Store)** | **$124 السنة الأولى، $99 بعدها** |

---

## 🆘 مشاكل شائعة

**1. الموقع بطيء أو لا يفتح**
- افتح الـ ports في Oracle Cloud Security List
- تحقق من `pm2 status` و `pm2 logs`

**2. PWA لا يثبت**
- تأكد من HTTPS (مطلوب)
- افتح DevTools → Application → Manifest → يجب ما يكون فيه errors

**3. الصور لا تتحمّل بعد النشر**
- تأكد من `client_max_body_size 20M;` في nginx
- تحقق من permissions على `/app/uploads`

**4. Google Play رفض التطبيق**
- تأكد من URL HTTPS صحيح
- أضف Privacy Policy URL
- لقطات شاشة لجميع المقاسات
