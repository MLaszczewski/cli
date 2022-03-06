#!/usr/bin/env node
require('dotenv').config()
const express = require("express")
const path = require('path')
const SegfaultHandler = require('segfault-handler')
const http = require("http")
const { createProxyMiddleware } = require('http-proxy-middleware')

const app = require("@live-change/framework").app()

const {

  SsrServer,

  createLoopbackDao,
  setupApiServer,
  setupApiSockJs,
  setupApiWs,
  setupDbServer,
  setupDbClient,
  setupApp

} = require("@live-change/server")

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
  yargs.option('dbAccess', {
    type: 'boolean',
    description: 'give database access to frontend(only for development and db-admin)'
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
    default: 'server/services.config.js'
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
    default: './front'
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
  }, async (argv) => {
    await setupApp({ ...argv, uidBorders: '[]' })
    await apiServer(argv)
  })
  .command('devApiServer', 'shortcut for apiServer --withServices --updateServices', (yargs) => {
    apiServerOptions(yargs)
    startOptions(yargs)
  }, async (argv) => {
    argv = {
      ...argv,
      withServices: true, updateServices: true
    }
    await setupApp({ ...argv, uidBorders: '[]' })
    await apiServer(argv)
  })
  .command('memApiServer', 'shortcut for devApiServer --withDb --dbBackend mem --createDb', (yargs) => {
    apiServerOptions(yargs)
    startOptions(yargs)
  }, async (argv) => {
    argv = {
      ...argv,
      withServices: true, updateServices: true,
      withDb: true, dbBackend: 'mem', createDb: true
    }
    await setupApp({ ...argv, uidBorders: '[]' })
    await apiServer(argv)
  })
  .command('ssrServer', 'start ssr server', (yargs) => {
    ssrServerOptions(yargs)
    apiServerOptions(yargs)
    startOptions(yargs)
  }, async (argv) => {
    await setupApp({ ...argv, uidBorders: '[]' })
    await ssrServer({ ...argv, uidBorders: '[]' }, false)
  })
  .command('ssrDev', 'start ssr server in development mode', (yargs) => {
    ssrServerOptions(yargs)
    apiServerOptions(yargs)
    startOptions(yargs)
  }, async (argv) => {
    await setupApp({ ...argv, uidBorders: '[]' })
    await ssrServer({ ...argv, uidBorders: '[]' }, true)
  })
  .command('dev', 'shortcut for ssrDev --withApi --withServices --updateServices', (yargs) => {
    ssrServerOptions(yargs)
    apiServerOptions(yargs)
    startOptions(yargs)
  }, async (argv) => {
    argv = {
      ...argv,
      withApi: true, withServices: true, updateServices: true
    }
    await setupApp({ ...argv, uidBorders: '[]' })
    await ssrServer({ ...argv, uidBorders: '[]' }, true)
  })
  .command('memDev', 'shortcut for dev --withDb --dbBackend mem --createDb', (yargs) => {
    ssrServerOptions(yargs)
    apiServerOptions(yargs)
    startOptions(yargs)
  }, async (argv) => {
    argv = {
      ...argv,
      withApi: true, withServices: true, updateServices: true,
      withDb: true, dbBackend: 'mem', createDb: true
    }
    await setupApp({ ...argv, uidBorders: '[]' })
    await ssrServer({ ...argv, uidBorders: '[]' }, true)
  })
  .command('localDev', 'shortcut for dev --withDb --createDb', (yargs) => {
    ssrServerOptions(yargs)
    apiServerOptions(yargs)
    startOptions(yargs)
  }, async (argv) => {
    argv = {
      ...argv,
      withApi: true, withServices: true, updateServices: true,
      withDb: true, createDb: true
    }
    await setupApp({ ...argv, uidBorders: '[]' })
    await ssrServer({ ...argv, uidBorders: '[]' }, true)
  })
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    description: 'Run with verbose logging'
  }).argv
/// TODO api.gen.js generation command

async function apiServer(argv) {
  const { apiPort, apiHost } = argv

  const apiServer = await setupApiServer(argv, dbServer)

  const expressApp = express()

  const httpServer = http.createServer(expressApp)

  setupApiWs(httpServer, apiServer)
  setupApiSockJs(httpServer, apiServer)

  httpServer.listen(apiPort, apiHost)
  console.log('Listening on port ' + apiPort)
}
async function ssrServer(argv, dev) {
  const { ssrRoot, ssrPort, ssrHost, apiHost, apiPort } = argv

  const fastAuth = true

  const expressApp = express()

  //expressApp.use('/static', express.static(path.resolve(ssrRoot, 'public')))

  const manifest = dev ? null : require(path.resolve(ssrRoot, 'dist/client/ssr-manifest.json'))

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

  if(argv.createDb) {
    const list = await app.dao.get(['database', 'databasesList'])
    console.log("existing databases:", list.join(', '))
    console.log("creating database", app.databaseName)
    await app.dao.request(['database', 'createDatabase'], app.databaseName, {
      storage: { noMetaSync: true, noSync: true }
    }).catch(err => 'exists')
  }

  let apiServer
  if(argv.withApi) {
    apiServer = await setupApiServer({ ...argv, fastAuth })
  }

  const ssrServer = new SsrServer(expressApp, manifest, {
    ...argv,
    dev,
    fastAuth,
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
