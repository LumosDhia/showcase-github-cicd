import fs from 'fs';

const html = fs.readFileSync('scratch/pipeline.html', 'utf-8');

// Strip HTML tags to make it readable text
const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

const keywords = ['limit', 'fail', 'error', 'yaml', 'credit', 'card', 'runner', 'quota', 'minute', 'verify', 'validate'];
keywords.forEach(word => {
  let idx = 0;
  for (;;) {
    idx = text.toLowerCase().indexOf(word, idx);
    if (idx === -1) break;
    const start = Math.max(0, idx - 80);
    const end = Math.min(text.length, idx + 80);
    console.log(`[${word}] ...${text.slice(start, end).trim()}...`);
    idx += word.length;
  }
});
