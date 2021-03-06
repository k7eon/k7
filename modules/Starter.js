const Config     = require('./Config');
const Bruteforce = require('./Bruteforce');
const Base       = require('./Base');
const Proxy      = require('./Proxy');
const _          = require('lodash');
const fs         = require('fs');
const path       = require('path');

class Starter {

  /**
   * Create/Load files to work
   * Load project config from file in 'configs' folder
   * Load license key
   * Write new time in log files
   * @param config_opts {object}
   */
  constructor(config_opts) {
    this.config     = (new Config(config_opts)).get();
    this.base       = new Base();
    this.proxy      = new Proxy();
    this.bruteforce = new Bruteforce([], [], this.config.metrics);
  }

  async loadBase() {
    let config                                                              = this.config;
    let {withoutAccountsFrom, withoutAccountsFromV2, withoutAccountsFromV3} = config;
    let removeV1                                                            = withoutAccountsFrom;
    let removeV2                                                            = withoutAccountsFromV2;
    let removeV3                                                            = withoutAccountsFromV3;

    let paths = [config.FILE.source];

    // if queue mode load paths
    if (config.mode && config.mode === 'queue') {
      try {
        paths = await this.base.loadBasePaths(config.name);
      } catch (e) {
        console.error('e', e);
      }
    }

    removeV1 = _.map(removeV1, p => path.resolve(p));
    removeV2 = _.map(removeV2, p => path.resolve(p));
    removeV3 = _.map(removeV3, p => path.resolve(p));

    const max_lines          = 3000000;
    let accounts             = await this.base.loadQueue(paths, removeV1, removeV2, removeV3, max_lines);
    this.bruteforce.accounts = accounts;

    console.log(`loaded ${accounts.length} accounts`);

    // if this latest lines chunk, dont wait next chunks
    let limit = this.config.THREADS * 10;
    if (accounts.length < limit) {
      return;
    }
    accounts = [];

    // reload base file to take more lines...

    let base = this.base;
    let b = this.bruteforce;
    // let self = this;
    (async function () {
      await b.timeout(5000);
      while (true) {
        try {
          // waiting while queued accounts ll come to limit
          while (b.leftAccountsAmount() > limit) {
            await b.timeout(500);
          }

          // console.log('self', self);
          b.queue.pause();
          let queued_accounts = b.leftAccounts();

          console.log('Uploading next chunk...')
          let new_accounts = await base.loadQueue(paths, removeV1, removeV2, removeV3, max_lines);
          let l            = base.left_name;
          let r            = base.right_name;

          let free_accounts = _.filter(new_accounts, (account) => {
            return _.findIndex(queued_accounts, {[l]: account[l], [r]: account[r]}) === -1;
          });
          b.addAccounts(free_accounts);

          b.queue.resume();

          if (b.leftAccountsAmount() < limit) {
            break;
          }

          // if we loaded less accounts than limit that means that accounts ends
          if (new_accounts < limit) {
            break;
          }

          queued_accounts = [];
          new_accounts    = [];
          free_accounts   = [];

        } catch (e) {
          console.error('e', e);
        }
      }
    })().then(r => {

    });
  }

  async loadProxies() {
    try {
      let config = this.config;

      let {proxy_type} = config;

      // not url, loads proxy now from file
      if (!config.proxy_url && proxy_type && proxy_type.indexOf('_url') === -1) {
        let proxies            = await this.proxy.loadProxiesFromFile(config.FILE.proxies);
        proxies                = this.proxy.growthProxies(proxies, 5000);
        this.bruteforce.agents = await this.proxy.makeAgents(proxies, proxy_type);
      }

      // load by url v1
      if (config.proxy_url) {
        let url                = fs.readFileSync(config.FILE.proxies, 'utf8');
        let self               = this;
        self.bruteforce.agents = await this.proxy.loadAgentsFromUrl(type, url);
        this.proxy.autoUpdatingFromUrl(proxy_type, url, 10, (agents) => {
          self.bruteforce.agents = agents;
        });
      }

      // load by url v2
      if (proxy_type.indexOf('_url') !== -1) {
        let url                = fs.readFileSync(config.FILE.proxies, 'utf8');
        let self               = this;
        let type               = proxy_type.split('_url')[0];
        self.bruteforce.agents = await this.proxy.loadAgentsFromUrl(type, url);
        this.proxy.autoUpdatingFromUrl(type, url, 10, (agents) => {
          self.bruteforce.agents = agents;
        });
      }

      return true;
    } catch (e) {
      console.error('e', e);
    }
  }

  async run(workerClass) {
    let config = this.config;

    await this.loadBase();
    await this.loadProxies();

    let b = this.bruteforce;

    this.bruteforce.start({
      whatToQueue: 'accounts',
      THREADS: config.THREADS,
      useProxy: !!config.proxy_type,
      handlerFunc: async (task, agent) => {
        try {
          if (!task.email || !task.password) {
            throw new Error(`Wrong line: ${JSON.stringify(task)}`);
          }
          return workerClass.work(b, task, agent, config.DEBUG);
        } catch (e) {
          console.log('.start', e.message);
          return null;
        }
      },
      drainCallback: () => {
      }
    });
  }
}

module.exports = Starter;