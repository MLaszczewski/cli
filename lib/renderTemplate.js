function renderTemplate(source, replacements) {
  let fragments = []
  for(const key in replacements) {
    const position = source.indexOf(key)
    if(position == -1) continue;
    fragments.push({ key, position })
  }
  fragments.sort((a, b) => a.position - b.position)
  const output = []
  let start = 0
  for(const { key, position } of fragments) {
    output.push(
      source.slice(start, position),
      replacements[key] 
    )
    start = position + key.length
  }
  output.push(source.slice(start))
  return output.join('')
}

module.exports = renderTemplate