const cookie = require('cookie')
const path = require('path')
const serveStatic = require('serve-static')

const serverDao = require('@live-change/vue3-ssr/serverDao.js')
const generateUuid = require('@live-change/vue3-ssr/generateUuid.js')
const getIp = require('@live-change/vue3-ssr/getIp.js')

const Renderer = require('./Renderer.js')

class SsrServer {
  constructor(express, manifest, settings) {
    this.manifest = manifest
    this.settings = settings

    this.version = settings.version || 'unknown'
    this.express = express
    this.renderer = new Renderer(manifest, settings)

    this.root = this.settings.root || process.cwd()
  }

  async start() {
    await this.renderer.start()

    if(this.settings.dev) {
      this.express.use(this.renderer.vite.middlewares)
    } else {
      const staticPath = path.resolve(this.root, 'dist/client')
      this.express.use(serveStatic(staticPath, { index: false }))
    }

    await this.setupSsr()
  }

  async setupSsr() {
    const readCredentials = this.settings.readCredentials || ((req) => {
      const cookies = cookie.parse(req.headers.cookie || '')
      return { sessionKey: cookies.sessionKey || generateUuid() }
    })
    const writeCredentials = this.settings.writeCredentials || ((res, credentials) => {
      res.set({
        'Content-Type': 'text/html',
        'Set-Cookie': `sessionKey=${credentials.sessionKey}; path=/`
      })
    })
    this.express.use('*', async (req, res) => {
      const url = req.originalUrl
      const clientIp = getIp(req)

      const credentials = readCredentials(req)
      const windowId = generateUuid()
      try {
        let dao
        if(this.settings.daoFactory) {
          dao = await this.settings.daoFactory(credentials, clientIp)
        } else {
          const host = (this.settings.apiHost == '0.0.0.0' || !this.settings.apiHost)
            ? 'localhost' : this.settings.apiHost
          dao = await serverDao(credentials, clientIp, {
            remoteUrl: `ws://${host}:${this.settings.apiPort || 8002}/api/ws`
          })
        }        
        if(!dao)
          throw new Error("Impossible to render page without data access object. Define apiServer or daoFactory!")

        const version = this.version

        const html = await this.renderer.renderPage({ url, dao, clientIp, credentials, windowId, version })

        res.status(200)
        writeCredentials(res, credentials)
        res.end(html)
      } catch (e) {
        this.renderer.fixStackTrace(e)
        console.error("RENDERING ERROR", e.stack)
        res.status(500).end(e.stack)
      }
    })
  }

}

module.exports = SsrServer