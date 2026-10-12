'use client';

/* ============================================================
   حاسبة التولرنس: HEX الشركة مقابل قراءة السبكترو (CIEDE2000)
   ملف واحد. يشتغل كمعاينة (Artifact) وكصفحة Next.js:
   app/page.js
   لا يعتمد على Tailwind: كل التنسيق داخل الملف.
   ============================================================ */

import React, { useState, useEffect, useMemo } from 'react';

const WHITES = {
  D65: { X: 95.047, Y: 100, Z: 108.883 },
  D50: { X: 96.4212, Y: 100, Z: 82.5188 },
};

const FINISH_OPTIONS = ['', 'Matte', 'Natural', 'Glossy', 'Shimmer', 'Metallic', 'Glitter'];
const SPARKLY = ['Shimmer', 'Metallic', 'Glitter'];

const TOLERANCE_PRESETS = [
  { label: 'صارم (≤ 1)', value: 1 },
  { label: 'قياسي (≤ 2)', value: 2 },
  { label: 'متساهل (≤ 3.5)', value: 3.5 },
];

const STORAGE_KEY = 'tolerance-tool-v2';

/* ---------- أدوات الألوان ---------- */
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

function parseHex(str) {
  if (!str) return null;
  let h = String(str).trim().replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return '#' + h.toUpperCase();
}

function parseLab(str) {
  if (!str) return null;
  const nums = String(str).match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 3) return null;
  const [L, a, b] = nums.slice(0, 3).map(Number);
  if (L < 0 || L > 100) return null;
  return { L, a, b };
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function xyzToLab({ X, Y, Z }, wp) {
  const e = 216 / 24389;
  const k = 24389 / 27;
  const f = (t) => (t > e ? Math.cbrt(t) : (k * t + 16) / 116);
  const fx = f(X / wp.X);
  const fy = f(Y / wp.Y);
  const fz = f(Z / wp.Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function labToXyz({ L, a, b }, wp) {
  const e = 216 / 24389;
  const k = 24389 / 27;
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const fx3 = fx ** 3;
  const fz3 = fz ** 3;
  const xr = fx3 > e ? fx3 : (116 * fx - 16) / k;
  const yr = L > k * e ? ((L + 16) / 116) ** 3 : L / k;
  const zr = fz3 > e ? fz3 : (116 * fz - 16) / k;
  return { X: xr * wp.X, Y: yr * wp.Y, Z: zr * wp.Z };
}

function hexToLab(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = srgbToLinear(((n >> 16) & 255) / 255);
  const g = srgbToLinear(((n >> 8) & 255) / 255);
  const b = srgbToLinear((n & 255) / 255);
  return xyzToLab(
    {
      X: (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) * 100,
      Y: (0.2126729 * r + 0.7151522 * g + 0.072175 * b) * 100,
      Z: (0.0193339 * r + 0.119192 * g + 0.9503041 * b) * 100,
    },
    WHITES.D65
  );
}

// LAB (D65) -> linear RGB بدون قص (حتى نكشف الألوان خارج حدود الشاشة)
function labToLinearRgb(lab) {
  const { X, Y, Z } = labToXyz(lab, WHITES.D65);
  const x = X / 100, y = Y / 100, z = Z / 100;
  return [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
}

function linearRgbToHex(lin) {
  return (
    '#' +
    lin
      .map((c) => Math.min(255, Math.max(0, Math.round(linearToSrgb(Math.min(1, Math.max(0, c))) * 255))))
      .map((v) => v.toString(16).padStart(2, '0').toUpperCase())
      .join('')
  );
}

// تحويل الإضاءة بطريقة Bradford
const BRAD = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
];
const BRAD_INV = [
  [0.9869929, -0.1470543, 0.1599627],
  [0.4323053, 0.5183603, 0.0492912],
  [-0.0085287, 0.0400428, 0.9684867],
];
const mulVec = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

function adaptLab(lab, from, to) {
  if (from === to) return lab;
  const xyz = labToXyz(lab, WHITES[from]);
  const cone = mulVec(BRAD, [xyz.X, xyz.Y, xyz.Z]);
  const s = mulVec(BRAD, [WHITES[from].X, WHITES[from].Y, WHITES[from].Z]);
  const d = mulVec(BRAD, [WHITES[to].X, WHITES[to].Y, WHITES[to].Z]);
  const scaled = cone.map((c, i) => (c * d[i]) / s[i]);
  const [X, Y, Z] = mulVec(BRAD_INV, scaled);
  return xyzToLab({ X, Y, Z }, WHITES[to]);
}

// CIEDE2000 — الفرق = (قياس) − (مرجع)
function deltaE2000(ref, smp) {
  const { L: L1, a: a1, b: b1 } = ref;
  const { L: L2, a: a2, b: b2 } = smp;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (a, b) => {
    if (a === 0 && b === 0) return 0;
    const h = deg(Math.atan2(b, a));
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(a1p, b1);
  const h2p = hue(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp;
  if (C1p * C2p === 0) hbp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
  else hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  const T =
    1 -
    0.17 * Math.cos(rad(hbp - 30)) +
    0.24 * Math.cos(rad(2 * hbp)) +
    0.32 * Math.cos(rad(3 * hbp + 6)) -
    0.2 * Math.cos(rad(4 * hbp - 63));
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  const tl = dLp / Sl;
  const tc = dCp / Sc;
  const th = dHp / Sh;
  const dE = Math.sqrt(Math.max(0, tl ** 2 + tc ** 2 + th ** 2 + Rt * tc * th));
  return { dE, tl, tc, th, dL: dLp, dC: dCp };
}

const meanLab = (arr) => ({
  L: arr.reduce((s, x) => s + x.L, 0) / arr.length,
  a: arr.reduce((s, x) => s + x.a, 0) / arr.length,
  b: arr.reduce((s, x) => s + x.b, 0) / arr.length,
});

/* ---------- التحليل: ليش صار الفرق؟ ---------- */
function analyze(p, s) {
  const hex = parseHex(p.refHex);
  const labs = p.readings.filter((r) => !r.hidden).map((r) => parseLab(r.text)).filter(Boolean);
  if (!hex || labs.length === 0) return null;

  const ill = s.illuminant;
  // الـ HEX معرّف على D65، فنحوله إلى إضاءة الجهاز المختارة ونقارن بنفس الإضاءة
  const ref = adaptLab(hexToLab(hex), 'D65', ill);
  const rawMean = meanLab(labs);
  const meas = rawMean; // قراءة الجهاز كما هي بدون أي تحويل
  const measD65 = adaptLab(rawMean, ill, 'D65'); // للعرض بالشاشة وفحص حدود sRGB فقط
  const r = deltaE2000(ref, meas);

  const spreads = labs.map((l) => deltaE2000(rawMean, l).dE);
  const maxDev = Math.max(...spreads);

  const other = s.illuminant === 'D65' ? 'D50' : 'D65';
  const altDe = deltaE2000(ref, adaptLab(rawMean, other, ill)).dE;

  const lin = labToLinearRgb(measD65);
  const outOfGamut = lin.some((v) => v < -0.003 || v > 1.003);
  const measHex = linearRgbToHex(lin);
  const gamutDe = deltaE2000(measD65, hexToLab(measHex)).dE;

  // حالة الجهاز (بلاطة بيضاء)
  let device = null;
  const wMeasured = parseLab(s.whiteText);
  const wCert = parseLab(s.whiteCert);
  if (wMeasured && wCert) device = deltaE2000(wCert, wMeasured).dE;

  const pass = r.dE <= s.tolerance;
  const sq = [r.tl ** 2, r.tc ** 2, r.th ** 2];
  const total = sq.reduce((a, b) => a + b, 0) || 1;
  const share = { L: sq[0] / total, C: sq[1] / total, H: sq[2] / total };

  const issues = [];

  if (device !== null && device > 1) {
    issues.push({
      level: 'bad',
      title: 'الجهاز يحتاج معايرة',
      text: `قراءة البلاطة البيضاء بعيدة عن قيمتها المعتمدة (ΔE = ${device.toFixed(2)}). أي قراءة مأخوذة بهذي الحالة مشكوك بيها. عاير الجهاز وأعد القياس قبل أي استنتاج ثاني.`,
    });
  }

  if (labs.length >= 2 && maxDev > 0.5) {
    issues.push({
      level: maxDev > 1 ? 'bad' : 'warn',
      title: 'القراءات مو متقاربة مع بعض',
      text: `أكبر انحراف بين قراءاتك والمتوسط ΔE = ${maxDev.toFixed(2)}. هذا يدل على خطأ قراءة: ضغط الجهاز غير ثابت، السطح مو متجانس، أو العينة ما مغطية فتحة الجهاز. وحّد طريقة التحضير وأعد القياس.`,
    });
  }

  if (!pass) {
    if (altDe < r.dE * 0.6 && altDe <= s.tolerance * 1.5) {
      issues.push({
        level: 'bad',
        title: `يمكن اخترت إضاءة غلط (جهازك مضبوط على ${s.illuminant})`,
        text: `لو القراءة كانت بإضاءة ${other} يطلع الفرق ΔE = ${altDe.toFixed(2)} بدل ${r.dE.toFixed(2)}. تأكد من إعداد الإضاءة بالجهاز. الـ HEX الجاي من الشركات يعتمد غالباً على D65.`,
      });
    }

    if (outOfGamut && gamutDe > 1.5) {
      issues.push({
        level: 'warn',
        title: 'اللون الحقيقي خارج حدود الشاشة (sRGB)',
        text: `الـ HEX ما يكدر يمثل هذا اللون، وجزء من الفرق (ΔE ≈ ${gamutDe.toFixed(2)}) مصدره حدود الشاشة وليس خطأ القياس. الألوان المشبعة جداً (أحمر، أزرق، بنفسجي) تطلع منها كثيراً.`,
      });
    }

    const dirL = r.dL > 0 ? 'أفتح' : 'أغمق';
    if (share.L > 0.6) {
      issues.push({
        level: 'warn',
        title: `الفرق أغلبه بالفتوح والغمق: قراءتك ${dirL} من المرجع`,
        text:
          r.dL > 0
            ? 'أسباب شائعة: الطبقة رقيقة وتظهر الخلفية، أو الجهاز يقيس مع اللمعان (SCI) بينما الـ HEX مبني على شاشة. جرّب طبقة أكثف على خلفية بيضاء/معتمة موحدة.'
            : 'أسباب شائعة: الطبقة كثيفة أكثر من المعتاد، أو القياس بدون اللمعان (SCE). تأكد من نفس سماكة الطبقة وإعداد SCI/SCE.',
      });
    } else if (share.C > 0.5) {
      issues.push({
        level: 'warn',
        title: `الفرق أغلبه بالتشبّع: قراءتك ${r.dC > 0 ? 'أكثر' : 'أقل'} تشبعاً`,
        text: 'غالباً سببه كمية المنتج أو التغطية، أو الشركة تنشر HEX أهدأ/أقوى من المنتج الحقيقي. قارن بنفس سماكة الطبقة.',
      });
    } else if (share.H > 0.4) {
      issues.push({
        level: 'warn',
        title: 'الفرق بدرجة اللون (Hue)',
        text: 'الدرجة نفسها مائلة لجهة ثانية. أسباب محتملة: batch مختلف أو تعديل بالصيغة، أو الإضاءة (ميتامرزم)، أو الـ HEX المنشور تقريبي. راجع الإضاءة أولاً ثم قارن مع batch ثاني.',
      });
    } else {
      issues.push({
        level: 'warn',
        title: 'الفرق موزع على أكثر من عنصر',
        text: 'ما في سبب واحد واضح. ابدأ بإعادة القياس بـ 3 مواقع وتأكد من الإضاءة والمعايرة، وبعدها قارن.',
      });
    }

    if (SPARKLY.includes(p.finish)) {
      issues.push({
        level: 'info',
        title: `الفنش ${p.finish} يصعّب المقارنة`,
        text: 'الشيمر والميتالك يتغير لونهم حسب زاوية القياس. هندسة الجهاز (d/8 مقابل 45/0) تأثر كثيراً، فالتولرنس هنا لازم يكون أوسع.',
      });
    }
  }

  if (labs.length === 1) {
    issues.push({
      level: 'info',
      title: 'قراءة وحدة فقط',
      text: 'خذ 3 قراءات بمواقع مختلفة من نفس العينة حتى نكدر نفرق بين خطأ القراءة والفرق الحقيقي.',
    });
  }

  const main = issues.find((i) => i.level === 'bad') || issues.find((i) => i.level === 'warn');

  return {
    hex,
    ref,
    meas,
    measHex,
    illuminant: ill,
    n: labs.length,
    de: r.dE,
    dL: r.dL,
    dC: r.dC,
    da: meas.a - ref.a,
    db: meas.b - ref.b,
    share,
    maxDev,
    pass,
    issues,
    cause: pass ? 'ضمن التولرنس' : main ? main.title : 'يحتاج مراجعة',
  };
}


/* معلومات قراءة وحدة: لونها + فرقها عن HEX الشركة */
function readingInfo(text, refHex, illuminant) {
  const lab = parseLab(text);
  if (!lab) return null;
  const hex = parseHex(refHex);
  const swatch = linearRgbToHex(labToLinearRgb(adaptLab(lab, illuminant, 'D65')));
  const ref = hex ? adaptLab(hexToLab(hex), 'D65', illuminant) : null;
  return { hex: swatch, de: ref ? deltaE2000(ref, lab).dE : null };
}

/* ---------- حفظ البيانات (يعمل بالمعاينة وبالمتصفح) ---------- */
const store = {
  async get(k) {
    try {
      if (typeof window !== 'undefined' && window.storage) {
        const r = await window.storage.get(k);
        if (r && r.value) return JSON.parse(r.value);
        return null;
      }
    } catch (e) {}
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : null;
    } catch (e) {
      return null;
    }
  },
  async set(k, v) {
    try {
      if (typeof window !== 'undefined' && window.storage) {
        await window.storage.set(k, JSON.stringify(v));
        return;
      }
    } catch (e) {}
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
  },
};

/* ---------- واجهة ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const newReading = (text = '') => ({ id: uid(), text });
const newProduct = (over = {}) => ({
  id: uid(),
  name: '',
  refHex: '#',
  finish: '',
  readings: [newReading()],
  ...over,
});

const pad = (n) => String(n).padStart(2, '0');
const stamp = () => {
  const d = new Date();
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const dirText = (v, pos, neg, eps = 0.5) => (Math.abs(v) < eps ? '—' : v > 0 ? pos : neg);
const sgn = (v) => (v > 0 ? '+' : '') + v.toFixed(2);

const CSS = `
.tl-root{--ink:#2a1d15;--ink2:#4a3a2e;--mute:#7d6c5e;--line:#e8dfd8;--line2:#cdbfb3;--bg:#faf8f5;--card:#ffffff;--accent:#c0392b;--tint:#f4e9df;
  color-scheme:light;background:var(--bg);color:var(--ink);min-height:100vh;padding:32px 16px 64px;
  font-family:system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;font-size:14px;line-height:1.6;box-sizing:border-box}
.tl-root *{box-sizing:border-box}
.tl-wrap{max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:24px}
.tl-h1{font-size:22px;font-weight:700;margin:0 0 4px;color:var(--ink)}
.tl-sub{font-size:13px;color:var(--ink2);max-width:680px;margin:0}
.tl-card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;color:var(--ink)}
.tl-grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}
.tl-label{font-size:12px;font-weight:700;color:var(--ink);margin-bottom:6px;display:block}
.tl-hint{font-size:12px;color:var(--mute);margin:6px 0 0}
.tl-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.tl-input,.tl-select,.tl-textarea{width:100%;background:#fff;color:var(--ink);caret-color:var(--ink);border:1px solid var(--line2);border-radius:12px;padding:9px 12px;font-size:14px;font-family:inherit}
.tl-input::placeholder,.tl-textarea::placeholder{color:#9a8b7e;opacity:1}
.tl-input:focus,.tl-select:focus,.tl-textarea:focus{outline:2px solid rgba(42,29,21,.25);outline-offset:1px}
.tl-select option{background:#fff;color:var(--ink)}
.tl-mono{font-family:ui-monospace,Menlo,Consolas,monospace;direction:ltr;text-align:left}
.tl-btn{border:none;cursor:pointer;border-radius:12px;padding:10px 18px;font-size:13px;font-weight:600;font-family:inherit;background:var(--ink);color:#fff}
.tl-btn:hover{background:#1a120d}
.tl-btn.ghost{background:#fff;color:var(--ink2);border:1px solid var(--line2)}
.tl-btn.ghost:hover{border-color:var(--ink)}
.tl-btn.danger{background:#fff;color:#b42318;border:1px solid #f1c0bb}
.tl-btn.danger.armed{background:#b42318;color:#fff;border-color:#b42318}
.tl-btn.small{padding:6px 12px;font-size:12px}
.tl-chip{cursor:pointer;border:2px solid var(--line);background:#fff;color:var(--ink2);border-radius:999px;padding:6px 14px;font-size:13px;font-weight:500;font-family:inherit}
.tl-chip:hover{border-color:var(--mute)}
.tl-chip.on{background:var(--tint);border-color:var(--accent);color:var(--ink);font-weight:700}
.tl-chip.sq{border-radius:12px;flex:1;padding:9px 0;font-size:14px}
.tl-link{background:none;border:none;color:var(--ink2);text-decoration:underline;text-underline-offset:4px;cursor:pointer;font-size:13px;padding:0;font-family:inherit}
.tl-pill{background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 14px;font-size:13px;color:var(--ink)}
.tl-pill.ok{background:#ecfdf3;border-color:#a6e9c3;color:#067647}
.tl-pill.bad{background:#fef3f2;border-color:#f5b8b3;color:#b42318}
.tl-prod-head{display:grid;grid-template-columns:1fr auto auto auto;gap:12px;align-items:end}
@media(max-width:760px){.tl-prod-head{grid-template-columns:1fr 1fr}}
.tl-hexbox{display:flex;gap:8px;align-items:center}
.tl-dot{width:34px;height:34px;border-radius:10px;border:1px solid rgba(0,0,0,.15);flex-shrink:0}
.tl-reading{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}
.tl-reading .tl-input{flex:1;min-width:170px;width:auto}
.tl-reading.off .tl-input{background:#f1ebe5;color:#7d6c5e}
.tl-reading.off .n,.tl-reading.off .tl-rsw,.tl-reading.off .tl-rde{opacity:.5}
.tl-rsw{width:30px;height:30px;border-radius:8px;border:1px solid rgba(0,0,0,.15);flex-shrink:0}
.tl-rde{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;font-weight:700;direction:ltr;white-space:nowrap}
.tl-best{background:#ecfdf3;color:#067647;border:1px solid #a6e9c3;border-radius:999px;font-size:12px;font-weight:700;padding:2px 10px;white-space:nowrap}
.tl-icon.sm{width:30px;height:30px}
.tl-icon.sm svg{width:16px;height:16px}
.tl-icon.offbtn{background:#f1ebe5;color:#7d6c5e;border-style:dashed}
.tl-reading span.n{font-size:12px;color:var(--mute);width:58px;flex-shrink:0}
.tl-x{background:none;border:none;color:var(--mute);cursor:pointer;font-size:16px;padding:4px 8px}
.tl-x:hover{color:var(--ink)}
.tl-result{border-top:1px dashed var(--line2);margin-top:14px;padding-top:14px;display:flex;flex-direction:column;gap:12px}
.tl-res-top{display:flex;flex-wrap:wrap;gap:16px;align-items:stretch}
.tl-sw{display:flex;border:1px solid var(--line);border-radius:14px;overflow:hidden;min-height:92px}
.tl-sw>div{width:112px;display:flex;flex-direction:column}
.tl-sw .c{flex:1}
.tl-sw .t{text-align:center;font-size:11px;padding:4px 0;background:var(--bg);color:var(--ink);font-family:ui-monospace,Menlo,Consolas,monospace;direction:ltr}
.tl-sw .cap{text-align:center;font-size:11px;padding:3px 0;background:#fff;color:var(--mute);border-bottom:1px solid var(--line)}
.tl-de{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:32px;font-weight:700;direction:ltr;line-height:1.1}
.tl-de.ok{color:#067647}.tl-de.bad{color:#b42318}
.tl-badge{display:inline-block;font-size:13px;font-weight:700;border-radius:999px;padding:4px 14px}
.tl-badge.ok{background:#ecfdf3;color:#067647}.tl-badge.bad{background:#fef3f2;color:#b42318}
.tl-deltas{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-top:10px}
.tl-delta{background:var(--bg);border-radius:12px;padding:8px 10px;font-size:12px;color:var(--ink2)}
.tl-delta b{display:block;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:15px;color:var(--ink);direction:ltr;text-align:right}
.tl-issue{border:1px solid;border-radius:12px;padding:10px 14px;font-size:13px;line-height:1.7;margin-top:8px}
.tl-issue b{display:block;margin-bottom:2px}
.tl-issue.bad{background:#fef3f2;border-color:#f5b8b3;color:#7a271a}
.tl-issue.warn{background:#fffaeb;border-color:#fedf89;color:#7a4a0a}
.tl-issue.info{background:#f0f9ff;border-color:#b9e6fe;color:#065986}
.tl-empty{font-size:13px;color:var(--mute);border-top:1px dashed var(--line2);margin-top:14px;padding-top:12px}
.tl-save{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.tl-table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:14px;background:#fff}
.tl-table{width:100%;border-collapse:collapse;font-size:13px;color:var(--ink);min-width:860px}
.tl-table th{background:var(--bg);color:var(--ink2);font-weight:700;text-align:right;padding:10px 12px;border-bottom:1px solid var(--line);white-space:nowrap}
.tl-table td{padding:9px 12px;border-bottom:1px solid #f1ebe5;vertical-align:middle;color:var(--ink)}
.tl-table tr:last-child td{border-bottom:none}
.tl-table tr:hover td{background:#fdfaf7}
.tl-mini{display:inline-flex;align-items:center;gap:6px}
.tl-mini i{width:20px;height:20px;border-radius:6px;border:1px solid rgba(0,0,0,.15);display:inline-block}
.tl-icon{background:#fff;border:1px solid var(--line2);color:var(--ink2);width:34px;height:34px;border-radius:10px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}
.tl-icon:hover{border-color:var(--ink);color:var(--ink);background:var(--tint)}
.tl-icon.del:hover{border-color:#b42318;color:#b42318;background:#fef3f2}
.tl-icon svg{width:18px;height:18px}
.tl-overlay{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px}
.tl-modal{background:#fff;color:var(--ink);border-radius:22px;max-width:680px;width:100%;max-height:90vh;overflow-y:auto;padding:22px;border:1px solid var(--line)}
.tl-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;padding:10px 20px;border-radius:12px;font-size:13px;z-index:60}
.tl-foot{font-size:12px;color:var(--mute);line-height:1.8}
.tl-h2{font-size:16px;font-weight:700;margin:0;color:var(--ink)}
`;

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const EyeOffIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.9 10.9 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
  </svg>
);
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
  </svg>
);

/* عرض نتيجة واحدة (يستخدم بالبطاقة وبنافذة العين) */
function ResultView({ res, tolerance }) {
  return (
    <div className="tl-result">
      <div className="tl-res-top">
        <div className="tl-sw">
          <div>
            <div className="cap">HEX الشركة</div>
            <div className="c" style={{ backgroundColor: res.hex }} />
            <div className="t">{res.hex}</div>
          </div>
          <div>
            <div className="cap">القياس</div>
            <div className="c" style={{ backgroundColor: res.measHex }} />
            <div className="t">{res.measHex}</div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="tl-row" style={{ gap: 12 }}>
            <span className={`tl-de ${res.pass ? 'ok' : 'bad'}`}>ΔE {res.de.toFixed(2)}</span>
            <span className={`tl-badge ${res.pass ? 'ok' : 'bad'}`}>
              {res.pass ? 'ضمن التولرنس' : `خارج التولرنس (الحد ${tolerance})`}
            </span>
          </div>
          <div className="tl-hint">المقارنة تمت بإضاءة {res.illuminant || 'D65'} (الـ HEX يتحول لها تلقائياً). عدد القراءات: {res.n}</div>
          <div className="tl-deltas">
            <div className="tl-delta">الفتوح (ΔL)<b>{sgn(res.dL)}</b>{dirText(res.dL, 'القياس أفتح', 'القياس أغمق')}</div>
            <div className="tl-delta">التشبّع (ΔC)<b>{sgn(res.dC)}</b>{dirText(res.dC, 'أكثر تشبعاً', 'أقل تشبعاً')}</div>
            <div className="tl-delta">أحمر/أخضر (Δa)<b>{sgn(res.da)}</b>{dirText(res.da, 'أحمر أكثر', 'أخضر أكثر')}</div>
            <div className="tl-delta">أصفر/أزرق (Δb)<b>{sgn(res.db)}</b>{dirText(res.db, 'أدفأ', 'أبرد')}</div>
          </div>
        </div>
      </div>
      {res.issues.length > 0 && (
        <div>
          <div className="tl-label" style={{ marginBottom: 0 }}>{res.pass ? 'ملاحظات' : 'من وين جاي الفرق؟'}</div>
          {res.issues.map((it, i) => (
            <div key={i} className={`tl-issue ${it.level}`}>
              <b>{it.title}</b>
              {it.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ToleranceTool() {
  const [settings, setSettings] = useState({ illuminant: 'D65', tolerance: 2, whiteText: '', whiteCert: '100, 0, 0' });
  const [products, setProducts] = useState([
    newProduct({
      name: 'مثال: أحمر شفاه',
      refHex: '#B5343E',
      finish: 'Matte',
      readings: [newReading('41.2, 52.8, 28.1'), newReading('41.6, 53.1, 27.7')],
    }),
  ]);
  const [history, setHistory] = useState([]);
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [viewing, setViewing] = useState(null);
  const [armClear, setArmClear] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    (async () => {
      const d = await store.get(STORAGE_KEY);
      if (d) {
        if (d.settings) setSettings((s) => ({ ...s, ...d.settings }));
        if (Array.isArray(d.products) && d.products.length) setProducts(d.products);
        if (Array.isArray(d.history)) setHistory(d.history);
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    store.set(STORAGE_KEY, { settings, products, history });
  }, [settings, products, history, loaded]);

  useEffect(() => {
    if (!viewing) return;
    const onKey = (e) => e.key === 'Escape' && setViewing(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewing]);

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2200);
  };

  const results = useMemo(() => products.map((p) => analyze(p, settings)), [products, settings]);

  const summary = useMemo(() => {
    const done = results.filter(Boolean);
    return {
      total: products.length,
      measured: done.length,
      pass: done.filter((r) => r.pass).length,
      fail: done.filter((r) => !r.pass).length,
      avg: done.length ? done.reduce((s, r) => s + r.de, 0) / done.length : 0,
      max: done.length ? Math.max(...done.map((r) => r.de)) : 0,
    };
  }, [results, products.length]);

  const deviceDe = useMemo(() => {
    const m = parseLab(settings.whiteText);
    const c = parseLab(settings.whiteCert);
    return m && c ? deltaE2000(c, m).dE : null;
  }, [settings.whiteText, settings.whiteCert]);

  const setSet = (patch) => setSettings((s) => ({ ...s, ...patch }));
  const updateProduct = (id, patch) => setProducts((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const updateReading = (pid, rid, text) =>
    setProducts((ps) =>
      ps.map((p) => (p.id === pid ? { ...p, readings: p.readings.map((r) => (r.id === rid ? { ...r, text } : r)) } : p))
    );
  const addReading = (pid) =>
    setProducts((ps) => ps.map((p) => (p.id === pid ? { ...p, readings: [...p.readings, newReading()] } : p)));
  const removeReading = (pid, rid) =>
    setProducts((ps) =>
      ps.map((p) =>
        p.id === pid ? { ...p, readings: p.readings.length > 1 ? p.readings.filter((r) => r.id !== rid) : p.readings } : p
      )
    );
  const toggleReading = (pid, rid) =>
    setProducts((ps) =>
      ps.map((p) =>
        p.id === pid ? { ...p, readings: p.readings.map((r) => (r.id === rid ? { ...r, hidden: !r.hidden } : r)) } : p
      )
    );
  const removeProduct = (id) => setProducts((ps) => ps.filter((p) => p.id !== id));

  const makeSnapshot = (p, res) => ({
    id: uid(),
    savedAt: stamp(),
    name: p.name || 'بدون اسم',
    finish: p.finish,
    illuminant: settings.illuminant,
    tolerance: settings.tolerance,
    readings: p.readings.filter((r) => !r.hidden).map((r) => r.text).filter(Boolean),
    res,
  });

  const saveOne = (p, res) => {
    setHistory((h) => [makeSnapshot(p, res), ...h]);
    flash('انحفظت القراءة بالسجل');
  };

  const saveAll = () => {
    const snaps = products.map((p, i) => (results[i] ? makeSnapshot(p, results[i]) : null)).filter(Boolean);
    if (!snaps.length) return;
    setHistory((h) => [...snaps, ...h]);
    flash(`انحفظت ${snaps.length} قراءة بالسجل`);
  };

  const deleteSnap = (id) => setHistory((h) => h.filter((x) => x.id !== id));

  const clearAll = () => {
    if (!armClear) {
      setArmClear(true);
      setTimeout(() => setArmClear(false), 3000);
      return;
    }
    setHistory([]);
    setArmClear(false);
  };

  const loadBack = (snap) => {
    setProducts((ps) => [
      ...ps,
      newProduct({
        name: snap.name,
        refHex: snap.res.hex,
        finish: snap.finish || '',
        readings: snap.readings.length ? snap.readings.map((t) => newReading(t)) : [newReading()],
      }),
    ]);
    setViewing(null);
    flash('رجعت القراءة للمحرر');
  };

  const runImport = () => {
    const map = new Map();
    importText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((line) => {
        const t = line.split(/[\t,;]+/).map((x) => x.trim());
        if (t.length < 5) return;
        const hex = parseHex(t[1]);
        const lab = parseLab(t.slice(2, 5).join(' '));
        if (!hex || !lab) return;
        const key = t[0].toLowerCase();
        if (!map.has(key)) map.set(key, newProduct({ name: t[0], refHex: hex, readings: [] }));
        map.get(key).readings.push(newReading(`${lab.L}, ${lab.a}, ${lab.b}`));
      });
    const added = [...map.values()];
    if (added.length) {
      setProducts((ps) => [...ps.filter((p) => p.name || parseLab(p.readings[0]?.text)), ...added]);
      setImportText('');
      setShowImport(false);
    }
  };

  const filtered = history.filter((h) => {
    if (filter === 'pass' && !h.res.pass) return false;
    if (filter === 'fail' && h.res.pass) return false;
    if (query && !h.name.toLowerCase().includes(query.trim().toLowerCase())) return false;
    return true;
  });

  const exportCsv = () => {
    const rows = [
      ['Date', 'Product', 'Finish', 'Brand HEX', 'Measured HEX (sRGB)', 'Readings', 'L*', 'a*', 'b*', 'Illuminant used', 'DeltaE2000', 'dL', 'dC', 'Tolerance', 'Status', 'Likely cause'],
    ];
    filtered.forEach((h) => {
      rows.push([
        h.savedAt, h.name, h.finish, h.res.hex, h.res.measHex, h.res.n,
        h.res.meas.L.toFixed(2), h.res.meas.a.toFixed(2), h.res.meas.b.toFixed(2),
        h.illuminant, h.res.de.toFixed(2), h.res.dL.toFixed(2), h.res.dC.toFixed(2),
        h.tolerance, h.res.pass ? 'PASS' : 'FAIL', h.res.cause,
      ]);
    });
    const csv = '\ufeff' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tolerance-history.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div dir="rtl" className="tl-root">
      <style>{CSS}</style>
      <div className="tl-wrap">
        <header>
          <h1 className="tl-h1">حاسبة التولرنس: HEX الشركة مقابل قراءة السبكترو</h1>
          <p className="tl-sub">
            اكتب الـ HEX المنشور لكل منتج وأضف قراءات الجهاز (L, a, b). الأداة تحسب الفرق بمعيار CIEDE2000 وتبين إذا
            السبب غالباً قراءة غلط أو إضاءة غلط أو شي بالمنتج. كل قراءة تكدر تحفظها بالسجل بالأسفل وتراجعها بأيقونة العين.
          </p>
        </header>

        {/* الإعدادات */}
        <section className="tl-card tl-grid3">
          <div>
            <span className="tl-label">إضاءة الجهاز عند القياس</span>
            <div className="tl-row" style={{ flexWrap: 'nowrap' }}>
              {['D65', 'D50'].map((il) => (
                <button
                  key={il}
                  type="button"
                  aria-pressed={settings.illuminant === il}
                  onClick={() => setSet({ illuminant: il })}
                  className={`tl-chip sq ${settings.illuminant === il ? 'on' : ''}`}
                >
                  {il}
                </button>
              ))}
            </div>
            <p className="tl-hint">الـ HEX مبني على D65، فيتحول تلقائياً إلى إضاءة جهازك المختارة (طريقة Bradford) وتتم المقارنة بنفس الإضاءة.</p>
          </div>

          <div>
            <span className="tl-label">حد التولرنس (ΔE)</span>
            <div className="tl-row" style={{ marginBottom: 8 }}>
              {TOLERANCE_PRESETS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={settings.tolerance === t.value}
                  onClick={() => setSet({ tolerance: t.value })}
                  className={`tl-chip ${settings.tolerance === t.value ? 'on' : ''}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={settings.tolerance}
              onChange={(e) => setSet({ tolerance: Math.max(0.1, parseFloat(e.target.value) || 0.1) })}
              className="tl-input tl-mono"
            />
          </div>

          <div>
            <span className="tl-label">فحص الجهاز بالبلاطة البيضاء (اختياري)</span>
            <input
              value={settings.whiteText}
              onChange={(e) => setSet({ whiteText: e.target.value })}
              placeholder="قراءتك للبلاطة: 95.1, -0.2, 1.8"
              className="tl-input tl-mono"
              style={{ marginBottom: 8 }}
            />
            <input
              value={settings.whiteCert}
              onChange={(e) => setSet({ whiteCert: e.target.value })}
              placeholder="قيمتها المعتمدة: 100, 0, 0"
              className="tl-input tl-mono"
            />
            {deviceDe !== null && (
              <p className="tl-hint" style={{ color: deviceDe > 1 ? '#b42318' : '#067647', fontWeight: 700 }}>
                {deviceDe > 1
                  ? `انحراف الجهاز ΔE = ${deviceDe.toFixed(2)}: يحتاج معايرة`
                  : `انحراف الجهاز ΔE = ${deviceDe.toFixed(2)}: الجهاز سليم`}
              </p>
            )}
          </div>
        </section>

        {/* الملخص */}
        {summary.measured > 0 && (
          <section className="tl-row">
            <span className="tl-pill">منتجات مقاسة: <b>{summary.measured}</b> من {summary.total}</span>
            <span className="tl-pill ok">ضمن التولرنس: <b>{summary.pass}</b></span>
            <span className="tl-pill bad">خارج التولرنس: <b>{summary.fail}</b></span>
            <span className="tl-pill tl-mono">avg ΔE {summary.avg.toFixed(2)} · max {summary.max.toFixed(2)}</span>
            <button type="button" className="tl-btn" style={{ marginInlineStart: 'auto' }} onClick={saveAll}>
              حفظ كل القراءات بالسجل
            </button>
          </section>
        )}

        {/* المنتجات */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {products.map((p, idx) => {
            const res = results[idx];
            const hexOk = parseHex(p.refHex);
            return (
              <article key={p.id} className="tl-card">
                <div className="tl-prod-head">
                  <label>
                    <span className="tl-label">اسم المنتج / الشيد</span>
                    <input
                      value={p.name}
                      onChange={(e) => updateProduct(p.id, { name: e.target.value })}
                      placeholder="Maybelline SuperStay 130"
                      className="tl-input"
                    />
                  </label>
                  <label>
                    <span className="tl-label">HEX الشركة</span>
                    <div className="tl-hexbox">
                      <input
                        value={p.refHex}
                        onChange={(e) => updateProduct(p.id, { refHex: e.target.value })}
                        placeholder="#B5343E"
                        className="tl-input tl-mono"
                        style={{ width: 120 }}
                      />
                      <span className="tl-dot" style={{ backgroundColor: hexOk || 'transparent' }} />
                    </div>
                  </label>
                  <label>
                    <span className="tl-label">الفنش</span>
                    <select
                      value={p.finish}
                      onChange={(e) => updateProduct(p.id, { finish: e.target.value })}
                      className="tl-select tl-input"
                    >
                      {FINISH_OPTIONS.map((f) => (
                        <option key={f} value={f}>{f || 'غير محدد'}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="tl-btn danger small" onClick={() => removeProduct(p.id)}>
                    حذف المنتج
                  </button>
                </div>

                <div style={{ marginTop: 14 }}>
                  <span className="tl-label">قراءات السبكترو (L, a, b). خذ 3 قراءات إذا تكدر</span>
                  {(() => {
                    const infos = p.readings.map((r) => readingInfo(r.text, p.refHex, settings.illuminant));
                    const des = infos.filter((i) => i && i.de !== null).map((i) => i.de);
                    const bestDe = des.length > 1 ? Math.min(...des) : null;
                    return p.readings.map((r, ri) => {
                      const ok = !r.text || parseLab(r.text);
                      const info = infos[ri];
                      const isBest = info && bestDe !== null && info.de === bestDe;
                      return (
                        <div key={r.id} className={`tl-reading ${r.hidden ? 'off' : ''}`}>
                          <span className="n">قراءة {ri + 1}</span>
                          <input
                            value={r.text}
                            onChange={(e) => updateReading(p.id, r.id, e.target.value)}
                            placeholder="41.2, 52.8, 28.1"
                            className="tl-input tl-mono"
                            style={ok ? undefined : { borderColor: '#f04438' }}
                          />
                          {info && (
                            <>
                              <span className="tl-rsw" style={{ backgroundColor: info.hex }} title={info.hex} />
                              {info.de !== null && (
                                <span className="tl-rde" style={{ color: info.de <= settings.tolerance ? '#067647' : '#b42318' }}>
                                  ΔE {info.de.toFixed(2)}
                                </span>
                              )}
                              {isBest && <span className="tl-best">الأقرب</span>}
                            </>
                          )}
                          <button
                            type="button"
                            className={`tl-icon sm ${r.hidden ? 'offbtn' : ''}`}
                            onClick={() => toggleReading(p.id, r.id)}
                            title={r.hidden ? 'إظهار القراءة بالحساب' : 'إخفاء القراءة من الحساب'}
                            aria-label={r.hidden ? 'إظهار القراءة' : 'إخفاء القراءة'}
                            aria-pressed={!r.hidden}
                          >
                            {r.hidden ? <EyeOffIcon /> : <EyeIcon />}
                          </button>
                          <button type="button" className="tl-x" onClick={() => removeReading(p.id, r.id)} aria-label="حذف القراءة">
                            ✕
                          </button>
                        </div>
                      );
                    });
                  })()}
                  <button type="button" className="tl-link" onClick={() => addReading(p.id)}>إضافة قراءة</button>
                  <p className="tl-hint">العين تخفي القراءة من الحساب وتضغطها مرة ثانية ترجعها. كل قراءة تظهر لونها وفرقها (ΔE) عن HEX الشركة حتى تعرف أي وحدة الأقرب.</p>
                </div>

                {res ? (
                  <>
                    <ResultView res={res} tolerance={settings.tolerance} />
                    <div className="tl-save" style={{ marginTop: 12 }}>
                      <button type="button" className="tl-btn" onClick={() => saveOne(p, res)}>حفظ هذي القراءة بالسجل</button>
                    </div>
                  </>
                ) : (
                  <div className="tl-empty">اكتب HEX صحيح وخلي قراءة واحدة على الأقل ظاهرة (مثال: 41.2, 52.8, 28.1) حتى تظهر النتيجة.</div>
                )}
              </article>
            );
          })}
        </section>

        {/* إضافة / استيراد */}
        <section>
          <div className="tl-row">
            <button type="button" className="tl-btn" onClick={() => setProducts((ps) => [...ps, newProduct()])}>إضافة منتج</button>
            <button type="button" className="tl-btn ghost" onClick={() => setShowImport((v) => !v)}>لصق جدول منتجات</button>
          </div>
          {showImport && (
            <div className="tl-card" style={{ marginTop: 12 }}>
              <p className="tl-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                كل سطر قراءة وحدة: الاسم، HEX، L، a، b (افصل بفاصلة أو Tab، تكدر تنسخهم من Excel). إذا تكرر نفس الاسم تُضاف القراءة لنفس المنتج.
              </p>
              <textarea
                rows={5}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={'Maybelline 130, #B5343E, 41.2, 52.8, 28.1\nMaybelline 130, #B5343E, 41.6, 53.1, 27.7'}
                className="tl-textarea tl-mono"
                style={{ marginBottom: 8 }}
              />
              <button type="button" className="tl-btn small" onClick={runImport}>استيراد</button>
            </div>
          )}
        </section>

        {/* السجل */}
        <section className="tl-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="tl-row" style={{ justifyContent: 'space-between' }}>
            <h2 className="tl-h2">سجل القراءات المحفوظة ({history.length})</h2>
            <div className="tl-row">
              <button type="button" className="tl-btn ghost small" onClick={exportCsv} disabled={!filtered.length}>تصدير CSV</button>
              <button
                type="button"
                className={`tl-btn danger small ${armClear ? 'armed' : ''}`}
                onClick={clearAll}
                disabled={!history.length}
              >
                {armClear ? 'اضغط مرة ثانية للتأكيد' : 'مسح السجل'}
              </button>
            </div>
          </div>

          <div className="tl-row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث باسم المنتج"
              className="tl-input"
              style={{ maxWidth: 280 }}
            />
            {[['all', 'الكل'], ['pass', 'ضمن التولرنس'], ['fail', 'خارج التولرنس']].map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={filter === k}
                onClick={() => setFilter(k)}
                className={`tl-chip ${filter === k ? 'on' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>

          {filtered.length ? (
            <div className="tl-table-wrap">
              <table className="tl-table">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>المنتج</th>
                    <th>HEX الشركة</th>
                    <th>القياس (L, a, b)</th>
                    <th>قراءات</th>
                    <th>ΔE</th>
                    <th>الحالة</th>
                    <th>السبب الأرجح</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((h) => (
                    <tr key={h.id}>
                      <td style={{ whiteSpace: 'nowrap', direction: 'ltr', textAlign: 'right' }}>{h.savedAt}</td>
                      <td style={{ fontWeight: 600 }}>{h.name}</td>
                      <td>
                        <span className="tl-mini"><i style={{ background: h.res.hex }} /><span className="tl-mono">{h.res.hex}</span></span>
                      </td>
                      <td>
                        <span className="tl-mini">
                          <i style={{ background: h.res.measHex }} />
                          <span className="tl-mono">
                            {h.res.meas.L.toFixed(1)}, {h.res.meas.a.toFixed(1)}, {h.res.meas.b.toFixed(1)}
                          </span>
                        </span>
                      </td>
                      <td>{h.res.n}</td>
                      <td className="tl-mono" style={{ fontWeight: 700, color: h.res.pass ? '#067647' : '#b42318' }}>
                        {h.res.de.toFixed(2)}
                      </td>
                      <td>
                        <span className={`tl-badge ${h.res.pass ? 'ok' : 'bad'}`} style={{ fontSize: 12, padding: '2px 10px' }}>
                          {h.res.pass ? 'ضمن' : 'خارج'}
                        </span>
                      </td>
                      <td style={{ maxWidth: 260, fontSize: 12 }}>{h.res.cause}</td>
                      <td>
                        <span className="tl-row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                          <button type="button" className="tl-icon" title="عرض التفاصيل" aria-label="عرض التفاصيل" onClick={() => setViewing(h)}>
                            <EyeIcon />
                          </button>
                          <button type="button" className="tl-icon del" title="حذف" aria-label="حذف" onClick={() => deleteSnap(h.id)}>
                            <TrashIcon />
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="tl-empty" style={{ borderTop: 'none', marginTop: 0 }}>
              {history.length
                ? 'ما في نتائج تطابق البحث أو الفلتر.'
                : 'السجل فارغ. اضغط "حفظ هذي القراءة بالسجل" تحت أي منتج حتى تظهر هنا.'}
            </div>
          )}
        </section>

        <footer className="tl-foot">
          المعادلة: CIEDE2000 (معيار CIE / ISO 11664-6). حدود التولرنس عرفية وليست جزء من المعيار. مرجع القراءة: ΔE ≤ 1
          غير ملحوظ تقريباً · 1 إلى 2 ملحوظ بالتدقيق · 2 إلى 3.5 ملحوظ · فوق 5 فرق واضح. السجل يُحفظ بمتصفحك.
        </footer>
      </div>

      {/* نافذة العين */}
      {viewing && (
        <div className="tl-overlay" onClick={() => setViewing(null)}>
          <div className="tl-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="tl-row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
              <div>
                <h3 className="tl-h2">{viewing.name}</h3>
                <div className="tl-hint" style={{ marginTop: 2 }}>
                  {viewing.savedAt} · إضاءة الجهاز {viewing.illuminant}
                  {viewing.finish ? ` · ${viewing.finish}` : ''}
                </div>
              </div>
              <button type="button" className="tl-x" onClick={() => setViewing(null)} aria-label="إغلاق">✕</button>
            </div>

            <ResultView res={viewing.res} tolerance={viewing.tolerance} />

            {viewing.readings.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <span className="tl-label">القراءات الأصلية</span>
                {viewing.readings.map((t, i) => (
                  <div key={i} className="tl-mono" style={{ fontSize: 13, color: '#4a3a2e' }}>
                    {i + 1}) {t}
                  </div>
                ))}
              </div>
            )}

            <div className="tl-row" style={{ justifyContent: 'flex-end', marginTop: 16, paddingTop: 12, borderTop: '1px solid #f1ebe5' }}>
              <button type="button" className="tl-btn ghost" onClick={() => loadBack(viewing)}>رجّعها للمحرر</button>
              <button type="button" className="tl-btn" onClick={() => setViewing(null)}>إغلاق</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="tl-toast">{toast}</div>}
    </div>
  );
}