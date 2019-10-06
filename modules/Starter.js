const Config = require('./Config');
const Bruteforce = require('./Bruteforce');
const Base = require('./Base');
const Proxy = require('./Proxy');
const _ = require('lodash');
const fs = require('fs');

class Starter {

  /**
   * Create/Load files to work
   * Load project config from file in 'configs' folder
   * Load license key
   * Write new time in log files
   * @param config_opts {object}
   */
  constructor(config_opts) {
    this.config = (new Config(config_opts)).get();
    this.base = new Base();
    this.proxy = new Proxy();
    this.bruteforce = new Bruteforce([], [], this.config.metrics);
  }

  async loadBase() {
    let config = this.config;
    let {withoutAccountsFrom, withoutAccountsFromV2} = config;
    let paths = [config.FILE.source];

    // if queue mode load paths
    if (config.mode && config.mode === 'queue') {
      try {
        paths = await this.base.loadBasePaths(config.name);
      } catch (e) {
        console.error('e', e);
      }
    }

    const max_lines = 2000000;
    let accounts = await this.base.loadQueue(paths, withoutAccountsFrom, withoutAccountsFromV2, max_lines);
    this.bruteforce.accounts = accounts;

    let limit = this.config.THREADS*10;
    if (accounts.length > limit) {
      setTimeout(async () => {
        let b = this.bruteforce;

        while (true) {
          try {
            // waiting while queued accounts ll come to limit
            while (b.leftAccountsAmount() > limit) await b.timeout(100);

            b.queue.pause();
            let queued_accounts = b.leftAccounts();

            let new_accounts = await this.base.loadQueue(paths, withoutAccountsFrom, withoutAccountsFromV2, max_lines);

            let free_accounts = _.filter(new_accounts, (account) => {
              return _.findIndex(queued_accounts, ['email', account.email]) === -1;
            });
            b.addAccounts(free_accounts);

            b.queue.resume();

            queued_accounts=[];
            new_accounts=[];
            free_accounts=[];

            // if we loaded less accounts than limit that means that accounts ends
            if (new_accounts < limit) break;

          } catch (e) {
            console.error('e', e);
          }
          await b.timeout(5000);
        }
      }, 5000)

    }

    console.log(`loaded ${accounts.length} accounts`);
    accounts = [];
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
        let url  = fs.readFileSync(config.FILE.proxies, 'utf8');
        let self = this;
        self.bruteforce.agents = await this.proxy.loadAgentsFromUrl(type, url);
        this.proxy.autoUpdatingFromUrl(proxy_type, url, 10, (agents) => {
          self.bruteforce.agents = agents;
        });
      }

      // load by url v2
      if (proxy_type.indexOf('_url') !== -1) {
        let url  = fs.readFileSync(config.FILE.proxies, 'utf8');
        let self = this;
        let type = proxy_type.split('_url')[0];
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
      drainCallback: () => {}
    });
  }
}

module.exports = Starter;