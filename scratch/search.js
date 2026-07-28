import fs from 'fs';

const content = fs.readFileSync('src/App.tsx', 'utf-8');
const lines = content.split('\n');
lines.forEach((line, i) => {
  if (line.includes('Validate') || line.includes('Security')) {
    console.log(`Line ${i + 1}: ${line}`);
  }
});
