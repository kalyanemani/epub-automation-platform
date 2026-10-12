const { createTool } = require("@mastra/core/tools");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const AgentLogger = require("../../utils/agent-logger");

const PYTHON_API_URL = process.env.PYTHON_API_URL || "http://localhost:8001";

// Tool 1: Extract PDF Bounds
const extractPdfTool = createTool({
    id: "Extract-PDF-Tool",
    description: "Extract physical text bounding boxes, pagination, and structural content directly from a PDF file using PyMuPDF.",
    inputSchema: z.object({
        pdfPath: z.string().describe("The absolute path to the local physical PDF file.")
    }),
    outputSchema: z.any(),
    execute: async ({ context, input }) => {
        const { pdfPath } = input;
        console.log(`[Mastra/Extract-PDF] Sending extraction request for: ${pdfPath}`);
        
        if (!fs.existsSync(pdfPath)) {
            throw new Error(`PDF File not found at path: ${pdfPath}`);
        }

        const formData = new FormData();
        // Read file into Blob-like structure
        const fileContent = fs.readFileSync(pdfPath);
        const fileName = path.basename(pdfPath);
        formData.append("file", new Blob([fileContent], { type: 'application/pdf' }), fileName);

        const start = Date.now();
        const response = await fetch(`${PYTHON_API_URL}/extract-pdf`, {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            AgentLogger.log("ERROR", "Extract-PDF-Tool", { status: response.status, text: response.statusText });
            throw new Error(`Python API Error: ${response.statusText}`);
        }

        const data = await response.json();
        AgentLogger.logTool("Extract-PDF-Tool", { pdfPath }, { pages: data.pages?.length }, Date.now() - start);
        return data.pages; // Hand the physical layout chunks back to the Agent
    }
});

// Tool 2: Semantic Compare Matcher
const compareTextTool = createTool({
    id: "Semantic-Compare-Tool",
    description: "Calculates dense semantic similarity (BGE-M3) and fuzzy string Levenshtein distance between two blocks of text.",
    inputSchema: z.object({
        text1: z.string().describe("The first text block (often EPUB chunk)."),
        text2: z.string().describe("The second text block (often PDF chunk).")
    }),
    outputSchema: z.any(),
    execute: async ({ context, input }) => {
        const { text1, text2 } = input;
        
        const start = Date.now();
        const response = await fetch(`${PYTHON_API_URL}/compare`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ text1, text2 })
        });

        if (!response.ok) {
            AgentLogger.log("ERROR", "Semantic-Compare-Tool", { status: response.status });
            throw new Error(`Python API Compare Error: ${response.statusText}`);
        }

        const data = await response.json();
        AgentLogger.logTool("Semantic-Compare-Tool", { text1: text1.slice(0, 50), text2: text2.slice(0, 50) }, data.comparison, Date.now() - start);
        return data.comparison; // Returns { semantic_similarity, fuzzy_similarity } object
    }
});

module.exports = {
    extractPdfTool,
    compareTextTool
};
