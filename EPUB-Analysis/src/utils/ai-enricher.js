const { aiSuggestion } = require("./ai-suggest");
const AgentLogger = require("./agent-logger");
const {
  buildDeterministicIssueNarrative,
  buildDeterministicSuggestion,
} = require("./issue-language");

function aiSuggestionsEnabled(options = {}) {
  if (typeof options.enabled === "boolean") {
    return options.enabled;
  }

  return String(process.env.ENABLE_AI_SUGGESTIONS || "")
    .trim()
    .toLowerCase() === "true";
}

function readPositiveIntEnv(name, fallback) {
  const parsed = parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function applyUserFriendlyNarrative(rule = {}, guidance = null) {
  const deterministic = buildDeterministicIssueNarrative(rule);
  const narrative = guidance
    ? {
        headline: guidance.headline || deterministic.headline,
        summary: guidance.summary || deterministic.summary,
        impact: guidance.impact || deterministic.impact,
        nextStep: guidance.nextStep || deterministic.nextStep,
        location: deterministic.location,
        generatedBy: guidance.generatedBy || deterministic.generatedBy,
      }
    : deterministic;

  return {
    ...rule,
    user_friendly: narrative,
  };
}

function ensureSuggestion(rule = {}) {
  if (rule.status === "pass") {
    return rule;
  }

  if (rule.suggestion && String(rule.suggestion).trim()) {
    return rule;
  }

  return {
    ...rule,
    suggestion: buildDeterministicSuggestion(rule),
  };
}

async function enrichWithAISuggestions(results = [], options = {}) {
  const withDeterministicNarrative = results.map((rule) =>
    applyUserFriendlyNarrative(ensureSuggestion(rule))
  );

  if (!aiSuggestionsEnabled(options)) {
    return withDeterministicNarrative;
  }

  const maxAiSuggestions = readPositiveIntEnv("MAX_AI_SUGGESTION_RULES", 6);

  // Select up to maxAiSuggestions fail/warn rules to enrich
  const toEnrich = withDeterministicNarrative
    .filter((r) => r.status === "fail" || r.status === "warn")
    .slice(0, maxAiSuggestions);

  // Run all LLM enrichments in parallel instead of sequentially
  const enrichmentResults = await Promise.all(
    toEnrich.map(async (rule) => {
      try {
        const guidance = await Promise.race([
          aiSuggestion(rule),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("LLM timeout")), 8000)
          ),
        ]);
        AgentLogger.log("AGENT_REASONING", "AISuggestion", {
          ruleId: rule.id,
          suggestion: guidance.fixSuggestion,
          summary: guidance.summary,
          generatedBy: guidance.generatedBy,
        });
        return { id: rule.id, guidance };
      } catch (_err) {
        return { id: rule.id, guidance: null };
      }
    })
  );

  const guidanceMap = new Map(enrichmentResults.map((r) => [r.id, r.guidance]));

  return withDeterministicNarrative.map((originalRule) => {
    const guidance = guidanceMap.get(originalRule.id);
    if (!guidance) return originalRule;

    let rule = applyUserFriendlyNarrative({ ...originalRule }, guidance);

    if (guidance.generatedBy === "llm") {
      rule.ai_suggestion = guidance.fixSuggestion;
      if (!rule.suggestion || !rule.suggestion.trim()) {
        rule.suggestion = guidance.fixSuggestion;
      }
    } else if (!rule.suggestion || !rule.suggestion.trim()) {
      rule.suggestion = buildDeterministicSuggestion(originalRule);
    }

    return rule;
  });
}

module.exports = { enrichWithAISuggestions };
