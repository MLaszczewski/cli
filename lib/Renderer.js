const fs = require('fs')
const path = require('path')
const serialize = require('serialize-javascript')
const renderTemplate = require('./renderTemplate.js')

class Renderer {
  constructor(manifest, settings) {
    this.manifest = manifest
    this.settings = settings
    this.root = this.settings.root || process.cwd()
  }

  async start() {
    if(this.settings.dev) {
      await this.setupVite()
    } else {
      const serverEntryPath = path.resolve(this.root, './dist/server/entry-server.js')    
      this.renderer = require(serverEntryPath).render
      const templatePath = path.resolve(this.root, 'dist/client/index.html')      
      this.template = await fs.promises.readFile(templatePath, { encoding: 'utf-8' })
    }
  }

  async setupVite() {
    this.vite = await require('vite').createServer({
      root: this.root,
      logLevel: 'info', //isTest ? 'error' : 'info',
      server: {
        middlewareMode: true,
        watch: {
          // During tests we edit the files too fast and sometimes chokidar
          // misses change events, so enforce polling for consistency
          usePolling: true,
          interval: 100
        }
      }
    })
  }

  async renderPage(params) {
    const { url, dao, clientIp, credentials, windowId, version } = params

    const render = await this.getRenderFunction()
    const { html: appHtml, modules, data, meta } = await render(params)

    const preloadLinks = this.renderPreloadLinks(modules)

    const appDataScript = `  <script>` +
        `    window.__DAO_CACHE__= ${serialize(data, { isJSON: true })}\n`+
        (this.settings.fastAuth ? ''
          : `    window.__CREDENTIALS__= ${serialize(credentials, { isJSON: true })}\n`)+
        `    window.__VERSION__ = ${serialize(version, { isJSON: true })}\n`+
        `    window.__WINDOW_ID__ = ${serialize(windowId, { isJSON: true })}\n`+
        `    console.error("SOFTWARE VERSION:" + window.__VERSION__)\n`+
        `</script>\n`

    const template = await this.prepareTemplate(url)

    const html = renderTemplate(template, {
      '<html>': (meta.htmlAttrs ? `<html ${meta.htmlAttrs}>` : '<html>'),
      '<head>': (meta.headAttrs ? `<head ${meta.headAttrs}>` : '<head>'),
      '<!--head-->': (meta.head || '') + '\n' + preloadLinks,
      '<body>': (meta.bodyAttrs ? `<body ${meta.bodyAttrs}>` : '<body>') + '\n' + (meta.bodyPrepend || ''),
      '<!--app-html-->': appHtml,
      '<!--app-data-->': (meta.bodyAppend || '') + '\n' + appDataScript
    })

    return html
  }

  renderPreloadLink(file) {
    if (file.endsWith('.js')) {
      return `<link rel="modulepreload" crossorigin href="${file}">`
    } else if (file.endsWith('.css')) {
      return `<link rel="stylesheet" href="${file}">`
    } else {
      // TODO
      return ''
    }
  }

  renderPreloadLinks(modules) {
    if(!this.manifest) return ''
    let links = ''
    const seen = new Set()
    modules.forEach((id) => {
      const files = this.manifest[id]
      if (files) {
        files.forEach((file) => {
          if (!seen.has(file)) {
            seen.add(file)
            links += this.renderPreloadLink(file)
          }
        })
      }
    })
    return links
  }

  async prepareTemplate(url) {
    let template = this.template
    if(this.settings.dev) {
      const templatePath = path.resolve(this.root, 'index.html')      
      template = await fs.promises.readFile(templatePath, { encoding: 'utf-8' })
      template = await this.vite.transformIndexHtml(url, template)
    }
    return template
  }

  async getRenderFunction() {
    if(this.settings.dev) {
      /// Reload every request
      const entryPath = path.resolve(this.root, 'src/entry-server.js')
      return (await this.vite.ssrLoadModule(entryPath)).render
    } else {
      return this.renderer
    }
  }

  fixStackTrace(e) {
    this.vite && this.vite.ssrFixStacktrace(e)
  }

}

module.exports = Renderer