/**
 * Generate stylesheet.css for EPUB
 * @returns {string} CSS content
 */
function generateStylesheet() {
    return `/* EPUB Stylesheet */

/* Reset and base styles */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: Georgia, serif;
  font-size: 1em;
  line-height: 1.6;
  text-align: justify;
  margin: 1em;
}

/* Typography */
h1, h2, h3, h4, h5, h6 {
  font-family: Arial, Helvetica, sans-serif;
  font-weight: bold;
  line-height: 1.3;
  margin-top: 1em;
  margin-bottom: 0.5em;
  text-align: left;
}

h1 {
  font-size: 2em;
}

h2 {
  font-size: 1.5em;
}

h3 {
  font-size: 1.25em;
}

/* Paragraphs */
p {
  margin-bottom: 0.5em;
}

p.noindent {
  text-indent: 0;
}

p.indent {
  text-indent: 1.5em;
}

/* Chapter styles */
.chapter-title {
  font-size: 1.8em;
  margin-top: 2em;
  margin-bottom: 1em;
  text-align: center;
}

/* Cover and title page */
.cover-image {
  text-align: center;
  margin: 0;
  padding: 0;
}

.cover-image img {
  max-width: 100%;
  height: auto;
}

.title-page {
  text-align: center;
  margin-top: 3em;
}

.title-page .title {
  font-size: 2.5em;
  margin-bottom: 1em;
}

.title-page .author {
  font-size: 1.5em;
  font-style: italic;
  margin-top: 2em;
}

/* Images */
img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1em auto;
}

/* Lists */
ol, ul {
  margin: 1em 0;
  padding-left: 2em;
}

ol.none {
  list-style-type: none;
  padding-left: 0;
}

ol.ol {
  list-style-type: decimal;
}

li {
  margin-bottom: 0.5em;
}

/* Navigation */
nav {
  margin: 2em 0;
}

nav h1, nav h2 {
  margin-bottom: 1em;
}

nav ol {
  list-style-type: none;
  padding-left: 0;
}

nav li {
  margin-bottom: 0.5em;
}

nav a {
  text-decoration: none;
  color: #0066cc;
}

nav a:hover {
  text-decoration: underline;
}

/* Page breaks */
[epub\\:type~="pagebreak"] {
  display: none;
}

/* Accessibility */
[hidden] {
  display: none;
}

/* Text formatting */
em, i {
  font-style: italic;
}

strong, b {
  font-weight: bold;
}

/* Sections */
section {
  margin-bottom: 2em;
}

header {
  margin-bottom: 1em;
}
`;
}

module.exports = {
    generateStylesheet
};
