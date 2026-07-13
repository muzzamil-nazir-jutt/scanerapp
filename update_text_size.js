const fs = require('fs');
const appJsPath = '/home/muzzamil/Desktop/scan/mobile/App.js';
let appJs = fs.readFileSync(appJsPath, 'utf8');

// Update Selectable property on the Text components in Details view
appJs = appJs.replace(
  /<Text style=\{styles\.detailsAssetCode\}>/g,
  '<Text style={styles.detailsAssetCode} selectable={true}>'
);
appJs = appJs.replace(
  /<Text style=\{styles\.detailsName\}>/g,
  '<Text style={styles.detailsName} selectable={true}>'
);
appJs = appJs.replace(
  /<Text style=\{styles\.sectionValue\}>/g,
  '<Text style={styles.sectionValue} selectable={true}>'
);
appJs = appJs.replace(
  /<Text style=\{styles\.descriptionText\}>/g,
  '<Text style={styles.descriptionText} selectable={true}>'
);
appJs = appJs.replace(
  /<Text key=\{block\.id\} style=\{styles\.detailsBlockText\}>/g,
  '<Text key={block.id} style={styles.detailsBlockText} selectable={true}>'
);

appJs = appJs.replace(
  /\{asset\.specs \? <Text style=\{styles\.detailsBlockText\}>/g,
  '{asset.specs ? <Text style={styles.detailsBlockText} selectable={true}>'
);
appJs = appJs.replace(
  /\{asset\.background \? <Text style=\{styles\.detailsBlockText\}>/g,
  '{asset.background ? <Text style={styles.detailsBlockText} selectable={true}>'
);
appJs = appJs.replace(
  /<Text key=\{i\} style=\{\{ fontWeight: 'bold', color: '#ffffff' \}\}>/g,
  '<Text key={i} style={{ fontWeight: "bold", color: "#ffffff" }} selectable={true}>'
);
appJs = appJs.replace(
  /<Text key=\{i\} style=\{\{ backgroundColor: '#fbbf24', color: '#000000', borderRadius: 2, paddingHorizontal: 2 \}\}>/g,
  '<Text key={i} style={{ backgroundColor: "#fbbf24", color: "#000000", borderRadius: 2, paddingHorizontal: 2 }} selectable={true}>'
);
appJs = appJs.replace(
  /<Text key=\{i\}>\{part\}<\/Text>/g,
  '<Text key={i} selectable={true}>{part}</Text>'
);


// Update Font Sizes in StyleSheet
appJs = appJs.replace(
  /detailsAssetCode: \{ fontFamily: 'monospace', fontSize: 16/g,
  "detailsAssetCode: { fontFamily: 'monospace', fontSize: 20"
);
appJs = appJs.replace(
  /detailsName: \{ fontSize: 18/g,
  "detailsName: { fontSize: 24"
);
appJs = appJs.replace(
  /sectionLabel: \{ fontSize: 10/g,
  "sectionLabel: { fontSize: 12"
);
appJs = appJs.replace(
  /sectionValue: \{ fontSize: 13, color: '#cbd5e1', lineHeight: 18 \}/g,
  "sectionValue: { fontSize: 16, color: '#f8fafc', lineHeight: 24 }"
);
appJs = appJs.replace(
  /descriptionText: \{ fontSize: 13, color: '#cbd5e1', lineHeight: 18 \}/g,
  "descriptionText: { fontSize: 16, color: '#f8fafc', lineHeight: 24 }"
);
appJs = appJs.replace(
  /detailsBlockText: \{\n\s*color: '#cbd5e1',\n\s*fontSize: 13,\n\s*lineHeight: 19/g,
  "detailsBlockText: {\n    color: '#f8fafc',\n    fontSize: 16,\n    lineHeight: 24"
);

fs.writeFileSync(appJsPath, appJs, 'utf8');
console.log("mobile/App.js updated text sizes and selectable.");
