// api/evaluate.js
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

    const { a, b } = req.body;
    if (!a || !b) return res.status(400).json({ error: "Missing a or b" });

    const AI_KEY = process.env.AI_STUDIO_KEY;
    if (!AI_KEY) return res.status(500).json({ error: "Missing AI key on server" });

    // Model / endpoint (change if needed)
    const MODEL = "models/gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1/${MODEL}:generateContent?key=${AI_KEY}`;

    // Controlled taxonomy of canonical relationship belief tags
    const TAXONOMY = [
      "trust",
      "honesty_transparency",
      "emotional_safety",
      "communication",
      "emotional_maturity",
      "effort_consistency",
      "need_for_space",
      "need_for_closeness",
      "boundaries",
      "respect",
      "loyalty_commitment",
      "family_goals",
      "lifestyle_match",
      "conflict_style",
      "supportiveness",
      "financial_values",
      "ambition_drive",
      "humor_playfulness"
    ];

    // Prompt asks the model to map each answer to tags from TAXONOMY and give brief explanations.
    const prompt = `You are an expert relationship counselor and compatibility analyst.
IMPORTANT: Output JSON ONLY (no markdown, no extra text). The JSON must have keys: tagsA, tagsB, explanationsA, explanationsB.
- tagsA and tagsB: arrays of canonical tags (choose zero or more) from this exact taxonomy: ${JSON.stringify(TAXONOMY)}.
- explanationsA and explanationsB: objects mapping each assigned tag to a 1-2 sentence explanation of why that tag applies to Person A / Person B's answers.
- DO NOT invent new tags. DO NOT output any fields other than the four required.
- DO NOT base tagging on word overlap. Map to the underlying beliefs, priorities, and emotional drivers revealed in the answers.
- Keep explanations short (max 30 words each).

Person A answers:
${typeof a === "string" ? a : JSON.stringify(a, null, 2)}

Person B answers:
${typeof b === "string" ? b : JSON.stringify(b, null, 2)}

Return only JSON like:
{
  "tagsA": ["trust","communication"],
  "tagsB": ["trust","emotional_safety"],
  "explanationsA": {"trust":"...","communication":"..."},
  "explanationsB": {"trust":"...","emotional_safety":"..."}
}
`;

    const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.error("AI API error", r.status, text);
      return res.status(502).json({ error: "AI API error", details: text });
    }

    const json = await r.json();

    // Collect possible text outputs
    function collectText(obj, out = []) {
      if (!obj || typeof obj !== "object") return out;
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (typeof v === "string" && v.trim()) out.push(v);
        else if (Array.isArray(v)) v.forEach(item => collectText(item, out));
        else if (typeof v === "object") collectText(v, out);
      }
      return out;
    }
    const textCandidates = collectText(json).join("\n\n") || JSON.stringify(json);

    // Strip code fences and extract first balanced JSON object
    let cleaned = textCandidates.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();

    function extractFirstJson(str) {
      const start = str.indexOf("{");
      if (start === -1) return null;
      let depth = 0;
      for (let i = start; i < str.length; i++) {
        const ch = str[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) return str.slice(start, i + 1);
        }
      }
      return null;
    }

    let jsonText = extractFirstJson(cleaned) || (cleaned.match(/\{[\s\S]*\}/) || [null])[0];

    let parsedTagsResp = null;
    if (jsonText) {
      // Normalize keys to quoted
      let candidate = jsonText.replace(/,(\s*[}\]])/g, "$1").replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":');
      try {
        parsedTagsResp = JSON.parse(candidate);
      } catch (e) {
        // parsing failed - keep null to fallback
        console.error("Failed parsing model JSON:", e.message);
      }
    }

    // Validate shape
    if (
      !parsedTagsResp ||
      !Array.isArray(parsedTagsResp.tagsA) ||
      !Array.isArray(parsedTagsResp.tagsB) ||
      typeof parsedTagsResp.explanationsA !== "object" ||
      typeof parsedTagsResp.explanationsB !== "object"
    ) {
      console.error("Model did not return expected tag shape. Raw:", cleaned.slice(0, 2000));
      // fallback generic neutral response
      return res.status(200).json({
        percentage: 50,
        message: "AI failed to extract thought-level tags reliably; fallback neutral score returned."
      });
    }

    // Normalize tags: keep only canonical tags and unique
    const normalize = arr =>
      Array.from(new Set((arr || []).map(t => String(t).trim()).filter(t => TAXONOMY.includes(t))));

    const tagsA = normalize(parsedTagsResp.tagsA);
    const tagsB = normalize(parsedTagsResp.tagsB);
    const explanationsA = parsedTagsResp.explanationsA || {};
    const explanationsB = parsedTagsResp.explanationsB || {};

    // Compute Jaccard-like similarity on sets of tags (if both empty -> fallback 50)
    const setA = new Set(tagsA);
    const setB = new Set(tagsB);
    const intersection = tagsA.filter(t => setB.has(t));
    const unionSize = new Set([...tagsA, ...tagsB]).size;

    let percentage;
    if (unionSize === 0) {
      percentage = 50; // no tags found => neutral
    } else {
      // Jaccard similarity scaled to 0-100
      percentage = Math.round((intersection.length / unionSize) * 100);
      // slight boost if both have roughly similar depth (similar counts)
      const countDiff = Math.abs(tagsA.length - tagsB.length);
      if (countDiff <= 1 && unionSize > 0) percentage = Math.min(100, percentage + 5);
    }

    // Build one-paragraph emotional message referencing thought-level alignment (use explanations)
    // Choose 2-3 strongest overlapping tags to mention, else cite notable differences.
    function pickOverlap() {
      if (intersection.length > 0) return intersection.slice(0, 3);
      // pick top tags from each (first two)
      const pick = [];
      if (tagsA[0]) pick.push(tagsA[0]);
      if (tagsB[0] && tagsB[0] !== tagsA[0]) pick.push(tagsB[0]);
      return pick;
    }

    const overlap = pickOverlap();
    let message = "";

    if (intersection.length > 0) {
      // create explanation snippets for up to 3 overlapping tags
      const expls = overlap.map(tag => {
        const ea = explanationsA[tag] ? explanationsA[tag] : "";
        const eb = explanationsB[tag] ? explanationsB[tag] : "";
        // prefer combined short phrase
        const combined = [ea, eb].filter(Boolean).join(" / ");
        return `${humanizeTag(tag)} (${combined || "shared focus"})`;
      });
      message = `Their answers align on ${expls.join(", ")} — showing shared underlying values and priorities; this thought-level overlap produced a compatibility score of ${percentage}.`;
    } else {
      // find a couple of contrasting tags to highlight
      const aTop = tagsA[0] ? `${humanizeTag(tagsA[0])}: ${explanationsA[tagsA[0]] || ""}` : null;
      const bTop = tagsB[0] ? `${humanizeTag(tagsB[0])}: ${explanationsB[tagsB[0]] || ""}` : null;
      const parts = [aTop, bTop].filter(Boolean);
      if (parts.length) {
        message = `Their core beliefs differ: ${parts.join(" ; ")} — this indicates different underlying priorities, which lowered the compatibility to ${percentage}.`;
      } else {
        message = `The responses did not map clearly to shared relationship values; the system gives a neutral compatibility of ${percentage}.`;
      }
    }

    // Return only the required JSON
    return res.status(200).json({ percentage, message });

    // helper to make tag human-friendly
    function humanizeTag(tag) {
      if (!tag) return tag;
      return tag
        .split("_")
        .map(s => s[0].toUpperCase() + s.slice(1))
        .join(" ");
    }
  } catch (err) {
    console.error("evaluate error:", err);
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
}
