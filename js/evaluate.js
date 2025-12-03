// api/evaluate.js
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "POST only" });
    }

    const { a, b } = req.body;
    if (!a || !b) {
      return res.status(400).json({ error: "Missing a or b" });
    }

    const AI_KEY = process.env.AI_STUDIO_KEY;
    if (!AI_KEY) {
      return res.status(500).json({ error: "Missing AI key on server" });
    }

    // Change model if needed based on your key's supported models
    const MODEL = "models/gemini-2.5-flash";

    // Build a prompt that includes the answers to be compared
    const prompt = `You are an expert relationship counselor and compatibility analyst.

You will be given two people's answers to 3 questions:

What does love mean to you?
What makes a relationship strong?
What is a deal-breaker for you?

Person A answers:
${typeof a === "string" ? a : JSON.stringify(a, null, 2)}

Person B answers:
${typeof b === "string" ? b : JSON.stringify(b, null, 2)}

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
    const payload = {
      // keep the payload simple: single user message containing the prompt
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.error("AI API error", r.status, text);
      return res.status(502).json({ error: "AI API error", details: text });
    }

    const json = await r.json();

    // Helper: collect any text fields found in the response recursively
    function collectText(obj, out = []) {
      if (!obj || typeof obj !== "object") return out;
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (typeof v === "string" && v.trim()) {
          out.push(v);
        } else if (Array.isArray(v)) {
          for (const item of v) collectText(item, out);
        } else if (typeof v === "object") {
          collectText(v, out);
        }
      }
      return out;
    }

    const textCandidates = collectText(json).join("\n\n");

    // Try to find the JSON object inside the textCandidates using a brace match
    let cleaned = textCandidates || JSON.stringify(json);

    // If the model wrapped output in triple backticks or other noise, strip it
    cleaned = cleaned.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();

    // Attempt to extract the first balanced JSON object from cleaned string
    function extractFirstJson(str) {
      const start = str.indexOf("{");
      if (start === -1) return null;
      let depth = 0;
      for (let i = start; i < str.length; i++) {
        const ch = str[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            return str.slice(start, i + 1);
          }
        }
      }
      return null;
    }

    let jsonText = extractFirstJson(cleaned);

    // If nothing found, as a last resort attempt a looser regex for { ... }
    if (!jsonText) {
      const loose = cleaned.match(/\{[\s\S]*\}/);
      jsonText = loose ? loose[0] : null;
    }

    let parsed;
    if (jsonText) {
      // Try to normalize some common issues before parsing
      let candidate = jsonText
        .replace(/\r\n/g, "\n")
        .replace(/\t/g, " ")
        // remove trailing commas before } or ]
        .replace(/,(\s*[}\]])/g, "$1");

      // Ensure keys are quoted: naive but helpful
      candidate = candidate.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":');

      try {
        parsed = JSON.parse(candidate);
      } catch (e) {
        // parsing failed - log for debugging and fall back
        console.error("JSON parse failed:", e.message, "candidate:", candidate.slice(0, 1000));
        parsed = null;
      }
    }

    // Ultimate fallback: if parsing failed, provide a safe default
    if (!parsed) {
      // Try to salvage a percentage number from the cleaned text
      const percentMatch = cleaned.match(/(\d{1,3})(?:\s*%| percent)?/i);
      const pct = percentMatch ? Math.min(100, Math.max(0, Number(percentMatch[1]))) : 50;
      parsed = {
        percentage: pct,
        message: "AI produced an unexpected format; fallback result used."
      };
    } else {
      // ensure types & defaults
      if (typeof parsed.percentage !== "number") {
        const n = Number(parsed.percentage);
        parsed.percentage = Number.isFinite(n) ? n : 50;
      }
      if (!parsed.message || typeof parsed.message !== "string") {
        parsed.message = "Compatibility evaluated.";
      }
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error("evaluate error:", err);
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
}
