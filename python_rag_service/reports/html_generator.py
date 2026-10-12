"""HTMLReportGenerator: produces a self-contained, interactive HTML report for EPUB validation runs."""
import json
from datetime import datetime
from typing import List, Dict, Any


class HTMLReportGenerator:
    """
    Generates a fully self-contained HTML report with:
    - Dark teal theme (bg #0A2A35, accent #1A8A9A)
    - Inline CSS and JS (Chart.js from CDN for donut chart)
    - Dropdown navigation bar with 5 sections
    - Executive Summary with donut chart
    - Issues accordion with LLM/HITL badges
    - Pre/Post comparison table
    - HITL Queue table
    - Recommendations section
    """

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def generate(
        self,
        run_id: str,
        filename: str,
        validation_report: dict,
        triage_results: list,
        fix_results: dict,
        executive_summary: str,
        issue_narratives: dict,
        recommendations: str,
        fix_trace: list = None,
        hitl_suggestions: dict = None,
        diffs: list = None,
        report_mode: str = "full",
    ) -> bytes:
        """
        Render the HTML report and return UTF-8 bytes.

        report_mode: "validation" = issues + LLM suggestions only (no fix sections)
                     "full"       = complete report with pre/post comparison and fix details
        """
        fix_trace = fix_trace or []
        hitl_suggestions = hitl_suggestions or {}
        diffs = diffs or []
        is_full = report_mode != "validation"

        timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
        issues, summary = self._normalize_report(validation_report)

        # Derived counts
        total_issues = len(issues)
        llm_count = sum(1 for t in triage_results if t.get("routing") == "llm")
        hitl_count = sum(1 for t in triage_results if t.get("routing") == "hitl")
        fixed_count = fix_results.get("fixed_count", 0) if is_full else 0
        unfixed_count = fix_results.get("unfixable_count", 0) if is_full else 0

        # Build severity breakdown for donut chart
        severity_counts = self._count_by_key(issues, "severity")
        chart_labels = json.dumps(list(severity_counts.keys()))
        chart_data = json.dumps(list(severity_counts.values()))
        chart_colors = json.dumps(self._severity_colors(list(severity_counts.keys())))

        # Build HTML fragments
        issues_accordion_html = self._build_issues_accordion(
            issues, triage_results, issue_narratives
        )
        hitl_table_html = self._build_hitl_table(triage_results, issues, hitl_suggestions)
        recommendations_html = self._format_recommendations(recommendations)

        # Full-mode-only fragments
        if is_full:
            prepost_table_html = self._build_prepost_table(issues, triage_results, fix_results, fix_trace)
            fix_details_html = self._build_fix_details_section(fix_trace, hitl_suggestions, diffs, issues)
            has_fix_details = bool(fix_trace or hitl_suggestions)
            prepost_nav = '<button class="nav-btn" onclick="showSection(\'prepost\', this)">Pre / Post</button>'
            fix_details_nav = (
                '<button class="nav-btn" onclick="showSection(\'fixdetails\', this)">Fix Details</button>'
                if has_fix_details else ""
            )
        else:
            prepost_table_html = ""
            fix_details_html = ""
            has_fix_details = False
            prepost_nav = ""
            fix_details_nav = ""

        report_mode_badge = (
            '<span style="background:#1A4A2A;color:#50E890;padding:2px 8px;border-radius:3px;'
            'font-size:0.75rem;font-weight:700;">VALIDATION REPORT</span>'
            if not is_full else
            '<span style="background:#1A3A5A;color:#80C0F0;padding:2px 8px;border-radius:3px;'
            'font-size:0.75rem;font-weight:700;">FULL REPORT</span>'
        )

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>EPUB Quality Report — {self._escape(filename)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js"></script>
<style>
/* ===== RESET & BASE ===== */
*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
html {{ font-size: 16px; }}
body {{
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  background: #0A2A35;
  color: #E0EEF2;
  min-height: 100vh;
  line-height: 1.6;
}}

/* ===== NAVBAR ===== */
.navbar {{
  background: #051820;
  border-bottom: 2px solid #1A8A9A;
  padding: 0.75rem 1.5rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  position: sticky;
  top: 0;
  z-index: 100;
  flex-wrap: wrap;
}}
.navbar-brand {{
  font-size: 1.1rem;
  font-weight: 700;
  color: #1A8A9A;
  white-space: nowrap;
  margin-right: auto;
}}
.nav-btn {{
  background: transparent;
  border: 1px solid #1A8A9A;
  color: #A8D8E0;
  padding: 0.4rem 0.9rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}}
.nav-btn:hover, .nav-btn.active {{
  background: #1A8A9A;
  color: #fff;
}}

/* ===== SECTIONS ===== */
.section {{ display: none; padding: 2rem 1.5rem; max-width: 1200px; margin: 0 auto; }}
.section.visible {{ display: block; }}

/* ===== CARDS ===== */
.card {{
  background: #0E3545;
  border: 1px solid #1A5A6A;
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
}}
.card-title {{
  font-size: 1rem;
  font-weight: 600;
  color: #1A8A9A;
  margin-bottom: 1rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}}

/* ===== STAT CARDS ===== */
.stat-row {{
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.5rem;
}}
.stat-card {{
  background: #0E3545;
  border: 1px solid #1A5A6A;
  border-radius: 8px;
  padding: 1.25rem 1.5rem;
  flex: 1;
  min-width: 140px;
  text-align: center;
}}
.stat-number {{
  font-size: 2.5rem;
  font-weight: 700;
  color: #1A8A9A;
  line-height: 1;
}}
.stat-label {{
  font-size: 0.8rem;
  color: #7ABAC8;
  margin-top: 0.4rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}}
.stat-card.accent .stat-number {{ color: #E8A838; }}
.stat-card.danger .stat-number {{ color: #E85858; }}
.stat-card.success .stat-number {{ color: #38C878; }}

/* ===== CHART ===== */
.chart-row {{
  display: flex;
  gap: 2rem;
  align-items: flex-start;
  flex-wrap: wrap;
}}
.chart-wrap {{
  flex: 0 0 260px;
  max-width: 260px;
}}
.summary-text {{
  flex: 1;
  min-width: 220px;
  font-size: 0.95rem;
  color: #C0D8E0;
  line-height: 1.7;
}}
.chart-legend {{
  margin-top: 1rem;
  font-size: 0.8rem;
}}
.legend-item {{
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}}
.legend-dot {{
  width: 12px; height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}}

/* ===== BADGES ===== */
.badge {{
  display: inline-block;
  padding: 0.2em 0.55em;
  border-radius: 3px;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  vertical-align: middle;
}}
.badge-llm {{ background: #1A5A6A; color: #7ADEF0; }}
.badge-hitl {{ background: #5A1A1A; color: #F08A8A; }}
.badge-critical {{ background: #5A0000; color: #FF9090; }}
.badge-high {{ background: #5A2800; color: #FFA860; }}
.badge-medium {{ background: #4A4000; color: #F0D060; }}
.badge-low {{ background: #1A3A1A; color: #70C870; }}
.badge-info {{ background: #1A2A4A; color: #80A8F0; }}
.badge-fixed {{ background: #0A3A1A; color: #50E890; }}
.badge-unfixed {{ background: #3A0A0A; color: #F05050; }}

/* ===== ACCORDION ===== */
.accordion-group {{ margin-bottom: 0.75rem; }}
.accordion-header {{
  background: #0C3040;
  border: 1px solid #1A5A6A;
  border-radius: 6px;
  padding: 0.85rem 1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  user-select: none;
}}
.accordion-header:hover {{ background: #0E3A4A; }}
.accordion-title {{ font-weight: 600; font-size: 0.9rem; }}
.accordion-meta {{ font-size: 0.8rem; color: #7ABAC8; display: flex; gap: 0.5rem; align-items: center; }}
.accordion-arrow {{
  color: #1A8A9A;
  font-size: 1rem;
  transition: transform 0.2s;
}}
.accordion-header.open .accordion-arrow {{ transform: rotate(90deg); }}
.accordion-body {{
  display: none;
  background: #08202C;
  border: 1px solid #1A5A6A;
  border-top: none;
  border-radius: 0 0 6px 6px;
  overflow: hidden;
}}
.accordion-body.open {{ display: block; }}

/* ===== TABLES ===== */
.data-table {{
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}}
.data-table th {{
  background: #061C28;
  color: #1A8A9A;
  padding: 0.65rem 0.85rem;
  text-align: left;
  font-weight: 600;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 2px solid #1A5A6A;
  white-space: nowrap;
}}
.data-table td {{
  padding: 0.65rem 0.85rem;
  border-bottom: 1px solid #0E3040;
  vertical-align: top;
  color: #C0D8E0;
}}
.data-table tr:hover td {{ background: #0C2A38; }}
.data-table .mono {{ font-family: 'Courier New', monospace; font-size: 0.8rem; color: #80C8D8; }}
.narrative-cell {{ font-size: 0.82rem; color: #A8C8D4; font-style: italic; }}

/* ===== HITL TABLE ===== */
.hitl-reason {{ font-size: 0.82rem; color: #F0B060; }}

/* ===== RECOMMENDATIONS ===== */
.reco-list {{ list-style: none; counter-reset: reco-counter; }}
.reco-item {{
  counter-increment: reco-counter;
  display: flex;
  gap: 1rem;
  margin-bottom: 1.25rem;
  align-items: flex-start;
}}
.reco-num {{
  flex-shrink: 0;
  width: 2rem; height: 2rem;
  background: #1A8A9A;
  color: #fff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.9rem;
}}
.reco-text {{ font-size: 0.95rem; color: #C0D8E0; line-height: 1.6; padding-top: 0.2rem; }}

/* ===== FOOTER ===== */
.footer {{
  background: #051820;
  border-top: 1px solid #1A5A6A;
  padding: 1rem 1.5rem;
  font-size: 0.78rem;
  color: #4A7A88;
  display: flex;
  gap: 2rem;
  flex-wrap: wrap;
  margin-top: 2rem;
}}
.footer span {{ white-space: nowrap; }}

/* ===== EMPTY STATE ===== */
.empty-state {{
  text-align: center;
  padding: 3rem;
  color: #4A7A88;
  font-size: 0.95rem;
}}

/* ===== FIX DETAILS ===== */
.fix-card {{
  background: #08202C;
  border: 1px solid #1A5A6A;
  border-radius: 8px;
  margin-bottom: 1rem;
  overflow: hidden;
}}
.fix-card-header {{
  background: #0C3040;
  padding: 0.75rem 1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  user-select: none;
  gap: 0.75rem;
}}
.fix-card-header:hover {{ background: #0E3A4A; }}
.fix-card-title {{ font-weight: 600; font-size: 0.9rem; flex: 1; }}
.fix-card-meta {{ display: flex; gap: 0.5rem; align-items: center; flex-shrink: 0; }}
.fix-card-body {{ display: none; padding: 1.25rem; }}
.fix-card-body.open {{ display: block; }}
.fix-card-arrow {{ color: #1A8A9A; font-size: 0.9rem; transition: transform 0.2s; }}
.fix-card-header.open .fix-card-arrow {{ transform: rotate(90deg); }}

.fix-two-col {{
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  margin-bottom: 1rem;
}}
@media (max-width: 700px) {{ .fix-two-col {{ grid-template-columns: 1fr; }} }}

.fix-col-label {{
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #1A8A9A;
  margin-bottom: 0.6rem;
  border-bottom: 1px solid #1A5A6A;
  padding-bottom: 0.3rem;
}}
.fix-field {{ margin-bottom: 0.5rem; font-size: 0.85rem; }}
.fix-field .lbl {{ color: #7ABAC8; font-weight: 600; }}
.fix-field .val {{ color: #C0D8E0; }}
.fix-field code {{
  background: #061C28; color: #80D8E8;
  padding: 1px 5px; border-radius: 3px;
  font-size: 0.82rem; font-family: 'Courier New', monospace;
}}

.conf-high   {{ color: #38C878; font-weight: 700; }}
.conf-medium {{ color: #E8A838; font-weight: 700; }}
.conf-low    {{ color: #E85858; font-weight: 700; }}

.patch-block {{
  background: #040F16;
  border: 1px solid #1A4A5A;
  border-radius: 6px;
  padding: 0.75rem 1rem;
  font-family: 'Courier New', monospace;
  font-size: 0.82rem;
  color: #80D8E8;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
  margin-top: 0.35rem;
}}

.diff-section {{
  margin-top: 1rem;
  border-top: 1px solid #1A5A6A;
  padding-top: 1rem;
}}
.diff-hunk-label {{ font-size: 0.75rem; color: #7ABAC8; margin-bottom: 0.4rem; }}
.diff-cols {{ display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }}
@media (max-width: 700px) {{ .diff-cols {{ grid-template-columns: 1fr; }} }}
.diff-col-label {{
  font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
  margin-bottom: 0.3rem;
}}
.diff-before {{ color: #E88080; }}
.diff-after  {{ color: #80E880; }}
.diff-code {{
  background: #040F16; border: 1px solid #1A3A4A;
  border-radius: 4px; padding: 0.5rem 0.75rem;
  font-family: 'Courier New', monospace; font-size: 0.78rem;
  white-space: pre-wrap; word-break: break-all;
  max-height: 180px; overflow-y: auto;
}}
.diff-code.before {{ color: #E88080; border-color: #3A1A1A; }}
.diff-code.after  {{ color: #80E880; border-color: #1A3A1A; }}

.sample-list {{ list-style: none; margin: 0.35rem 0 0; }}
.sample-list li {{ font-size: 0.8rem; color: #A8C8D4; padding: 0.15rem 0; }}
.sample-list code {{ background: #061C28; color: #80D8E8; padding: 1px 4px; border-radius: 3px; font-size: 0.78rem; }}
</style>
</head>
<body>

<!-- NAVBAR -->
<nav class="navbar">
  <span class="navbar-brand">EPUB Quality Report &nbsp;{report_mode_badge}</span>
  <button class="nav-btn active" onclick="showSection('summary', this)">Executive Summary</button>
  <button class="nav-btn" onclick="showSection('issues', this)">Issues</button>
  {prepost_nav}
  {fix_details_nav}
  <button class="nav-btn" onclick="showSection('hitl', this)">Manual Review Queue</button>
  <button class="nav-btn" onclick="showSection('recommendations', this)">Recommendations</button>
</nav>

<!-- ===================== SECTION: EXECUTIVE SUMMARY ===================== -->
<section id="section-summary" class="section visible">
  <div class="stat-row">
    <div class="stat-card">
      <div class="stat-number">{total_issues}</div>
      <div class="stat-label">Total Issues</div>
    </div>
    <div class="stat-card accent">
      <div class="stat-number">{llm_count}</div>
      <div class="stat-label">AI Auto-Fix</div>
    </div>
    <div class="stat-card danger">
      <div class="stat-number">{hitl_count}</div>
      <div class="stat-label">Manual Review</div>
    </div>
    {'<div class="stat-card success"><div class="stat-number">' + str(fixed_count) + '</div><div class="stat-label">Fixed</div></div>' if is_full else ''}
    {'<div class="stat-card"><div class="stat-number">' + str(unfixed_count) + '</div><div class="stat-label">Unfixed</div></div>' if is_full else ''}
  </div>

  <div class="card">
    <div class="card-title">Summary</div>
    <div class="chart-row">
      <div class="chart-wrap">
        <canvas id="donutChart" width="260" height="260"></canvas>
        <div class="chart-legend" id="donut-legend"></div>
      </div>
      <div class="summary-text">
        {self._escape(executive_summary).replace(chr(10), '<br>')}
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">Issue Severity Breakdown</div>
    <table class="data-table">
      <thead><tr><th>Severity</th><th>Count</th><th>% of Total</th></tr></thead>
      <tbody>
        {self._build_severity_rows(severity_counts, total_issues)}
      </tbody>
    </table>
  </div>
</section>

<!-- ===================== SECTION: ISSUES ===================== -->
<section id="section-issues" class="section">
  <div class="card">
    <div class="card-title">Issues ({total_issues} total)</div>
    {issues_accordion_html if issues_accordion_html else '<div class="empty-state">No issues found.</div>'}
  </div>
</section>

{'<!-- ===================== SECTION: PRE / POST ===================== --><section id="section-prepost" class="section"><div class="card"><div class="card-title">Pre-Fix vs Post-Fix Status</div>' + prepost_table_html + '</div></section>' if is_full else ''}

{'<!-- ===================== SECTION: FIX DETAILS ===================== --><section id="section-fixdetails" class="section"><div class="card"><div class="card-title">Fix Details — Issue-by-Issue Analysis</div>' + (fix_details_html if has_fix_details else '<div class="empty-state">No fix data available.</div>') + '</div></section>' if is_full else ''}

<!-- ===================== SECTION: MANUAL REVIEW QUEUE ===================== -->
<section id="section-hitl" class="section">
  <div class="card">
    <div class="card-title">Manual Review Queue — Issues Requiring Human Review ({hitl_count})</div>
    {hitl_table_html if hitl_count > 0 else '<div class="empty-state">No issues flagged for human review.</div>'}
  </div>
</section>

<!-- ===================== SECTION: RECOMMENDATIONS ===================== -->
<section id="section-recommendations" class="section">
  <div class="card">
    <div class="card-title">Recommendations</div>
    {recommendations_html}
  </div>
</section>

<!-- FOOTER -->
<footer class="footer">
  <span>Run ID: <strong>{self._escape(run_id)}</strong></span>
  <span>File: <strong>{self._escape(filename)}</strong></span>
  <span>Generated: <strong>{timestamp}</strong></span>
  <span>EPUB Automation Agent Service v2.0</span>
</footer>

<!-- ===================== INLINE JAVASCRIPT ===================== -->
<script>
(function () {{
  'use strict';

  /* ---------- SECTION NAVIGATION ---------- */
  function showSection(name, btn) {{
    document.querySelectorAll('.section').forEach(function (s) {{
      s.classList.remove('visible');
    }});
    document.querySelectorAll('.nav-btn').forEach(function (b) {{
      b.classList.remove('active');
    }});
    var target = document.getElementById('section-' + name);
    if (target) target.classList.add('visible');
    if (btn) btn.classList.add('active');
  }}
  window.showSection = showSection;

  /* ---------- ACCORDION ---------- */
  function wireAccordion(selector) {{
    document.querySelectorAll(selector).forEach(function (header) {{
      header.addEventListener('click', function () {{
        var body = this.nextElementSibling;
        var isOpen = body && body.classList.contains('open');
        if (body) body.classList.toggle('open', !isOpen);
        this.classList.toggle('open', !isOpen);
      }});
    }});
  }}
  wireAccordion('.accordion-header');
  wireAccordion('.fix-card-header');

  /* ---------- DONUT CHART ---------- */
  var labels = {chart_labels};
  var data   = {chart_data};
  var colors = {chart_colors};

  if (labels.length > 0) {{
    var ctx = document.getElementById('donutChart').getContext('2d');
    new Chart(ctx, {{
      type: 'doughnut',
      data: {{
        labels: labels,
        datasets: [{{
          data: data,
          backgroundColor: colors,
          borderColor: '#0A2A35',
          borderWidth: 3,
          hoverOffset: 8
        }}]
      }},
      options: {{
        cutout: '65%',
        plugins: {{
          legend: {{ display: false }},
          tooltip: {{
            callbacks: {{
              label: function (ctx) {{
                var total = ctx.dataset.data.reduce(function(a,b){{return a+b;}}, 0);
                var pct = total > 0 ? Math.round(ctx.parsed / total * 100) : 0;
                return ctx.label + ': ' + ctx.parsed + ' (' + pct + '%)';
              }}
            }}
          }}
        }}
      }}
    }});

    // Build legend
    var legend = document.getElementById('donut-legend');
    labels.forEach(function (lbl, i) {{
      var item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = '<div class="legend-dot" style="background:' + colors[i] + '"></div>'
                     + '<span>' + lbl + ': ' + data[i] + '</span>';
      legend.appendChild(item);
    }});
  }}
}})();
</script>
</body>
</html>"""
        return html.encode("utf-8")

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize_report(validation_report: dict):
        """
        Normalise a validation_report dict coming from the Node.js validation service.

        The Node service sends:
          - results  (list)  instead of  issues
          - status   ("fail" | "warn" | "pass")  instead of  severity
          - id       (e.g. "A_MISSING_ALT")  with no explicit type/category

        Returns
        -------
        (issues_list, summary_dict)
        """
        # Accept either "results" or legacy "issues" key
        raw = validation_report.get("results", validation_report.get("issues", []))

        # Prefix → human-readable category mapping
        _prefix_map = {
            "A_": "Accessibility",
            "M_": "Metadata",
            "S_": "Structure",
            "T_": "Text Content",
            "L_": "Layout",
        }

        # status → severity mapping
        _status_severity = {
            "fail":  "high",
            "warn":  "medium",
            "error": "critical",
        }

        issues = []
        for item in raw:
            status = item.get("status", "")

            # Drop passing checks — they are not issues
            if status == "pass":
                continue

            # Build a normalised copy so we don't mutate the original
            norm = dict(item)

            # Derive severity from status if not already present
            if "severity" not in norm:
                norm["severity"] = _status_severity.get(status, "info")

            # Derive type from rule-ID prefix if not already present
            if "type" not in norm and "category" not in norm:
                rule_id = str(norm.get("id", ""))
                derived_type = "General"
                for prefix, label in _prefix_map.items():
                    if rule_id.startswith(prefix):
                        derived_type = label
                        break
                norm["type"] = derived_type

            issues.append(norm)

        # Build / repair summary
        summary = validation_report.get("summary", {})
        if not summary and issues:
            from collections import Counter
            sev_counts = Counter(i.get("severity", "info") for i in issues)
            summary = {
                "total": len(issues),
                "by_severity": dict(sev_counts),
            }

        return issues, summary

    @staticmethod
    def _escape(text: str) -> str:
        """HTML-escape a string."""
        if not text:
            return ""
        return (
            str(text)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&#39;")
        )

    @staticmethod
    def _count_by_key(items: list, key: str) -> dict:
        counts: Dict[str, int] = {}
        for item in items:
            val = str(item.get(key, "unknown"))
            counts[val] = counts.get(val, 0) + 1
        return counts

    @staticmethod
    def _severity_colors(labels: list) -> list:
        color_map = {
            "critical": "#E85858",
            "high":     "#E8A838",
            "medium":   "#E8D838",
            "low":      "#38C878",
            "info":     "#5888F0",
            "unknown":  "#7A9AAA",
        }
        return [color_map.get(lbl.lower(), "#7A9AAA") for lbl in labels]

    def _build_severity_rows(self, severity_counts: dict, total: int) -> str:
        rows = []
        color_map = {
            "critical": "#E85858", "high": "#E8A838",
            "medium": "#E8D838", "low": "#38C878",
            "info": "#5888F0",
        }
        for sev, count in sorted(severity_counts.items()):
            pct = round(count / total * 100, 1) if total > 0 else 0
            color = color_map.get(sev.lower(), "#7A9AAA")
            rows.append(
                f"<tr><td><span class='badge badge-{sev.lower()}'>{self._escape(sev)}</span></td>"
                f"<td style='color:{color};font-weight:700'>{count}</td>"
                f"<td>{pct}%</td></tr>"
            )
        return "\n".join(rows) if rows else "<tr><td colspan='3'>No data</td></tr>"

    def _build_issues_accordion(
        self,
        issues: list,
        triage_results: list,
        issue_narratives: dict,
    ) -> str:
        if not issues:
            return ""

        # Map issue_id → triage
        triage_map: Dict[str, dict] = {}
        for t in triage_results:
            iid = str(t.get("issue_id", t.get("id", "")))
            triage_map[iid] = t

        # Group by issue type / category (normalized 'type' takes precedence)
        groups: Dict[str, list] = {}
        for issue in issues:
            cat = str(issue.get("type") or issue.get("category") or "General")
            groups.setdefault(cat, []).append(issue)

        html_parts = []
        for cat, cat_issues in groups.items():
            llm_in_cat = sum(
                1 for i in cat_issues
                if triage_map.get(str(i.get("id", "")), {}).get("routing") == "llm"
            )
            hitl_in_cat = sum(
                1 for i in cat_issues
                if triage_map.get(str(i.get("id", "")), {}).get("routing") == "hitl"
            )

            rows = []
            for issue in cat_issues:
                iid = str(issue.get("id", ""))
                triage = triage_map.get(iid, {})
                routing = triage.get("routing", "")
                severity = issue.get("severity", "info")
                title = issue.get("title", issue.get("message", "Issue"))

                # location may be a dict {"file": ..., "line": ...} or a plain string
                _loc_raw = issue.get("location", issue.get("file", ""))
                if isinstance(_loc_raw, dict):
                    _loc_file = _loc_raw.get("file", "")
                    _loc_line = _loc_raw.get("line", "")
                    location = f"{_loc_file}:{_loc_line}" if _loc_line else _loc_file
                else:
                    location = str(_loc_raw)

                # narrative: prefer issue_narratives dict, then user_friendly fields
                narrative = issue_narratives.get(iid, "")
                if not narrative:
                    _uf = issue.get("user_friendly", {})
                    if isinstance(_uf, dict):
                        narrative = _uf.get("headline", _uf.get("summary", ""))
                    elif isinstance(_uf, str):
                        narrative = _uf

                routing_badge = (
                    f"<span class='badge badge-llm'>LLM</span>"
                    if routing == "llm"
                    else f"<span class='badge badge-hitl'>HITL</span>"
                    if routing == "hitl"
                    else ""
                )
                sev_badge = f"<span class='badge badge-{severity.lower()}'>{self._escape(severity)}</span>"

                rows.append(
                    f"<tr>"
                    f"<td class='mono'>{self._escape(iid)}</td>"
                    f"<td>{sev_badge}</td>"
                    f"<td>{self._escape(title)}</td>"
                    f"<td class='mono'>{self._escape(str(location))}</td>"
                    f"<td>{routing_badge}</td>"
                    f"<td class='narrative-cell'>{self._escape(narrative)}</td>"
                    f"</tr>"
                )

            table = (
                "<table class='data-table'>"
                "<thead><tr>"
                "<th>ID</th><th>Severity</th><th>Title</th>"
                "<th>Location</th><th>Routing</th><th>Explanation</th>"
                "</tr></thead><tbody>"
                + "\n".join(rows)
                + "</tbody></table>"
            )

            meta_badges = ""
            if llm_in_cat:
                meta_badges += f"<span class='badge badge-llm'>{llm_in_cat} LLM</span> "
            if hitl_in_cat:
                meta_badges += f"<span class='badge badge-hitl'>{hitl_in_cat} HITL</span>"

            html_parts.append(
                f"<div class='accordion-group'>"
                f"<div class='accordion-header'>"
                f"<span class='accordion-title'>{self._escape(cat)} "
                f"<small style='color:#7ABAC8'>({len(cat_issues)})</small></span>"
                f"<span class='accordion-meta'>{meta_badges}"
                f"<span class='accordion-arrow'>&#9654;</span></span>"
                f"</div>"
                f"<div class='accordion-body'>{table}</div>"
                f"</div>"
            )

        return "\n".join(html_parts)

    def _build_prepost_table(
        self,
        issues: list,
        triage_results: list,
        fix_results: dict,
        fix_trace: list = None,
    ) -> str:
        fix_trace = fix_trace or []
        triage_map: Dict[str, dict] = {
            str(t.get("issue_id", t.get("id", ""))): t for t in triage_results
        }
        fixes_map: Dict[str, dict] = {}
        for fix in fix_results.get("fixes", []):
            iid = str(fix.get("issue_id", fix.get("id", "")))
            fixes_map[iid] = fix
        trace_map: Dict[str, dict] = {
            str(t.get("issue_id", "")): t for t in fix_trace
        }

        if not issues:
            return "<div class='empty-state'>No issues to compare.</div>"

        rows = []
        for issue in issues:
            iid = str(issue.get("id", ""))
            triage = triage_map.get(iid, {})
            fix = fixes_map.get(iid, {})
            trace = trace_map.get(iid, {})
            severity = issue.get("severity", "info")
            title = issue.get("title", issue.get("message", "Issue"))
            routing = str(triage.get("routing", trace.get("routing", "-"))).lower()

            # Pre-fix location: prefer human-readable from fix_trace
            pre_loc = trace.get("pre_location", "")
            if not pre_loc:
                loc_raw = issue.get("location", issue.get("file", ""))
                if isinstance(loc_raw, dict):
                    _f = loc_raw.get("file", "").split("/")[-1]
                    _l = loc_raw.get("line", "")
                    pre_loc = f"{_f} line {_l}" if _l else _f
                else:
                    pre_loc = str(loc_raw)

            # Post-fix status
            applied = trace.get("applied", fix.get("fixable", False))
            if routing == "hitl":
                post_badge = "<span class='badge badge-hitl'>HITL</span>"
                fix_outcome = "Routed to Human Review"
            elif applied or fix.get("status") in ("fixed", "applied", "resolved"):
                post_badge = "<span class='badge badge-fixed'>Fixed</span>"
                fix_outcome = "Applied"
            else:
                post_badge = "<span class='badge badge-unfixed'>Unfixed</span>"
                fix_outcome = "Could not auto-fix"

            # Confidence
            conf = trace.get("confidence")
            conf_html = ""
            if conf is not None and routing != "hitl":
                if conf >= 80:
                    conf_html = f"<span class='conf-high'>{conf}%</span>"
                elif conf >= 50:
                    conf_html = f"<span class='conf-medium'>{conf}%</span>"
                else:
                    conf_html = f"<span class='conf-low'>{conf}%</span>"

            # Fix reason (short)
            fix_reason = self._escape(str(trace.get("fix_reason", triage.get("reason", "")))[:100])

            routing_badge = (
                "<span class='badge badge-llm'>AI Fix</span>" if routing == "llm"
                else "<span class='badge badge-hitl'>HITL</span>" if routing == "hitl"
                else "<span class='badge badge-fixed'>Auto</span>" if routing == "auto"
                else ""
            )

            rows.append(
                f"<tr>"
                f"<td class='mono'>{self._escape(iid)}</td>"
                f"<td><span class='badge badge-{severity.lower()}'>{self._escape(severity)}</span></td>"
                f"<td>{self._escape(title)}</td>"
                f"<td style='font-size:0.8rem;color:#A8C8D4'>{self._escape(pre_loc)}</td>"
                f"<td>{routing_badge}</td>"
                f"<td>{post_badge}</td>"
                f"<td>{conf_html}</td>"
                f"<td style='font-size:0.78rem;color:#7ABAC8;font-style:italic'>{fix_reason}</td>"
                f"</tr>"
            )

        return (
            "<table class='data-table'>"
            "<thead><tr>"
            "<th>ID</th><th>Severity</th><th>Issue</th>"
            "<th>Pre-Fix Location</th><th>Routing</th><th>Post-Fix</th>"
            "<th>Confidence</th><th>AI Reasoning</th>"
            "</tr></thead><tbody>"
            + "\n".join(rows)
            + "</tbody></table>"
        )

    def _build_hitl_table(self, triage_results: list, issues: list, hitl_suggestions: dict = None) -> str:
        hitl_items = [t for t in triage_results if t.get("routing") == "hitl"]
        if not hitl_items:
            return ""

        hitl_suggestions = hitl_suggestions or {}
        issues_map: Dict[str, dict] = {str(i.get("id", "")): i for i in issues}

        rows = []
        for t in hitl_items:
            iid = str(t.get("issue_id", t.get("id", "")))
            issue = issues_map.get(iid, {})
            title = issue.get("title", issue.get("message", t.get("title", "Unknown issue")))
            severity = issue.get("severity", "info")
            reason = t.get("reason", t.get("explanation", "Requires manual expert review"))
            complexity = t.get("complexity", "-")
            sg = hitl_suggestions.get(iid, {})
            sg_conf = sg.get("confidence")
            sg_patch = sg.get("patch", "")
            sg_reason = self._escape(str(sg.get("fix_reason", ""))[:100])
            has_sg = bool(sg_patch and sg_patch.upper() not in ("CANNOT_FIX", "NONE", ""))

            # Location: prefer pre_location from suggestion, then raw location
            location = sg.get("pre_location", "")
            if not location:
                loc_raw = issue.get("location", issue.get("file", "-"))
                if isinstance(loc_raw, dict):
                    _f = loc_raw.get("file", "").split("/")[-1]
                    _l = loc_raw.get("line", "")
                    location = f"{_f} line {_l}" if _l else _f
                else:
                    location = str(loc_raw)

            # AI suggestion badge
            if has_sg:
                conf_html = ""
                if sg_conf is not None:
                    if sg_conf >= 80:
                        conf_html = f" <span class='conf-high'>({sg_conf}%)</span>"
                    elif sg_conf >= 50:
                        conf_html = f" <span class='conf-medium'>({sg_conf}%)</span>"
                    else:
                        conf_html = f" <span class='conf-low'>({sg_conf}%)</span>"
                sg_cell = (
                    f"<span style='color:#50E890;font-weight:700'>AI Suggestion Ready</span>{conf_html}"
                    f"<div style='font-size:0.78rem;color:#7ABAC8;margin-top:0.25rem;font-style:italic'>{sg_reason}</div>"
                )
            else:
                sg_cell = "<span style='color:#F0B060'>Requires Manual Review</span>"

            rows.append(
                f"<tr>"
                f"<td class='mono'>{self._escape(iid)}</td>"
                f"<td><span class='badge badge-{severity.lower()}'>{self._escape(severity)}</span></td>"
                f"<td>{self._escape(title)}</td>"
                f"<td style='font-size:0.8rem;color:#A8C8D4'>{self._escape(location)}</td>"
                f"<td><span class='badge badge-info'>{self._escape(complexity)}</span></td>"
                f"<td class='hitl-reason'>{self._escape(str(reason)[:120])}</td>"
                f"<td>{sg_cell}</td>"
                f"</tr>"
            )

        return (
            "<table class='data-table'>"
            "<thead><tr>"
            "<th>ID</th><th>Severity</th><th>Issue</th>"
            "<th>Location</th><th>Complexity</th><th>Reason for Manual Review</th>"
            "<th>AI Suggestion</th>"
            "</tr></thead><tbody>"
            + "\n".join(rows)
            + "</tbody></table>"
        )

    def _build_fix_details_section(
        self,
        fix_trace: list,
        hitl_suggestions: dict,
        diffs: list,
        issues: list,
    ) -> str:
        """
        Build per-issue fix detail cards with exact location, confidence, LLM reasoning,
        and before/after code diffs. LLM-fixed issues come first, then HITL.
        """
        if not fix_trace and not hitl_suggestions:
            return ""

        issues_map: Dict[str, dict] = {str(i.get("id", "")): i for i in issues}
        trace_map: Dict[str, dict]  = {str(t.get("issue_id", "")): t for t in fix_trace}
        diffs_map: Dict[str, list]  = {}
        for d in diffs:
            key = d.get("file", "")
            diffs_map.setdefault(key, []).append(d)

        parts: list = []
        seen: set   = set()

        def _conf_badge(conf) -> str:
            if conf is None:
                return ""
            if conf >= 80:
                return f"<span class='badge' style='background:#0A3A1A;color:#50E890'>{conf}% HIGH</span>"
            if conf >= 50:
                return f"<span class='badge' style='background:#3A3000;color:#F0D060'>{conf}% MED</span>"
            return f"<span class='badge' style='background:#3A0000;color:#F08080'>{conf}% LOW</span>"

        def _status_badge(routing, applied) -> str:
            if routing == "hitl":
                return "<span class='badge badge-hitl'>MANUAL REVIEW</span>"
            if applied:
                return "<span class='badge badge-fixed'>FIXED</span>"
            return "<span class='badge badge-unfixed'>NOT FIXED</span>"

        def _routing_badge(routing) -> str:
            if routing == "llm":
                return "<span class='badge badge-llm'>AI Fix</span>"
            if routing == "auto":
                return "<span class='badge badge-fixed'>Auto</span>"
            if routing == "hitl":
                return "<span class='badge badge-hitl'>HITL</span>"
            return ""

        # Map rule-id prefixes to the file extension they live in,
        # used when issue.location.file is absent.
        _rule_file_ext = {
            "L_": ".css", "JS_": ".js",
            "A_HTML": ".xhtml", "A_LINK": ".xhtml", "A_IMAGE": ".xhtml",
            "IMG_": ".xhtml", "Media_": ".xhtml",
            "A_SCHEMA": ".opf",
            "M_": ".opf",
            "NCX_": ".ncx",
            "NAV_": ".xhtml",
            "S_MANIFEST": ".opf", "S_SPINE": ".opf",
            "MULTIPLE_": ".opf", "UNREFERENCED": ".opf",
            "S_BROKEN": ".xhtml", "T_": ".xhtml",
        }

        def _preferred_ext(rule_id: str) -> str:
            for prefix, ext in _rule_file_ext.items():
                if rule_id.startswith(prefix):
                    return ext
            return ""

        def _build_card(iid: str, trace: dict, sg: dict, issue: dict) -> str:
            routing  = str(trace.get("routing") or sg.get("routing") or "hitl").lower()
            applied  = trace.get("applied", False)
            conf     = trace.get("confidence") if routing != "hitl" else sg.get("confidence")
            reason   = trace.get("fix_reason") or sg.get("fix_reason") or ""
            # fix_value is the canonical field set by _build_trace; fall back to patch/sg
            fix_val  = (trace.get("fix_value") or trace.get("patch")
                        or (sg.get("patch", "") if routing == "hitl" else ""))
            model    = trace.get("model_used") or sg.get("model_used") or ""
            pre_loc  = trace.get("pre_location") or sg.get("pre_location") or ""
            title    = issue.get("title", issue.get("message", iid))
            severity = issue.get("severity", "info")

            # Build pre-fix location fallback
            if not pre_loc:
                loc_raw = issue.get("location", {})
                if isinstance(loc_raw, dict):
                    _f = loc_raw.get("file", "").split("/")[-1]
                    _l = loc_raw.get("line", "")
                    pre_loc = f"{_f} line {_l}" if _l else _f
                else:
                    pre_loc = str(loc_raw)

            # Samples for left panel
            details = issue.get("details", {})
            samples = details.get("samples", []) if isinstance(details, dict) else []
            count   = details.get("count", len(samples)) if isinstance(details, dict) else 0

            # --- Build erroneous-content snippet (pre-fix code block) ---
            pre_code_lines = []
            for s in samples[:5]:
                sp  = s.get("property", "")
                sv  = s.get("value", "")
                sxt = (s.get("excerpt") or s.get("text") or "").strip()
                sf  = s.get("file", "").split("/")[-1]
                sl  = s.get("line", "")
                loc_tag = f"  /* {sf}{(' line ' + str(sl)) if sl else ''} */" if sf else ""
                if sp and sv:
                    pre_code_lines.append(f"{sp}: {sv};{loc_tag}")
                elif sxt:
                    pre_code_lines.append(f"{sxt}{loc_tag}")
            pre_code_block = ""
            if pre_code_lines:
                pre_code_block = (
                    f"<div class='fix-field'><span class='lbl'>Erroneous content (before fix):</span>"
                    f"<div class='patch-block' style='border-left:3px solid #E85858;color:#F0A0A0'>"
                    f"{self._escape(chr(10).join(pre_code_lines))}"
                    f"</div></div>"
                )

            samples_html = ""
            if samples:
                items = []
                for s in samples[:5]:
                    sf   = self._escape(s.get("file", "").split("/")[-1])
                    sl   = self._escape(str(s.get("line", "")))
                    sp   = self._escape(s.get("property", ""))
                    sv   = self._escape(s.get("value", ""))
                    sxt  = self._escape((s.get("excerpt") or s.get("text") or "")[:80])
                    if sp and sv:
                        items.append(f"<li><code>{sf}</code> line {sl} &mdash; <code>{sp}: {sv}</code></li>")
                    elif sxt:
                        items.append(f"<li><code>{sf}</code> line {sl} &mdash; <code>{sxt}</code></li>")
                    else:
                        items.append(f"<li><code>{sf}</code> line {sl}</li>")
                samples_html = "<ul class='sample-list'>" + "".join(items) + "</ul>"

            # Left column — What was wrong (pre-fix state)
            left_html = (
                f"<div class='fix-col-label'>Before Fix</div>"
                f"<div class='fix-field'><span class='lbl'>Rule:</span> <span class='val'><code>{self._escape(iid)}</code></span></div>"
                f"<div class='fix-field'><span class='lbl'>Severity:</span> <span class='val'>"
                f"<span class='badge badge-{severity.lower()}'>{self._escape(severity)}</span></span></div>"
                f"<div class='fix-field'><span class='lbl'>Location:</span> <span class='val'>{self._escape(pre_loc)}</span></div>"
            )
            if count:
                left_html += f"<div class='fix-field'><span class='lbl'>Occurrences:</span> <span class='val'>{count}</span></div>"
            if pre_code_block:
                left_html += pre_code_block
            elif samples_html:
                left_html += f"<div class='fix-field'><span class='lbl'>Affected lines:</span>{samples_html}</div>"
            suggestion_note = issue.get("suggestion", "")
            if suggestion_note:
                left_html += f"<div class='fix-field'><span class='lbl'>Validator note:</span> <span class='val'>{self._escape(str(suggestion_note)[:200])}</span></div>"

            # Right column — After fix (post-fix state)
            _fix_display = fix_val if fix_val and fix_val.upper() not in ("CANNOT_FIX", "NONE", "—", "APPLIED", "") else ""
            right_html = ""
            if routing == "hitl":
                right_html += f"<div class='fix-col-label'>After Fix</div>"
                right_html += "<div class='fix-field' style='color:#A8C8D4'>Routed to Human Review — no automated fix applied.</div>"
                if conf is not None:
                    right_html += f"<div class='fix-field'><span class='lbl'>Confidence:</span> {_conf_badge(conf)}</div>"
                if model:
                    right_html += f"<div class='fix-field'><span class='lbl'>Model:</span> <span class='val' style='color:#7ABAC8'>{self._escape(model)}</span></div>"
                if _fix_display:
                    right_html += (
                        f"<div class='fix-field'><span class='lbl'>AI suggestion (for reviewer):</span>"
                        f"<div class='patch-block' style='border-left:3px solid #F0B060'>{self._escape(_fix_display)}</div></div>"
                    )
                else:
                    right_html += "<div class='fix-field' style='color:#F0B060'>No AI suggestion available. Manual review required.</div>"
                if reason:
                    right_html += f"<div class='fix-field'><span class='lbl'>AI reasoning:</span> <span class='val' style='font-style:italic'>{self._escape(reason)}</span></div>"
            elif applied:
                right_html += f"<div class='fix-col-label'>After Fix</div>"
                right_html += f"<div class='fix-field'><span class='lbl'>Engine:</span> <span class='val'>{self._escape(routing.upper())}</span></div>"
                if model:
                    right_html += f"<div class='fix-field'><span class='lbl'>Model:</span> <span class='val' style='color:#7ABAC8'>{self._escape(model)}</span></div>"
                if conf is not None:
                    right_html += f"<div class='fix-field'><span class='lbl'>Confidence:</span> {_conf_badge(conf)}</div>"
                if _fix_display:
                    right_html += (
                        f"<div class='fix-field'><span class='lbl'>Patch applied:</span>"
                        f"<div class='patch-block' style='border-left:3px solid #50E890;color:#A0F0C0'>{self._escape(_fix_display)}</div></div>"
                    )
                elif routing == "auto":
                    right_html += "<div class='fix-field' style='color:#50E890'>Fixed by deterministic Node.js pipeline.</div>"
                if reason:
                    right_html += f"<div class='fix-field'><span class='lbl'>Why this fix is correct:</span> <span class='val' style='font-style:italic'>{self._escape(reason)}</span></div>"
            else:
                right_html += f"<div class='fix-col-label'>After Fix</div>"
                right_html += "<div class='fix-field' style='color:#F0B060'>Could not be fixed automatically.</div>"
                if _fix_display:
                    right_html += (
                        f"<div class='fix-field'><span class='lbl'>Attempted patch:</span>"
                        f"<div class='patch-block' style='border-left:3px solid #888;color:#ccc'>{self._escape(_fix_display[:400])}</div></div>"
                    )
                if reason:
                    right_html += f"<div class='fix-field'><span class='lbl'>Reasoning:</span> <span class='val' style='font-style:italic'>{self._escape(reason)}</span></div>"

            # --- Diff section ---
            # Priority 1: find any diff hunk whose 'after' contains text from fix_val
            #   → the only reliable signal we're looking at the right change.
            # Priority 2: exact/partial file-path match from issue.location.
            # No extension-only fallback: matching "any .css file" produces wrong diffs
            #   when multiple CSS files are changed for different issues.
            diff_html = ""
            iss_file = ""
            loc_raw = issue.get("location", {})
            if isinstance(loc_raw, dict):
                iss_file = loc_raw.get("file", "")

            matching_diff = None
            content_matched_hunks = None  # pre-selected hunks from content search

            # Priority 1 — content match: look for a hunk whose 'after' contains fix text
            if _fix_display:
                fix_hint_content = _fix_display.strip().lower()[:50]
                if fix_hint_content:
                    for df in diffs:
                        if not df.get("changed"):
                            continue
                        for h in df.get("hunks", []):
                            if fix_hint_content in h.get("after", "").lower():
                                matching_diff = df
                                content_matched_hunks = [h]
                                break
                        if matching_diff:
                            break

            # Priority 2 — file-path match (only when content match found nothing)
            if not matching_diff and iss_file:
                for df in diffs:
                    if df.get("changed") and (
                        iss_file in df.get("file", "") or df.get("file", "") in iss_file
                    ):
                        matching_diff = df
                        break

            # No extension-only fallback: that maps multiple issues to the same wrong diff file

            if matching_diff and applied and routing != "hitl":
                # Use content-matched hunks if found; otherwise filter by fix text within the file
                if content_matched_hunks:
                    relevant_hunks = content_matched_hunks
                else:
                    all_hunks = matching_diff.get("hunks", [])
                    fix_hint = (_fix_display or "")[:60].lower()
                    # Only show hunks that actually contain the fix text; never fall back to
                    # showing all hunks (that would show an unrelated change from the same file)
                    relevant_hunks = [
                        h for h in all_hunks
                        if fix_hint and fix_hint[:20] in h.get("after", "").lower()
                    ][:3]

                if relevant_hunks:
                    hunk_parts = []
                    for h in relevant_hunks:
                        bl = h.get("before_lines", [0, 0])
                        al = h.get("after_lines", [0, 0])
                        before_code = self._escape(h.get("before", ""))
                        after_code  = self._escape(h.get("after", ""))
                        hunk_parts.append(
                            f"<div class='diff-hunk-label'>Lines {bl[0]}–{bl[1]} (before) &rarr; {al[0]}–{al[1]} (after)</div>"
                            f"<div class='diff-cols'>"
                            f"<div><div class='diff-col-label diff-before'>Before</div>"
                            f"<div class='diff-code before'>{before_code}</div></div>"
                            f"<div><div class='diff-col-label diff-after'>After</div>"
                            f"<div class='diff-code after'>{after_code}</div></div>"
                            f"</div>"
                        )
                    diff_html = (
                        f"<div class='diff-section'>"
                        f"<div class='fix-col-label' style='margin-bottom:0.75rem'>File diff — "
                        f"{self._escape(matching_diff.get('file','').split('/')[-1])}</div>"
                        + "".join(hunk_parts)
                        + "</div>"
                    )
                # If relevant_hunks is empty after filtering, fall through to synthetic diff below

            if not diff_html and applied and routing != "hitl" and _fix_display:
                # No file diff available — build a synthetic before/after from samples vs fix_val
                before_lines = chr(10).join(pre_code_lines) if pre_code_lines else "(original content not captured)"
                diff_html = (
                    f"<div class='diff-section'>"
                    f"<div class='fix-col-label' style='margin-bottom:0.75rem'>Before / After — {self._escape(iid)}</div>"
                    f"<div class='diff-cols'>"
                    f"<div><div class='diff-col-label diff-before'>Before</div>"
                    f"<div class='diff-code before'>{self._escape(before_lines)}</div></div>"
                    f"<div><div class='diff-col-label diff-after'>After</div>"
                    f"<div class='diff-code after'>{self._escape(_fix_display)}</div></div>"
                    f"</div></div>"
                )

            # --- Justification fields (explicit) ---
            justification_html = ""
            # Prefer explicit before/after justification keys if provided by agents
            jb = trace.get("justification_before") or trace.get("pre_explanation") or trace.get("kb_context") or ""
            ja = trace.get("justification_after") or trace.get("post_explanation") or trace.get("fix_reason") or ""
            if jb:
                justification_html += (
                    f"<div class='fix-field'><span class='lbl'>Why this was a problem (AI justification):</span>"
                    f"<div class='narrative-cell'>{self._escape(str(jb))}</div></div>"
                )
            if ja:
                justification_html += (
                    f"<div class='fix-field'><span class='lbl'>Why this fix is correct (AI justification):</span>"
                    f"<div class='narrative-cell'>{self._escape(str(ja))}</div></div>"
                )

            card_id = f"fix_{iid.replace(' ', '_')}"
            header_html = (
                f"<div class='fix-card-header' data-target='{card_id}'>"
                f"<span class='fix-card-arrow'>&#9654;</span>"
                f"<span class='fix-card-title'><code>{self._escape(iid)}</code> &mdash; {self._escape(title[:70])}</span>"
                f"<span class='fix-card-meta'>"
                f"<span class='badge badge-{severity.lower()}'>{self._escape(severity)}</span>"
                f" {_routing_badge(routing)} {_status_badge(routing, applied)}"
                f"{(' ' + _conf_badge(conf)) if conf is not None else ''}"
                f"</span>"
                f"</div>"
            )
            body_html = (
                f"<div class='fix-card-body' id='{card_id}'>"
                f"<div class='fix-two-col'>"
                f"<div>{left_html}</div>"
                f"<div>{right_html}</div>"
                f"</div>"
                f"{justification_html}"
                f"{diff_html}"
                f"</div>"
            )
            return f"<div class='fix-card'>{header_html}{body_html}</div>"

        # LLM-fixed issues first
        for trace in fix_trace:
            iid = str(trace.get("issue_id", ""))
            if not iid or iid in seen:
                continue
            seen.add(iid)
            issue = issues_map.get(iid, {"id": iid})
            parts.append(_build_card(iid, trace, hitl_suggestions.get(iid, {}), issue))

        # HITL issues with suggestions
        for iid, sg in hitl_suggestions.items():
            if iid in seen:
                continue
            seen.add(iid)
            issue = issues_map.get(iid, {"id": iid})
            parts.append(_build_card(iid, {}, sg, issue))

        if not parts:
            return "<div class='empty-state'>No fix detail data available.</div>"

        return "\n".join(parts)

    def _format_recommendations(self, recommendations: str) -> str:
        if not recommendations:
            return "<div class='empty-state'>No recommendations generated.</div>"

        lines = [l.strip() for l in recommendations.split("\n") if l.strip()]
        items = []
        num = 0
        for line in lines:
            # Strip leading numbering like "1." or "1)"
            import re
            clean = re.sub(r"^\d+[\.\)]\s*", "", line)
            if clean:
                num += 1
                items.append(
                    f"<li class='reco-item'>"
                    f"<div class='reco-num'>{num}</div>"
                    f"<div class='reco-text'>{self._escape(clean)}</div>"
                    f"</li>"
                )

        if not items:
            return "<div class='empty-state'>No recommendations generated.</div>"

        return f"<ul class='reco-list'>{''.join(items)}</ul>"
