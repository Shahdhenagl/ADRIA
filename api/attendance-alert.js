// =============================================================================
// ATTENDANCE ALERT  — يرسل صورة الموظف + اسمه ومعاد حضوره/انصرافه للمدير في تليجرام
// =============================================================================
// يستقبل من صفحة /attendance:
//   { name, jobTitle, action: 'check_in' | 'check_out', time, photo (dataURL/base64) }
// ويرسلها كصورة (sendPhoto) مع تعليق يحوي الاسم والوقت لكل مدير في TELEGRAM_CHAT_ID.
// =============================================================================

function formatCairo(value) {
  return new Date(value || Date.now()).toLocaleString('ar-EG', {
    timeZone: 'Africa/Cairo',
    dateStyle: 'full',
    timeStyle: 'medium',
  });
}

function buildCaption({ name, jobTitle, action, time }) {
  const isIn = action === 'check_in';
  const head = isIn ? '🟢 تسجيل حضور' : '🔴 تسجيل انصراف';
  const lines = [
    head,
    `الموظف: ${name || 'غير محدد'}`,
  ];
  if (jobTitle) lines.push(`الوظيفة: ${jobTitle}`);
  lines.push(`${isIn ? 'وقت الحضور' : 'وقت الانصراف'}: ${formatCairo(time)}`);
  return lines.join('\n').slice(0, 1000);
}

// يحوّل dataURL (data:image/jpeg;base64,....) أو base64 خام إلى Buffer
function decodePhoto(photo) {
  if (!photo || typeof photo !== 'string') return null;
  const comma = photo.indexOf(',');
  const b64 = photo.startsWith('data:') && comma !== -1 ? photo.slice(comma + 1) : photo;
  try {
    const buf = Buffer.from(b64, 'base64');
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

async function sendPhoto(token, chatId, buffer, caption) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', caption);
  form.append('photo', new Blob([buffer], { type: 'image/jpeg' }), 'attendance.jpg');
  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    body: form,
  });
  return res;
}

async function sendMessage(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: String(chatId), text }),
  });
  return res;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return res.status(200).json({ ok: false, skipped: true, error: 'Telegram env vars are missing' });
  }

  try {
    const payload = req.body || {};
    const caption = buildCaption(payload);
    const buffer = decodePhoto(payload.photo);

    const chatIds = String(chatId).split(',').map((s) => s.trim()).filter(Boolean);
    let ok = true;
    const results = [];
    for (const cid of chatIds) {
      // لو فيه صورة نبعتها بالتعليق، وإلا نبعت رسالة نصية فقط (fallback)
      const r = buffer
        ? await sendPhoto(token, cid, buffer, caption)
        : await sendMessage(token, cid, caption);
      if (!r.ok) ok = false;
      results.push(await r.json().catch(() => ({})));
    }
    return res.status(ok ? 200 : 502).json({ ok, results });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String(error) });
  }
}
