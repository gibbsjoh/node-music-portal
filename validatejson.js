// validateJSON.js

const fs = require('fs');
const path = require('path');

const fileName = 'stations.json'; // or replace with process.argv[2] to make it dynamic
const filePath = path.join(__dirname, fileName);

try {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);

  console.log(`✅ ${fileName} is valid JSON.`);

  // Optional: log summary
  const entries = Object.keys(data);
  console.log(`Found ${entries.length} stations:`);
  entries.slice(0, 5).forEach(id => {
    const s = data[id];
    console.log(`  - [${id}] ${s.stationName}`);
  });

} catch (err) {
  console.error(`❌ Error parsing ${fileName}:`);
  console.error(err.message);
  process.exit(1);
}
