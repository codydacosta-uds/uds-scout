import { readFileSync, writeFileSync } from "node:fs";

const summary = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8"));
const percentage = Math.floor(summary.total.lines.pct);
const label = "policy coverage";
const value = `${percentage}%`;
const color = percentage >= 80 ? "#2c974b" : percentage >= 70 ? "#d6a514" : "#c9372c";
const labelWidth = 102;
const valueWidth = 48;
const width = labelWidth + valueWidth;
const escapeXml = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(label)}: ${escapeXml(value)}" width="${width}" height="20"><title>${escapeXml(label)}: ${escapeXml(value)}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-opacity=".08"/></linearGradient><clipPath id="r"><rect width="${width}" height="20" rx="3"/></clipPath><g clip-path="url(#r)"><rect width="${labelWidth}" height="20" fill="#3f444d"/><rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/><rect width="${width}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text><text x="${labelWidth / 2}" y="14">${label}</text><text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text><text x="${labelWidth + valueWidth / 2}" y="14">${value}</text></g></svg>\n`;
writeFileSync("public/coverage.svg", svg);
console.log(`Updated public/coverage.svg to ${percentage}% line coverage.`);
