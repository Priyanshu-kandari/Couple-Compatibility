// api/evaluate.js
// Pure thought-based comparison - analyzes underlying beliefs, not surface wording
// Integrates with your Couple Compatibility app

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

    const { a, b } = req.body;
    if (!a || !b) return res.status(400).json({ error: "Missing a or b" });

    const AI_KEY = process.env.AI_STUDIO_KEY;
    if (!AI_KEY) return res.status(500).json({ error: "Missing AI key on server" });

    const MODEL = "models/gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1/${MODEL}:generateContent?key=${AI_KEY}`;

    // Enhanced prompt specifically for relationship questions
    const prompt = `SYSTEM: You are an expert relationship psychologist analyzing compatibility between two partners based on DEEP UNDERLYING BELIEFS AND VALUES, completely ignoring surface-level word choices.

CRITICAL: Your analysis must focus on the MEANING and EMOTIONAL TRUTH behind their words, not the vocabulary they use. Two people can express the same core belief using completely different words, and that should result in HIGH compatibility.

Task: 
1. Extract the TRUE CORE BELIEFS from each person's three relationship answers:
   - What they fundamentally value in relationships
   - What emotional needs drive their behavior
   - What they fear or want to avoid
   - How they conceptualize love and partnership
   
2. Compare these beliefs at a SEMANTIC level to determine thought alignment

3. Output JSON ONLY (no markdown fences, no extra text)

Required JSON structure:
{
  "personA": {
    "coreBeliefs": ["belief statement", "belief statement"],
    "emotionalDrivers": ["what truly motivates them", "what they seek"],
    "relationshipPhilosophy": "one-sentence summary of their relationship worldview",
    "underlyingFears": ["fear 1", "fear 2"]
  },
  "personB": {
    "coreBeliefs": ["belief statement", "belief statement"],
    "emotionalDrivers": ["what truly motivates them", "what they seek"],
    "relationshipPhilosophy": "one-sentence summary of their relationship worldview",
    "underlyingFears": ["fear 1", "fear 2"]
  },
  "thoughtAlignment": {
    "sharedBeliefs": [
      {
        "beliefTheme": "brief theme",
        "howAExpressesIt": "their core thought",
        "howBExpressesIt": "their core thought",
        "whyItMatches": "why these thoughts align (20 words max)"
      }
    ],
    "divergentBeliefs": [
      {
        "beliefTheme": "brief theme",
        "personAView": "their underlying position",
        "personBView": "their underlying position",
        "tension": "what friction this creates (20 words max)"
      }
    ]
  },
  "compatibilityScore": 0-100,
  "analysisExplanation": "2-3 sentences explaining the score based purely on thought-level alignment or misalignment"
}

RULES (follow strictly):
- Focus on CONCEPTS and MEANINGS, never on word matching
- If Person A says "trust" and Person B says "honesty", recognize these may reflect the same underlying value
- If both emphasize commitment using different language, that's HIGH alignment
- If one values independence and the other values interdependence, that's a meaningful difference even if they both use the word "love"
- Empty arrays are acceptable if a category doesn't strongly apply
- Score should reflect: Do their fundamental relationship beliefs complement or clash?

Person A answers:
Q1: ${a.q1 || ""}
Q2: ${a.q2 || ""}
Q3: ${a.q3 || ""}

Person B answers:
Q1: ${b.q1 || ""}
Q2: ${b.q2 || ""}
Q3: ${b.q3 || ""}
`;

    const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const raw = await r.text().catch(() => "");
    let apiResp;
    try { apiResp = JSON.parse(raw); } catch (e) { apiResp = raw; }

    // Extract text from API response
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
    const textCandidates = (typeof apiResp === "string") ? apiResp : collectText(apiResp).join("\n\n");
    let cleaned = (textCandidates || "").replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();

    // Extract first balanced JSON
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
    const jsonText = extractFirstJson(cleaned) || (cleaned.match(/\{[\s\S]*\}/) || [null])[0];

    let parsed = null;
    if (jsonText) {
      let candidate = jsonText.replace(/,(\s*[}\]])/g, "$1").replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":');
      try { parsed = JSON.parse(candidate); } catch (e) { 
        parsed = { parseError: e.message }; 
      }
    }

    // Validate structure - adjusted for new field names
    const valid =
      parsed &&
      parsed.personA &&
      parsed.personB &&
      parsed.thoughtAlignment &&
      typeof parsed.compatibilityScore === "number" &&
      typeof parsed.analysisExplanation === "string";

    if (!valid) {
      if (process.env.DEV === "true") {
        return res.status(200).json({
          percentage: 50,
          message: "Model output not in expected shape; debug included.",
          debug: { rawApiResponse: apiResp, textCandidates, jsonText, parsed }
        });
      } else {
        return res.status(200).json({ 
          percentage: 50, 
          message: "Unable to analyze compatibility at this time." 
        });
      }
    }

    // Use AI-provided score with validation
    const percentage = Math.max(0, Math.min(100, Math.round(parsed.compatibilityScore)));
    
    // Build rich, natural message from thought analysis
    const shared = parsed.thoughtAlignment.sharedBeliefs || [];
    const divergent = parsed.thoughtAlignment.divergentBeliefs || [];
    
    // Start with AI's core explanation
    let message = parsed.analysisExplanation || "";
    
    // Add specific belief alignment examples (more natural flow)
    if (shared.length > 0) {
      const topShared = shared.slice(0, 2);
      const sharedText = topShared.map(s => 
        `Both value ${s.beliefTheme.toLowerCase()}: ${s.whyItMatches}`
      ).join(" ");
      message += ` ${sharedText}`;
    }
    
    // Add tension points if they exist
    if (divergent.length > 0 && percentage < 70) {
      const topDivergent = divergent[0];
      message += ` However, they differ on ${topDivergent.beliefTheme.toLowerCase()}: ${topDivergent.tension}`;
    }

    // Add emotional context based on score range
    if (percentage >= 80) {
      message += " This deep alignment suggests strong potential for mutual understanding.";
    } else if (percentage >= 60) {
      message += " These differences are workable with open communication.";
    } else if (percentage < 40) {
      message += " These core differences may require significant compromise.";
    }

    // Add debug info if requested
    const response = { percentage, message };
    if (process.env.DEV === "true") {
      response.debug = {
        personA: parsed.personA,
        personB: parsed.personB,
        thoughtAlignment: parsed.thoughtAlignment
      };
    }

    return res.status(200).json(response);
  } catch (err) {
    console.error("evaluate error:", err);
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
}