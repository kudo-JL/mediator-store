# COOLIFY-SETUP.md — انشر كل مشاريعك من مكان واحد (مجاني)

**Coolify** = Heroku شخصي مجاني، مفتوح المصدر، ينصَّب على VM واحد ويتحكم في عدد غير محدود من التطبيقات من dashboard جميل.

**Oracle Cloud Always-Free** = VM مجاني للأبد (4 أنوية + 24GB).

**المجموع**: $0/شهر لكل مشاريعك معاً.

---

## 0) قبل ما تبدأ

### ما تحتاج:
- ✅ حساب Oracle Cloud (بدون كارت بنكي)
- ✅ VM من نوع `VM.Standard.A1.Flex` (4 OCPU + 24GB) على Frankfurt أو Amsterdam
- ✅ Ports مفتوحة: 22, 80, 443, 8000
- ✅ دومين (اختياري، لكن موصى به): مجاني من [DuckDNS](https://www.duckdns.org)

### الوقت:
- ⏱️ أول مرة: 2-3 ساعات (بما فيها انتظار Oracle instance)
- ⏱️ بعد ذلك: 5 دقائق لكل تطبيق جديد

---

## 1) إنشاء VM على Oracle Cloud (45 دقيقة)

### أ) Sign up
1. https://cloud.oracle.com/ → **Start for Free**
2. اختر **Home Region**: Frankfurt (الأقرب للمغرب، latency ~50ms)
3. Email + كلمة سر → بدون كارت بنكي

> ⚠️ **مشكلة شائعة**: "Out of host capacity" في Frankfurt
> **الحل**: جرّب في أوقات مختلفة (3-4 صباحاً بتوقيتك) أو جرّب Amsterdam. أو ابدأ بـ **2 OCPU + 12GB** (أسهل في الحصول).

### ب) Create Instance
1. **Compute → Instances → Create Instance**
2. **Name**: `coolify-server`
3. **Image**: Ubuntu 22.04 (minimal works too)
4. **Shape**: `VM.Standard.A1.Flex`:
   - OCPUs: **4**
   - Memory: **24 GB**
   - Local storage: (default 0, we use block volume)
5. **Networking**: Default VCN
6. **SSH Keys**: Paste your public key (`cat ~/.ssh/id_rsa.pub` on Linux/Mac, or generate on Windows with PuTTY)
7. **Boot Volume**: 100 GB
8. Click **Create**

### ج) Open Ports
1. **Networking → Virtual Cloud Networks → Your VCN**
2. **Subnets → Public Subnet → Security List → Default Security List**
3. **Add Ingress Rules**:
   - `0.0.0.0/0` → TCP → `80`
   - `0.0.0.0/0` → TCP → `443`
   - `0.0.0.0/0` → TCP → `8000` (Coolify initial UI; remove later)
   - `0.0.0.0/0` → TCP → `22` (SSH; keep)

### د) Connect
```bash
ssh ubuntu@<PUBLIC_IP>
# or on Windows: use PuTTY / Windows Terminal with the .key file
```

---

## 2) Install Coolify (15 دقيقة)

على الـ VM، شغّل السكربت الجاهز من المشروع:
```bash
# Upload the script first
# From your local machine:
scp scripts/setup-oracle-cloud.sh ubuntu@<PUBLIC_IP>:~/

# Then on the VM:
chmod +x setup-oracle-cloud.sh
sudo ./setup-oracle-cloud.sh
```

> أو يدوياً:
> ```bash
> curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
> ```

### افتح Coolify
في المتصفح: `http://<PUBLIC_IP>:8000`

### First-time wizard:
1. أنشئ حساب admin
2. Skip the registration step
3. Add Server → `localhost`
4. Project → `default`
5. **Done**

---

## 3) دومين مجاني (15 دقيقة)

### DuckDNS (مجاني للأبد)
1. سجّل في https://www.duckdns.org/ (بحساب Google أو GitHub)
2. أنشئ subdomain مثل `mystore` → يعطيك `mystore.duckdns.org`
3. وجّه الـ IP لـ Oracle VM

### ربط wildcard (عشان كل تطبيقاتك على subdomain)
1. في DuckDNS، أضف wildcard: `*.mystore.duckdns.org` → نفس الـ IP
2. في Coolify: **Settings → FQDN / Wildcard Domain**:
   - Wildcard domain: `*.mystore.duckdns.org`
3. Coolify يولّد SSL تلقائياً عبر Let's Encrypt

> الآن كل تطبيق تنشره يحصل على `https://appname.mystore.duckdns.org` تلقائياً 🎉

---

## 4) انشر أول تطبيق (5 دقائق)

### السيناريو A: عندك repo على GitHub
1. في Coolify: **+ New Resource → Application → Public Repository**
2. **Git URL**: `https://github.com/yourname/mediator-store`
3. **Branch**: `main`
4. **Build Pack**: 
   - `Nixpacks` (auto-detects Node — لا يحتاج Dockerfile)
   - أو `Dockerfile` (إذا عندك Dockerfile مخصص)
5. **Port**: `3000`
6. **Environment Variables**:
   ```
   NODE_ENV=production
   SESSION_SECRET=<paste-random-64-chars>
   ADMIN_PASSWORD=<your-strong-password>
   STORE_NAME=متجر الوسيط
   STORE_CURRENCY=د.م.
   ```
7. **Domains**: 
   - `mediator.mystore.duckdns.org` (مثلاً)
   - أو دومين مدفوع `mediator.ma` لو اشتريت
8. **Deploy** → Coolify يبني الصورة، يبدأ التشغيل، يفعّل SSL

### السيناريو B: عندك الكود محلياً
1. ادفع الـ repo إلى GitHub أولاً
2. استخدم Coolify مثل السيناريو A

### السيناريو C: ما عندك GitHub بعد
1. أنشئ حساب GitHub
2. `git init` + `git remote add origin https://github.com/you/repo.git`
3. `git add . && git commit -m "init"`
4. `git push -u origin main`
5. ثم Coolify

---

## 5) انشر بقية التطبيقات

كرر الخطوة 4 لكل تطبيق:
- **football-app**: `https://football.mystore.duckdns.org`
- **mediator-store**: `https://store.mystore.duckdns.org`
- **social-net**: `https://social.mystore.duckdns.org`
- **echat**: `https://chat.mystore.duckdns.org`

كل واحد = 5 دقائق.

### حيل:
- استخدم **Nixpacks** بدل Dockerfile — يكتشف Node تلقائياً
- في Environment Variables، ضع **قاعدة بيانات واحدة لكل تطبيق** (DB منفصلة لكل واحد) — لو تحتاج لاحقاً
- فعّل **auto-deploy** من GitHub branch: كل push = deploy جديد

---

## 6) Maintenance

### نسخ احتياطي (مهم!)
- **DB + uploads** عندك في `/app/data` و `/app/uploads` داخل كل container
- في Coolify: لكل app، فعّل **Persistent Storage**:
  - `/app/data` → volume
  - `/app/uploads` → volume
- **Backups خارجية**: شغّل يومياً في Coolify → Database Backups (Postgres) أو يدوياً:
  ```bash
  # On the VM
  cd /data/coolify/databases/<app>-<id>/
  sqlite3 app.db ".backup '/backups/app-$(date +%F).db'"
  ```

### مراقب الأداء
- **Coolify Dashboard**: استهلاك CPU/RAM لكل container
- **Logs**: في Coolify → Application → Logs (real-time)

### التحديثات
- **Nixpacks**: rebuild تلقائي عند push
- **Dockerfile**: نفس الشيء
- **لتحديث dependencies**: ادفع `package.json` جديد → Coolify يبني من جديد

---

## 7) حدود Oracle Always-Free (احفظها في بالك)

| المورد | الحد |
|---|---|
| **Outbound bandwidth** | 10 TB/شهر (يكفي 1000+ زائر/يوم لكل app) |
| **Block storage** | 200 GB total (يكفي 7-10 تطبيقات بسهولة) |
| **OCPU + RAM** | 4 + 24 GB (يكفي ~5-10 تطبيقات Node خفيفة) |
| **Always-free** | للأبد (Oracle ملتزمة من 2019) |

### لو كبرت المشاريع:
- **نفس VM**: ادفع لـ Oracle ووسّع الحجم (4 OCPU → 8 OCPU مثلاً)
- أو **انقل لـ Hetzner/OVH** VPS: 4€/شهر لـ 4GB RAM، ضع Coolify هناك
- أو **انقل لـ DigitalOcean App Platform**: $5/شهر لكل app

---

## 8) ما يُنشر من لوحة واحدة

بعد ما تكمل الخطوات:
- ✅ dashboard واحد: `https://coolify.mystore.duckdns.org`
- ✅ عدد غير محدود من التطبيقات
- ✅ كل واحد له URL خاص
- ✅ HTTPS تلقائي لكل واحد
- ✅ Logs + metrics لكل واحد
- ✅ Deploy بضغطة زر من GitHub
- ✅ Backups تلقائية
- ✅ SSL renewal تلقائي

**لو يوم من الأيام قررت تشتري VPS أقوى**: تنقل Coolify كامل في ساعة، كل تطبيقاتك تشتغل بدون أي تغيير في الـ code.

---

## 9) البدائل لو ما اشتغل Oracle

| البديل | الكارت | الصعوبة | ملاحظات |
|---|---|---|---|
| **Hetzner Cloud** | ✅ | سهل | 4€/شهر، Frankfurt، موصى به بشدة |
| **OVH VPS** | ✅ | سهل | أرخص، لكن UI أعقد |
| **Scaleway** | ✅ | سهل | فرنسي، Stardust 1.99€/شهر |
| **DigitalOcean** | ✅ | سهل | $6/شهر، UI ممتاز |

كلها تشغّل Coolify بنفس الطريقة. لو Oracle رفض، Hetzner هو الأنسب لك (Frankfurt + رخيص + موثوق).

---

## ✅ Checklist النهائي

- [ ] Oracle account + VM 4 OCPU/24GB في Frankfurt
- [ ] Ports 22, 80, 443, 8000 مفتوحة
- [ ] SSH key مربوط
- [ ] Coolify منصّب (نفس IP:8000)
- [ ] DuckDNS domain + wildcard
- [ ] Coolify wildcard domain مربوط
- [ ] أول تطبيق (mediator-store) منشور ويعمل
- [ ] SSL شغّال على `https://mediator.mystore.duckdns.org`
- [ ] Admin password مغيّر
- [ ] Database backup مضبوط

---

## 🆘 مشاكل شائعة

**1. "Out of host capacity"**
- Frankfurt/Amsterdam مشهورين. جرّب:
  - Marseille, Stockholm, Milan
  - أووقات غير الذروة
  - ابدأ بـ 2 OCPU بدل 4

**2. Coolify لا يفتح على :8000**
- تأكد الـ port مفتوح في Oracle Security List
- `sudo systemctl status coolify` على الـ VM
- `sudo coolify restart` (لو عندك v4)

**3. SSL يفشل في Coolify**
- تأكد DNS wildcard مضبوط في DuckDNS
- جرّب في Coolify: **Settings → DNS → Test**

**4. الـ app ما يبني (Nixpacks)**
- افتح logs في Coolify
- غالباً dependencies أو port خطأ
- تأكد `package.json` فيه `"start": "node server.js"`

**5. Disk يمتلئ**
- في VM: `du -sh /data/coolify/* | sort -h`
- احذف Docker images قديمة: `docker system prune -a`
