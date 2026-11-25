const fs = require("node:fs");
const path = require("node:path");

const templatePath = path.join(__dirname, "template.html");
const pagesDir = path.join(__dirname, "pages");

const template = fs.readFileSync(templatePath, "utf8");

function updateHtmlFiles(directory) {
  const files = fs.readdirSync(directory, { withFileTypes: true });

  for (const file of files) {
    const filePath = path.join(directory, file.name);

    if (file.isDirectory()) {
      updateHtmlFiles(filePath);
    } else if (
      file.isFile() &&
      path.extname(file.name).toLowerCase() === ".html"
    ) {
      const existing = fs.readFileSync(filePath, "utf8");
      if (existing.trim()) {
        console.log(`Skipped existing page: ${filePath}`);
        continue;
      }
      fs.writeFileSync(filePath, template, "utf8");
      console.log(`Updated: ${filePath}`);
    }
  }
}

updateHtmlFiles(pagesDir);

console.log("All HTML files updated successfully!");
