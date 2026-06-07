/**
 * iRonic Health — AI Analysis API
 * Vercel Serverless Function
 * Secure proxy: holds Anthropic API key server-side
 */

const EN_PROMPT = `You are the iRonic Health AI fraud detection engine for Egyptian private health insurance claims.
Analyze the submitted claim and return ONLY valid JSON — no markdown, no backticks, no explanation outside JSON.

Required JSON schema:
{
  "fraud_score": <integer 0-100>,
  "risk_level": "low" | "medium" | "high",
  "decision": "auto_approve" | "cmo_review" | "auto_reject",
  "confidence": <integer 75-98>,
  "archetypes": [<fraud pattern names in English, empty array if none>],
  "risks": [<specific risk observations in English, max 4, empty if clean>],
  "clean": [<legitimacy indicators in English, max 2>],
  "rec": "<single English sentence CMO recommendation>",
  "summary": "<2-sentence English analysis summary>"
}

Thresholds: fraud_score < 30 = auto_approve | 30-69 = cmo_review | >= 70 = auto_reject

Egyptian fraud archetypes to evaluate:
Medical code upcoding | Phantom prescriptions | Duplicate billing | Doctor shopping |
Service bundling | Identity fraud | Excessive procedures | Inflated pharmacy billing |
Diagnosis-treatment mismatch | Service repetition in same period | Phantom admission`;

const AR_PROMPT = `أنت محرك كشف الاحتيال بالذكاء الاصطناعي لأيرونيك هيلث، متخصص في مطالبات التأمين الصحي المصري.
حلِّل المطالبة وأعِد JSON صالحًا فقط — بدون markdown وبدون شرح خارج JSON.

مخطط JSON المطلوب:
{
  "fraud_score": <عدد صحيح 0-100>,
  "risk_level": "low" | "medium" | "high",
  "decision": "auto_approve" | "cmo_review" | "auto_reject",
  "confidence": <عدد صحيح 75-98>,
  "archetypes": [<أسماء أنماط الاحتيال بالعربية، مصفوفة فارغة إن لم يوجد>],
  "risks": [<ملاحظات المخاطر بالعربية، حد أقصى 4، مصفوفة فارغة إن كانت نظيفة>],
  "clean": [<مؤشرات النظافة بالعربية، حد أقصى 2>],
  "rec": "<توصية واحدة للمدير الطبي بالعربية>",
  "summary": "<ملخص التحليل بجملتين بالعربية>"
}

حدود القرار: fraud_score < 30 = auto_approve | 30-69 = cmo_review | >= 70 = auto_reject

أنماط الاحتيال المصرية للفحص:
رفع مستوى التشفير الطبي | وصفات وهمية | فواتير مكررة | التسوق بين الأطباء |
تجميع الخدمات في فاتورة | احتيال الهوية | إجراءات مبالغ فيها | فواتير صيدلانية مضخمة |
تضارب التشخيص والعلاج | تكرار الخدمة في نفس الفترة | دخول وهمي للمستشفى`;

module.exports = async function handler(req, res) {
  /* ── CORS ───────────────────────────────────────────── */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    /* ── Parse body safely ──────────────────────────── */
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const { claim, language = 'en' } = body || {};

    if (!claim) return res.status(400).json({ error: 'Missing claim data' });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API key not configured' });

    const isAr   = language === 'ar';
    const prompt = isAr ? AR_PROMPT : EN_PROMPT;
    const msg    = isAr
      ? `حلِّل هذه المطالبة:\n${JSON.stringify(claim, null, 2)}`
      : `Analyze this claim:\n${JSON.stringify(claim, null, 2)}`;

    /* ── Call Anthropic ─────────────────────────────── */
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 900,
        system:     prompt,
        messages:   [{ role: 'user', content: msg }],
      }),
    });

    const raw = await anthropicRes.text();

    if (!anthropicRes.ok) {
      console.error('[Anthropic Error]', anthropicRes.status, raw);
      return res.status(500).json({ error: `Anthropic ${anthropicRes.status}`, detail: raw });
    }

    const data   = JSON.parse(raw);
    const text   = data.content?.[0]?.text || '{}';
    const clean  = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('[iRonic API Error]', err.message);
    return res.status(500).json({ error: 'Analysis failed', message: err.message });
  }
};
