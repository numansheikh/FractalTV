// Split the master SVG into 12 individual logo files
const fs = require('fs')
const path = require('path')

const master = fs.readFileSync(path.join(__dirname, 'fractals-logos-all.svg'), 'utf8')

// Extract defs block
const defsMatch = master.match(/<defs>[\s\S]*?<\/defs>/)
const defs = defsMatch ? defsMatch[0] : ''

// Extract all top-level <g> groups
const groups = []
const re = /(<g>\s*[\s\S]*?<\/g>)/g
let m
while ((m = re.exec(master)) !== null) {
  groups.push(m[1])
}

console.log(`Found ${groups.length} logo groups`)

// Logo metadata: name, description, best-for themes
const logos = [
  { name: 'electric',   desc: 'Cyan → Purple',           themes: ['dark'] },
  { name: 'fire',       desc: 'Orange → Red → Gold',     themes: ['superhero'] },
  { name: 'ocean',      desc: 'Cyan → Blue → Navy',      themes: ['cerulean-dark', 'cerulean'] },
  { name: 'carnival',   desc: 'Green → Pink → Gold',     themes: ['minty'] },
  { name: 'royal',      desc: 'Gold → Purple → Crimson', themes: ['vapor'] },
  { name: 'neon',       desc: 'Green → Purple → Blue',   themes: ['darkly'] },
  { name: 'pastel',     desc: 'Pink → Lavender → Peach', themes: ['fractals-light'] },
  { name: 'monochrome', desc: 'Black → Gray',            themes: ['lux'] },
  { name: 'synthwave',  desc: 'DeepPink → Teal → Purple',themes: ['solar'] },
  { name: 'earthy',     desc: 'Rust → Olive → Tan',      themes: ['united'] },
  { name: 'wireframe',  desc: 'Cyan ↔ Purple (stroke)',  themes: ['cyborg'] },
  { name: 'rainbow',    desc: 'Full spectrum',            themes: ['cosmo', 'flatly'] },
]

groups.forEach((g, i) => {
  if (i >= logos.length) return
  
  // Extract first polygon points to compute viewBox
  const polyMatch = g.match(/points="([^"]+)"/)
  if (!polyMatch) return
  
  const pts = polyMatch[1].trim().split(/\s+/).map(Number)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let j = 0; j < pts.length; j += 2) {
    minX = Math.min(minX, pts[j])
    minY = Math.min(minY, pts[j+1])
    maxX = Math.max(maxX, pts[j])
    maxY = Math.max(maxY, pts[j+1])
  }
  
  // Add padding
  const pad = 3
  const vb = `${minX - pad} ${minY - pad} ${maxX - minX + pad*2} ${maxY - minY + pad*2}`
  
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Fractals Logo: ${logos[i].name} (${logos[i].desc}) -->
<!-- Best for themes: ${logos[i].themes.join(', ')} -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${vb}">
  ${defs}
  ${g}
</svg>`
  
  const fname = `logo-${String(i+1).padStart(2,'0')}-${logos[i].name}.svg`
  fs.writeFileSync(path.join(__dirname, fname), svg)
  console.log(`  ${fname} — ${logos[i].desc}`)
})

// Write theme→logo mapping
const mapping = {}
logos.forEach((l, i) => {
  l.themes.forEach(t => {
    mapping[t] = `logo-${String(i+1).padStart(2,'0')}-${l.name}.svg`
  })
})
fs.writeFileSync(path.join(__dirname, 'theme-logo-map.json'), JSON.stringify(mapping, null, 2))
console.log('\nWrote theme-logo-map.json')
