#!/usr/bin/env node
require('dotenv').config()
const express = require("express")
const sockjs = require('sockjs')
const path = require('path')
const SegfaultHandler = require('segfault-handler')
const http = require("http")
const WebSocketServer = require('websocket').server
const { createProxyMiddleware } = require('http-proxy-middleware')
const resolve = require('util').promisify(require('resolve'))

const Dao = require("@live-change/dao")
const DaoWebsocket = require("@live-change/dao-websocket")
const app = require("@live-change/framework").app()

const Services = require('../lib/Services.js')
const SsrServer = require('../lib/SsrServer.js')
const DbServer = require('@live-change/db-server')

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
})

process.on('uncaughtException', function (err) {
  console.error(err.stack)
})

SegfaultHandler.registerHandler("crash.log");


function startOptions(yargs) {
  yargs.option('withServices', {
    type: 'boolean',
    description: 'start all services'
  })
  yargs.options('updateServices', {
    type: 'boolean',
    description: 'update all services'
  })
  yargs.option('enableSessions', {
    type: 'boolean',
    description: 'support session based data access'
  })
  yargs.option('withDb', {
    type: 'boolean',
    description: 'start local database'
  })
  yargs.option('dbBackend', {
    type: 'string',
    description: 'select db backend engine ( lmdb | leveldb | rocksdb | memdown | mem )',
    default: 'lmdb'
  })
  yargs.option('dbBackendUrl', {
    type: 'string',
    description: 'database backend url parameter'
  })
  yargs.option('dbRoot', {
    type: 'string',
    description: 'database root directory',
    default: 'tmp.db'
  })
  yargs.option('createDb', {
    type: 'boolean',
    description: 'create database if not exists'
  })
}

function apiServerOptions(yargs) {
  yargs.option('apiPort', {
    describe: 'api server port',
    type: 'number',
    default: process.env.API_SERVER_PORT || 8002
  })
  yargs.option('apiHost', {
    describe: 'api server bind host',
    type: 'string',
    default: process.env.API_SERVER_HOST || '0.0.0.0'
  })
  yargs.option('services', {
    describe: 'services config',
    type: 'string',
    default: process.env.API_SERVER_HOST || 'services.config.js'
  })
  yargs.option('initScript', {
    description: 'run init script',
    type: 'string'
  })
}

function ssrServerOptions(yargs) {
  yargs.option('ssrRoot', {
    describe: 'frontend root directory',
    type: 'string',
    default: '.'
  })
  yargs.option('ssrPort', {
    describe: 'port to bind on',
    type: 'number',
    default: process.env.SSR_SERVER_PORT || 8001
  })
  yargs.option('ssrHost', {
    describe: 'bind host',
    type: 'string',
    default: process.env.SSR_SERVER_HOST || '0.0.0.0'
  })
  yargs.option('withApi', {
    describe: 'start internal api server',
    type: 'boolean'
  })
}

const argv = require('yargs') // eslint-disable-line
    .command('apiServer', 'start server', (yargs) => {
      apiServerOptions(yargs)
      startOptions(yargs)
    }, (argv) => {
      apiServer(argv)
    })
    .command('ssrServer', 'start ssr server', (yargs) => {
      ssrServerOptions(yargs)
      apiServerOptions(yargs)
      startOptions(yargs)
    }, (argv) => {
      ssrServer(argv, false)
    })
    .command('ssrDev', 'start ssr server in development mode', (yargs) => {
      ssrServerOptions(yargs)
      apiServerOptions(yargs)
      startOptions(yargs)
    }, (argv) => {
      ssrServer(argv, true)
    })
    .option('verbose', {
      alias: 'v',
      type: 'boolean',
      description: 'Run with verbose logging'
    }).argv
/// TODO api.gen.js generation command

function setupApiWs(httpServer, apiServer) {
  const wsServer = new WebSocketServer({ httpServer, autoAcceptConnections: false })
  wsServer.on("request",(request) => {
    console.log("WS URI", request.httpRequest.url)
    if(request.httpRequest.url != "/api/ws") return request.reject()
    let serverConnection = new DaoWebsocket.server(request)
    apiServer.handleConnection(serverConnection)
  })
}

async function setupDbServer(argv) {
  const { dbRoot, dbBackend, dbBackendUrl, dbSlowStart } = argv
  console.info(`starting database in ${path.resolve(dbRoot)}`)
  let server = new DbServer({
    dbRoot,
    backend: dbBackend,
    backendUrl: dbBackendUrl,
    slowStart: dbSlowStart,
    temporary: dbBackend == "mem"
  })

  process.on('unhandledRejection', (reason, promise) => {
    if(reason.stack && reason.stack.match(/\s(userCode:([a-z0-9_.\/-]+):([0-9]+):([0-9]+))\n/i)) {
      server.handleUnhandledRejectionInQuery(reason, promise)
    } 
  })

  await server.initialize()
  console.info(`database initialized!`)

  return server
}

function setupApiSockJs(httpServer, apiServer) {
  const sockJsServer = sockjs.createServer({})
  sockJsServer.on('connection', function (conn) {
    if(!conn) {
      console.error("NULL SOCKJS connection")
      return;
    }
    console.log("SOCKJS connection")
    apiServer.handleConnection(conn)
  })
  sockJsServer.installHandlers(httpServer, { prefix: '/api/sockjs' })
}

async function setupApiServer(argv) {
  const { services: config, withServices, updateServices, enableSessions, initScript } = argv

  const services = new Services(config)

  await services.loadServices()
  if(updateServices) await services.update()
  await services.start(withServices
      ? { runCommands: true, handleEvents: true, indexSearch: true }
      : { runCommands: false, handleEvents: false, indexSearch: false })

  if(argv.initScript) {
    const initScript = require(await services.resolve(argv.initScript))
    await initScript(services.getServicesObject())
  }

  const apiServerConfig = {
    services: services.services,
    //local, remote, <-- everything from services
    local(credentials) {
      const local = {
        version: new Dao.SimpleDao({
          values: {
            version: {
              observable() {
                return new Dao.ObservableValue(process.env.VERSION)
              },
              async get() {
                return process.env.VERSION
              }
            }
          }
        })
      }
      return local
    },
    shareDefinition: true,
    logErrors: true
  }

  const apiServer = enableSessions
      ? await app.createSessionApiServer(apiServerConfig)
      : await app.createApiServer(apiServerConfig)

  return apiServer
}

async function apiServer(argv) {
  const { apiPort, apiHost } = argv

  const apiServer = await setupApiServer(argv)

  const expressApp = express()

  const httpServer = http.createServer(expressApp)

  setupApiWs(httpServer, apiServer)
  setupApiSockJs(httpServer, apiServer)

  httpServer.listen(apiPort, apiHost)
  console.log('Listening on port ' + apiPort)
}

async function createLoopbackDao(credentials, daoFactory) {
  const server = new Dao.ReactiveServer(daoFactory)
  const loopback = new Dao.LoopbackConnection(credentials, server, {})
  const dao = new Dao(credentials, {
    remoteUrl: 'dao',
    protocols: { local: null },
    defaultRoute: {
      type: "remote",
      generator: Dao.ObservableList
    },
    connectionSettings: {
      disconnectDebug: true,
      logLevel: 10,
    },
  })
  dao.connections.set('local:dao', loopback)
  await loopback.initialize()
  if(!loopback.connected) {
    console.error("LOOPBACK NOT CONNECTED?!")
    process.exit(1)
  }
  return dao
}

async function ssrServer(argv, dev) {
  const { ssrRoot, ssrPort, ssrHost, apiHost, apiPort } = argv

  const expressApp = express()

  const manifest = dev ? null : require(path.resolve(ssrRoot,
    'dist/client/ssr-manifest.json'))

  if(!argv.withApi) {
    const apiServerHost = (argv.apiHost == '0.0.0.0' ? 'localhost' : argv.apiHost) + ':' + argv.apiPort
    const target = `http://${apiServerHost}/`
    const apiProxy = createProxyMiddleware({
      target,
      changeOrigin: true,
      ws: true
    })
    expressApp.use('/api', apiProxy)
    console.log("PROXY /api to", target)
  }

  let dbServer
  if(argv.withDb) {
    dbServer = await setupDbServer(argv)   
    app.dao.dispose()
    app.dao = await createLoopbackDao('local', () => dbServer.createDao('local') )
  }

  if(argv.createDb) {
    const list = await app.dao.get(['database', 'databasesList'])
    console.log("EXISTING DATABASES", list)
    console.log("CREATE DATABASE!")
    await app.dao.request(['database', 'createDatabase'], app.databaseName, {
      storage: { noMetaSync: true, noSync: true }
    }).catch(err => 'exists')
  }

  let apiServer
  if(argv.withApi) {
    apiServer = await setupApiServer(argv, dbServer)
  }

  const ssrServer = new SsrServer(expressApp, manifest, {
    dev,
    root: ssrRoot || '.',
    ...(apiServer
      ? {
        daoFactory: async (credentials, ip) => {
          return await createLoopbackDao(credentials, () => apiServer.daoFactory(credentials, ip))
        }
      }
      : {
        apiHost, apiPort
      }
    )
  })

  await ssrServer.start()

  const httpServer = http.createServer(expressApp)
  if(argv.withApi) {
    setupApiWs(httpServer, apiServer)
    setupApiSockJs(httpServer, apiServer)
  }

  httpServer.listen(ssrPort, ssrHost)
}
