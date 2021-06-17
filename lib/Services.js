const fs = require('fs')
const path = require('path')
const resolve = require('util').promisify(require('resolve'))
const app = require("@live-change/framework").app()

class Services {
  constructor(configPath) {
    if(!configPath) throw new Error("services config parameter is required")    
    this.configPath = path.resolve(configPath)
    this.config = require(path.resolve(this.configPath))
    this.servicesDir = path.dirname(this.configPath)

    this.serviceDefinitions = []
    this.services = []
  }

  async resolve(file) {
    const path = await resolve(file, { basedir: this.servicesDir })
    console.log("PATH RESOLVE", file, "IN", this.servicesDir, "=>", path)
    return path
  }
  async getServiceEntryFile(config) {
    const path = await resolve(config.path, { basedir: this.servicesDir })    
    console.log("PATH RESOLVE", config.path, "IN", this.servicesDir, "=>", path)
    return path
  }

  servicesList() {
    return this.config.services.map(s => s.name)
  }
  serviceConfig(serviceName) {
    return this.config.services.find(s => s.name = serviceName)
  }
  async loadServices() {
    for(const service of this.config.services) {
      const entryFile = await this.getServiceEntryFile(service)
      console.log("SERVICE", service, 'ENTRY FILE', entryFile)
      this.serviceDefinitions.push(require(entryFile))
    }

    /// TODO: load dependent services!!!
  }

  generateApiFile(path) {
    const out = fs.createWriteStream(path)
    out.write("import api from 'api'\n")
    out.write("import Vue from 'vue'\n\n")
    out.write("const views = {\n")
    for(const serviceDefinition of this.serviceDefinitions) {
      out.write(`  ${serviceDefinition.name}: {\n`)
      for(const viewName in serviceDefinition.views) {
        const viewDefinition = serviceDefinition.views[viewName]
        out.write(`    ${viewName}({ ${Object.keys(viewDefinition.properties).join(', ')} }) {\n`)
        out.write(`      return ['${serviceDefinition.name}', '${viewName}', `+
            `{ ${Object.keys(viewDefinition.properties).join(', ')} }]\n`)
        out.write(`    },\n`)
      }
      out.write(`  },\n`)
    }
    out.write("}\n\n")
    out.write("const fetch = {\n")
    for(const serviceDefinition of this.serviceDefinitions) {
      out.write(`  ${serviceDefinition.name}: {\n`)
      for(const viewName in serviceDefinition.views) {
        const viewDefinition = serviceDefinition.views[viewName]
        out.write(`    ${viewName}({ ${Object.keys(viewDefinition.properties).join(', ')} }) {\n`)
        out.write(`      return api.fetch(['${serviceDefinition.name}', '${viewName}', `+
            `{ ${Object.keys(viewDefinition.properties).join(', ')} }])\n`)
        out.write(`    },\n`)
      }
      out.write(`  },\n`)
    }
    out.write("}\n\n")
    out.write("const actions = {\n")
    for(const serviceDefinition of this.serviceDefinitions) {
      out.write(`  ${serviceDefinition.name}: {\n`)
      for(const actionName in serviceDefinition.actions) {
        const actionDefinition = serviceDefinition.actions[actionName]
        out.write(`    async ${actionName}({ ${Object.keys(actionDefinition.properties).join(', ')} }) {\n`)
        out.write(`      return await api.command(['${serviceDefinition.name}', '${actionName}'], `+
            `{ ${Object.keys(actionDefinition.properties).join(', ')} })\n`)
        out.write(`    },\n`)
      }
      out.write(`  },\n`)
    }
    out.write("}\n\n")
    out.write("api.views = views\n")
    out.write("api.actions = actions\n")
    out.write("api.fetch = fetch\n")
    out.write("Vue.prototype.$views = views\n")
    out.write("Vue.prototype.$actions = actions\n")
    out.write("Vue.prototype.$session = api.session\n")
    out.write("export default { views, actions }\n")
    out.end()
  }

  async update() {
    await Promise.all(this.serviceDefinitions.map(defn => {
      app.processServiceDefinition(defn, [ ...app.defaultProcessors ])
      return app.updateService(defn)
    }))
  }

  async start(startOptions) {
    this.services = await Promise.all(this.serviceDefinitions.map(defn => {
      app.processServiceDefinition(defn, [ ...app.defaultProcessors ])
      return app.startService(defn, startOptions)
    }))
  }

  getServicesObject() {
    let object = {}
    for(const service of this.services) object[service.name] = service
    return object
  }

}

module.exports = Services
