const path = require("path");

const { getKbRoot, loadAllowlist, loadManifest } = require("./kb-config");

function countBy(values = []) {
  return values.reduce((summary, value) => {
    const key = String(value || "unknown").trim() || "unknown";
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});
}

function summarizeKnowledgeBases(manifest = loadManifest()) {
  const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
  const vectorSources = sources.filter((source) => source.vector_index === true);
  const lookupOnlySources = sources.filter((source) => source.lookup_only === true);
  const authoritativeSources = sources.filter((source) =>
    ["official-spec", "official-guidance", "official-tool"].includes(source.source_type)
  );
  const internalSources = sources.filter((source) =>
    String(source.source_type || "").startsWith("internal")
  );

  return {
    totalSources: sources.length,
    vectorIndexedSources: vectorSources.length,
    lookupOnlySources: lookupOnlySources.length,
    authoritativeSources: authoritativeSources.map((source) => source.id),
    internalSources: internalSources.map((source) => source.id),
    categories: countBy(sources.map((source) => source.category)),
    sourceTypes: countBy(sources.map((source) => source.source_type)),
  };
}

function getAutomationStrategy() {
  const manifest = loadManifest();
  const allowlist = loadAllowlist();

  return {
    architecture: {
      pattern: "hierarchical_supervisor_with_selective_parallelism",
      orchestrator: {
        role: "Owns global state, file dependency awareness, HITL routing, and final merge decisions.",
        implementation: [
          "src/rag/agentic-orchestrator.js",
          "src/rag/index.js",
          "server.js",
        ],
      },
      specialists: [
        {
          agent: "structure_navigation_specialist",
          scope: ["OPF", "manifest", "spine", "NAV", "NCX", "packaging"],
          defaultFixMode: "deterministic",
        },
        {
          agent: "css_layout_specialist",
          scope: ["shared stylesheets", "layout rules", "pagination", "rendering defects"],
          defaultFixMode: "rag_assisted_plus_verifier",
        },
        {
          agent: "accessibility_specialist",
          scope: ["A11y metadata", "landmarks", "alt text", "semantic structure"],
          defaultFixMode: "rag_assisted_plus_hitl",
        },
        {
          agent: "text_integrity_specialist",
          scope: ["OCR drift", "hyphenation", "missing/incorrect text"],
          defaultFixMode: "few_shot_rag_plus_policy_gate",
        },
        {
          agent: "javascript_behavior_specialist",
          scope: ["script reachability", "lifecycle risk", "unsupported APIs", "reading-system constraints"],
          defaultFixMode: "analysis_first_hitl_biased",
        },
      ],
      verifier: {
        role: "Scores correctness, regression risk, and release readiness before auto-apply.",
        implementation: [
          "src/utils/validator-agent.js",
          "src/rag/post-fix-verifier.js",
        ],
      },
    },
    memoryStrategy: {
      shortTerm: {
        store: "in_process_request_state",
        implementedBy: [
          "validateEpub()/validatePdf() request scope",
          "upload index payload",
        ],
        recommendedScaleOut: "Redis with TTL when jobs become distributed.",
      },
      episodic: {
        store: "JSON run log plus agent event history",
        implementedBy: [
          "storage_data/runs.json",
          "storage_data/logs.json",
          "kb/agentic_refresh_state.json",
        ],
        upgradePath: "Postgres append-only event store with session_id and event_index.",
      },
      semantic: {
        store: "rule registry plus manifest plus structured KB relationships",
        implementedBy: [
          "kb/internal/rules/rule-registry.json",
          "kb/manifest.json",
        ],
        upgradePath: "Neo4j or Postgres graph extension when 3+ hop traversal becomes necessary.",
      },
      longTerm: {
        store: "verified examples and protected-pattern corpora",
        implementedBy: [
          "kb/internal/examples/gold-corrections.jsonl",
          "kb/internal/examples/manual-review-cases.jsonl",
          "kb/internal/examples/false-positive-log.jsonl",
        ],
        upgradePath: "pgvector or Qdrant fix-pattern store with approval-rate feedback.",
      },
      cag: {
        strategy: "compile authoritative EPUB, WCAG, and reading-system guidance into a reusable prefix policy",
        currentInputs: [
          "kb/manifest.json",
          "kb/internal/rules/rule-registry.json",
          "source-allowlist.json",
        ],
        recommendedCache: "Redis or provider prompt-cache with byte-identical prefix assembly.",
      },
    },
    ragStrategy: {
      retrieval: {
        current: "local hybrid lexical chunk search over KB plus per-upload structured chunk index",
        chunking: {
          html: "heading-aware and block-aware chunks with section carry-over search context",
          text: "paragraph chunks with sentence-preserving splits",
          recommendationForCss: "chunk per selector block and include neighboring rule context",
          recommendationForJs: "AST-level chunking by function/module boundary",
        },
        ranking: "token overlap and metadata-aware ranking in src/rag/search-scoring.js",
      },
      augmentation: {
        current: "issue-aware evidence planning plus optional external snapshot refresh",
        recommendation:
          "Only pass the affected file, local neighbors, top KB evidence, and top upload evidence into the LLM context.",
      },
      generation: {
        current: "structured suggestion generation with remote/local fallback and diagnostics",
        recommendation:
          "Prefer deterministic fixers first, then bounded structured LLM outputs, then HITL for ambiguous or high-blast-radius edits.",
      },
      embeddings: {
        currentPythonModel:
          process.env.RAG_EMBEDDING_MODEL || "BAAI/bge-m3 or best cached sentence-transformer model",
        currentNodeStrategy: "structured lexical retrieval without persistent vectors",
        recommendation:
          "Use BGE-M3 or text-embedding-3-large for future vector indexes, normalized embeddings, and metadata-filtered search.",
      },
    },
    evaluationStrategy: {
      staticValidation: [
        "EPUBCheck parity",
        "XML/OPF/NAV schema integrity",
        "CSS/JS parse validation before accepting fixes",
      ],
      runtimeValidation: [
        "rendering/layout regression checks",
        "accessibility checklist and landmark integrity",
        "post-fix verification rerun",
      ],
      ragQuality: [
        "retrieval hit rate",
        "top-score quality",
        "grounding coverage status",
        "generation success and fallback rate",
      ],
      hitlCalibration: [
        "human review rate",
        "low-confidence rate",
        "approval-rate promotion into long-term fix memory",
      ],
    },
    tokenOptimization: {
      strategies: [
        "send only affected file and neighboring evidence, not the whole book",
        "compress episodic events into digests before prompt inclusion",
        "favor structured JSON outputs over long free-text reasoning",
        "reuse static policy/context through CAG or prompt caching",
      ],
    },
    testingStrategy: {
      unit: [
        "chunking logic",
        "search ranking",
        "rule policy routing",
        "human-readable report annotation",
      ],
      integration: [
        "validation to report pipeline",
        "upload index to retrieval pipeline",
        "autofix to post-fix verification pipeline",
      ],
      regression: [
        "gold correction cases",
        "false positive cases",
        "manual review edge cases",
      ],
      futureGoldenSet: [
        "CSS pagination break corpus",
        "reading-system compatibility corpus",
        "script lifecycle and unsupported API corpus",
      ],
    },
    knowledgeBases: {
      root: getKbRoot(),
      allowlistDefaultPolicy: allowlist.default_policy || "deny",
      summary: summarizeKnowledgeBases(manifest),
      cssAndJsPrioritySources: [
        "w3c-epub-rs-33",
        "w3c-css-snapshot-2025",
        "sprint2-layout-rules",
        "sprint2-script-rules",
        "epubcheck-repo",
        "internal-gold-corrections",
        "internal-manual-review",
      ],
      nextKbsToAdd: [
        "reading-system-specific CSS/JS quirk matrix",
        "curated fixed-layout and reflowable rendering regression corpus",
        "human-approved CSS/JS fix-pattern vector collection",
      ],
    },
    documentation: {
      strategyDoc: path.join(process.cwd(), "EPUB_Automation_Strategy.md"),
    },
  };
}

module.exports = {
  getAutomationStrategy,
  summarizeKnowledgeBases,
};
