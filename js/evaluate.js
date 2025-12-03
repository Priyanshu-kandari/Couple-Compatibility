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

What does love mean to you?

What makes a relationship strong?

What is a deal-breaker for you?

Your task:

Compare the thoughts, values, mindsets, emotional maturity, expectations, and relationship philosophy behind their answers — NOT similarity of words.

Identify emotional alignment vs emotional conflict.

Detect if their values complement each other or clash (trust, communication, loyalty, space, family goals, lifestyle, boundaries).

Determine if both partners share similar depth, seriousness, and understanding of relationships.

Evaluate red flags, unhealthy patterns, or mismatched expectations.

Analyze long-term compatibility potential based on thought process similarity, not phrase similarity.

Scoring:

90–100 → Exceptional alignment; deeply compatible

75–89 → Strong compatibility with minor differences

55–74 → Moderate compatibility; differences are workable

35–54 → Low compatibility; significant differences

0–34 → Very low compatibility; conflicting values

Output JSON ONLY (no backticks, no description, no extra words):

{
"percentage": number,
"message": "One-paragraph emotional explanation summarizing why this score was given, based on thought alignment rather than word similarity."
}
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
