const {once}   = require('events');
const readLine = require('readline');
const fs       = require('fs');
const _        = require('lodash');
const request  = require('request');
const uuidv1          = require('uuid/v1');

const HttpsProxyAgent = require('https-proxy-agent');
const HttpProxyAgent  = require('http-proxy-agent');
const SocksProxyAgent = require('socks-proxy-agent');
const ProxyAgent      = require('proxy-agent');

class Proxy {

  timeout(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  async loadProxiesFromFile(path) {
    let reader = readLine.createInterface({input: fs.createReadStream(path), crlfDelay: Infinity});
    let lines  = [];
    reader.on('line', l => {
      lines.push(l)
    });
    await once(reader, 'close');
    return lines;
  }

  async r(config) {
    return new Promise((resolve, reject) => {
      if (!config.timeout) _.assign(config, {timeout: 60*1000});
      request(config, (error, response, body) => {
        if (error) return reject(error);
        return resolve({response, body});
      });
    })
  }

  async loadProxiesFromUrl(url) {
    let {body} = await this.r({method: 'GET', url, timeout:10000});

    let proxies = body.split('\n');
    proxies = _.map(proxies, proxy => {return proxy.replace('\r', '');});

    if (!proxies || !proxies.length) {
      console.error('Cant load proxies from url');
      return [];
    }

    console.log(`Loaded ${proxies.length} fresh proxies`);
    return proxies;
  }

  /**
   * increase proxies lines to 'amount'
   * use before made agents!
   * @param proxies
   * @param amount
   * @returns {{length}|*}
   */
  growthProxies(proxies, amount=1000) {
    if (!proxies.length || proxies.length > amount) return proxies;
    let results = [];
    for (let i = 0; i < amount; i++) {
      let a = proxies.shift();
      results.push(a);
      proxies.push(a);
    }

    console.log(`Increasing proxies lines to reach ${amount}`);
    return results;
  }

  /**
   * make agent from proxy line
   * username:password@ip:port
   * ip:port
   * domain:port
   *
   * @param {array} proxies - array of proxies: [ip:port, domain:port, username:password@ip:port]
   * @param type - [http, https, socks, _http, _https, _socks, _socks4, _socks5, smartproxy, oxylabs, lum
   * @returns {Promise<Array>}
   */
  async makeAgents(proxies, type) {
    let agents  = _.map(_.compact(proxies), (proxy) => {
      if (!proxy) return null;

      if (type === 'http') return new HttpProxyAgent('http://' + proxy);
      if (type === 'https') return new HttpsProxyAgent('http://' + proxy);
      if (type === 'socks') return new SocksProxyAgent('socks://' + proxy);

      if (type === '_http') return new ProxyAgent('http://' + proxy);
      if (type === '_https') return new ProxyAgent('https://' + proxy);
      if (type === '_socks') return new ProxyAgent('socks://' + proxy);
      if (type === '_socks4') return new ProxyAgent('socks4://' + proxy);
      if (type === '_socks5') return new ProxyAgent('socks5://' + proxy);

      if (type === 'smartproxy' || type === 'oxylabs' || type === 'lum') {
        let agent = new HttpsProxyAgent('http://' + proxy);
        if (!agent.options.auth || agent.options.auth.indexOf(':') === -1) return;

        let [login, password] = agent.options.auth.split(':');
        let host              = agent.options.host;

        if (type === 'smartproxy') return new HttpsProxyAgent(`http://user-${login}-session-${uuidv1()}:${password}@${host}`);
        if (type === 'oxylabs') return new HttpsProxyAgent(`http://customer-${login}-sessid-${uuidv1()}:${password}@${host}`);

        // lum-customer-hl_123123-zone-static:zonepassword@zproxy.lum-superproxy.io:123123
        if (type === 'luminati') return new HttpsProxyAgent(`http://${login}-session-${uuidv1()}:${password}@${host}`);
      }

      throw new Error('Unknown proxy type');
    });
    console.log(`Success load ${agents.length} "${type}" proxies`);
    return agents;
  }

  async loadAgentsFromUrl(proxyType, url) {
    console.log('Auto updating proxies by url');

    let proxies = await this.loadProxiesFromUrl(url);
    console.log(`Loaded ${proxies.length} proxies from url`);

    if (!proxies.length) return [];

    proxies = this.growthProxies(proxies, 10000);

    let agents  = await this.makeAgents(proxies, proxyType);
    if (!agents.length) return [];

    return agents;
  }

  /**
   *
   * @param proxyType
   * @param url
   * @param interval_minutes
   * @param callback - returns agents array that needs to put in bruteforce
   * @returns {Promise<void>}
   */
  async autoUpdatingFromUrl(proxyType, url, interval_minutes = 10, callback) {

    while (true) {
      let agents = await this.loadAgentsFromUrl(proxyType, url);
      if (!agents.length) continue;
      callback(agents);
      await this.timeout(interval_minutes * 60 * 1000);
    }
  }
}

module.exports = Proxy;