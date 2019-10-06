const fs = require('fs');
const _        = require('lodash');

class Config {

  /**
   * @param {boolean} config.DEBUG
   * @param config.name                  - name of the project. Must be the same as .js file
   * @param config.THREADS               - bruteforce threads
   * @param config.FILE.misc {array}     - ['bad', 'good'] = ['/misc/example_bad.txt]
   * @param config.FILE.results {array}  - ['bad', 'good'] = ['/results/example_bad.txt]
   * @param config.metrics {array}       - counters those ll be used to show progress
   * @param config.api.url               - http/https link to own api site
   * @param config.api.key               - license key for own api site
   * @param config.proxy_type            - http, https, socks and etc
   * @param config.withoutAccountsFrom   - ['bad', 'good'] where "email" or "email[:|;]pass"
   * @param config.withoutAccountsFromV2 - "logloglogloglog | email;pass"
   * @param config.customConfigName      - 'configs/123.json',
   * @param config.proxy_url             - optional, path to file where url
   * @param config.addTimeTo             - optional, key name to file where add time
   * @param config.mode                  - optional, 'queue', ll load FILE.source that contains path to files only .txt
   *
   */
  constructor(config) {
    config.metrics = this.metricsToObject(config.metrics);
    config.FILE    = this.convertShortFileNamesToFull(config.name, config.FILE);
    config = this.loadCustomConfig(config.customConfigName, config);
    config = this.loadApiKey(config);

    this.createFilesIfNotExists(config.FILE);
    this.addTimeToFiles(config);

    this.config = config;

    if (config.withoutAccountsFrom && config.withoutAccountsFrom.length > 0) {
      config.withoutAccountsFrom = _.map(config.withoutAccountsFrom, name => {
        return config.FILE[name];
      });
    }

    if (config.withoutAccountsFromV2 && config.withoutAccountsFromV2.length > 0) {
      config.withoutAccountsFromV2 = _.map(config.withoutAccountsFromV2, name => {
        return config.FILE[name];
      });
    }

    if (config.mode && config.mode === 'queue') {
      let path = config.FILE.source;

    }

  }

  get() {
    return this.config;
  }

  loadApiKey(CONFIG) {
    const apiKey = './configs/license.txt';
    if (!fs.existsSync(apiKey)) {
      console.error('Key doesnt exists');
      return CONFIG;
    }
    let key        = fs.readFileSync(apiKey, 'utf8');
    CONFIG.api.key = key;
    return CONFIG
  }

  addTimeToFiles(config) {
    let {addTimeTo, FILE} = config;
    if (!addTimeTo || !addTimeTo.length) return;
    let time = new Date().toISOString()
      .replace(/T/, ' ')
      .replace(/\..+/, '');

    for (let name of addTimeTo) {
      fs.appendFileSync(config.FILE[name], time+'\n');
    }
  }

  loadCustomConfig(configFile, CONFIG) {
    if (fs.existsSync(configFile)) {
      try {
        let result = _.merge(CONFIG, JSON.parse(fs.readFileSync(configFile, 'utf8')));
        console.log('Custom config loaded!');
        return result;
      } catch (e) {
        console.error('e', e);
        fs.writeFileSync(configFile, '{}');
      }
    }
    return CONFIG;
  }

  metricsToObject(metrics) {
    if (!_.isArray(metrics)) return metrics;
    metrics = _.keyBy(metrics);
    metrics = _.mapValues(metrics, v => {
      return 0
    });
    return metrics;
  }

  convertShortFileNamesToFull(name, FILE) {
    if (!(FILE.misc !== undefined && _.isArray(FILE.misc) && FILE.results !== undefined && _.isArray(FILE.results))) return FILE;
    let misc    = _.keyBy(FILE.misc);
    misc        = _.mapValues(misc, v => {return `misc/${name}_${v}.txt`});
    let results = _.keyBy(FILE.results);
    results     = _.mapValues(results, v => {return `results/${name}_${v}.txt`});
    FILE        = _.assign(misc, results);
    return FILE;
  }

  /**
   * Creates files if they are not exists
   * But directories must be created by hand
   * @param {object} filesObj     like {loggedIn: './loggedIn.log'}
   */
  createFilesIfNotExists(filesObj) {
    let paths = _.values(filesObj);
    for (let path of paths) {
      if (fs.existsSync(path)) continue;
      fs.closeSync(fs.openSync(path, 'a'));
    }
  }
}

module.exports = Config;