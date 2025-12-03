// api/evaluate.js
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

    const { a, b } = req.body;
    if (!a || !b) return res.status(400).json({ error: "Missing a or b" });

    const AI_KEY = process.env.AI_STUDIO_KEY;
    if (!AI_KEY) return res.status(500).json({ error: "Missing AI key on server" });

    // Use a model your key supports; change if your ListModels showed different model
    const MODEL = "models/gemini-2.5-flash";

    const prompt = `You are an expert relationship counselor and compatibility analyst.

You will be given two people's answers to 3 questions:
1. What does love mean to you?
2. What makes a relationship strong?
3. What is a deal-breaker for you?

Your task:
- Understand emotional depth, values, expectations, lifestyle choices, red flags, maturity level, and long-term compatibility.
- Compare how similar or different both partners are in each answer.
- Detect alignment vs conflict (e.g., one wants freedom, the other wants loyalty; one is expressive, the other is silent).
- Evaluate clarity, honesty, emotional intelligence, and relationship awareness.

Then produce a compatibility score from 0 to 100.

Score Guide:
- 90–100 → Exceptional alignment; long-term compatibility strong  
- 75–89 → Very compatible; minor differences  
- 55–74 → Moderate compatibility; requires communication  
- 35–54 → Low compatibility; major differences  
- 0–34 → Very low compatibility; conflicting values

Finally, output JSON ONLY (no backticks, no explanation).

STRICT JSON FORMAT:
{
  "percentage": number,
  "message": "one-paragraph emotional explanation summarizing why this score was given"
}

DO NOT include backticks, DO NOT include extra text outside JSON.
`;

    const url = `https://generativelanguage.googleapis.com/v1/${MODEL}:generateContent?key=${AI_KEY}`;
    const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const json = await r.json();

    // Try to extract model text (different responses possible)
    let text = null;
    try { text = json?.response?.text?.(); } catch (e) { /* ignore */ }
    if (!text) {
      if (json?.candidates && json.candidates[0]) text = json.candidates[0].content || JSON.stringify(json.candidates[0]);
      else text = JSON.stringify(json);
    }

    // sanitize & extract JSON object
    let cleaned = String(text).replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
    cleaned = cleaned.replace(/(['"])?([A-Za-z0-9_]+)\1\s*:/g, '"$2":'); // keys
    cleaned = cleaned.replace(/:\s*'([^']*)'/g, ': "$1"'); // single-quoted values
    cleaned = cleaned.replace(/'/g, '"');
    cleaned = cleaned.replace(/,(\s*[}\]])/g, "$1"); // trailing commas
    cleaned = cleaned.trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
      if (typeof parsed.percentage !== "number") parsed.percentage = Number(parsed.percentage) || 50;
      if (!parsed.message) parsed.message = "Compatibility evaluated.";
    } catch (e) {
      // fallback default
      parsed = { percentage: 50, message: "AI failed to produce valid output." };
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error("evaluate error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
