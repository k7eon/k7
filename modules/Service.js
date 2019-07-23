const _ = require('lodash');
const request = require('request');

class Service {


  setApiSettings(apiUrl, apiKey) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  async apiR(path, json = {}) {
    return this.r({
      method: 'POST',
      url: this.apiUrl+'/'+path,
      json: Object.assign(json, {k: this.apiKey})
    });
  }

  /**
   * Send request and return promise.
   * @param config     - all the same for 'request' module
   * @param agent      - for convenience. agent by 'request'.agent
   * @param retryCount - amount of retries if not called 'timeout'
   * @return {Promise<{response, body}>}
   * @throws any errors on request
   */
  async r(config, agent = null, retryCount = 3) {
    return new Promise((resolve, reject) => {
      if (!config.agent && agent) _.assign(config, {agent: agent});
      if (!config.timeout) _.assign(config, {timeout: 60*1000});

      let t = setTimeout(async () => {
        try {
          if (retryCount === 0) return reject("r.retryCount === 0");
          return resolve(await this.r(config, agent, retryCount-1));
        } catch (e) {
          return reject(e);
        }
      }, config.timeout+2*1000);

      request(config, (error, response, body) => {
        clearTimeout(t);
        if (error) return reject(error);
        return resolve({response, body});
      });
    })
  }

  /**
   * retrieve 'set-cookie' header from 'request'.response
   * @param rResponse
   * @return {*}
   */
  getSetCookies(rResponse) {
    let headers = rResponse.headers;
    if (!headers['set-cookie']) return null;
    return headers['set-cookie'].map(e => e.split(';')[0]+';').join(' ');
  }

  /**
   * Retrieve sub string by passing 'start' and 'end' substring
   * example: parse('123baaz321', '123', '321') will return 'baaz'
   * @param {string} source   source string
   * @param {string} start    start substring
   * @param {string} end      end substring
   * @return {string}
   */
  parse(source, start, end) {
    if (!source.length ||
      source.indexOf(start) === -1 ||
      source.indexOf(end) === -1) return "";
    let startPos = source.indexOf(start)+start.length;
    let secondSource = source.substr(startPos, source.length);
    let endPos = secondSource.indexOf(end);
    return secondSource.substring(0, endPos);
  }

  saveError(task, e, b, FILE) {
    b.save(FILE.errors, `${JSON.stringify({account: task})}\n${e.stack}\n\n`, 'errors');
  }

  /**
   * that errors are usual (or bad proxy, or site request timeout)
   * @param e
   * @returns {boolean}
   */
  isBadProxyError(e) {
    if (!e || !e.message) return false;

    return e.message.indexOf('sock') !== -1
      || e.message.indexOf('Sock') !== -1
      || e.message.indexOf('connect ECONN') !== -1
      || e.message.indexOf('Proxy connection timed out') !== -1
      || e.message.indexOf('ETIMEDOUT') !== -1
      || e.message.indexOf('ECONNRESET') !== -1
      || e.message.indexOf('ESOCKETTIMEDOUT') !== -1
      || e.message.indexOf('EPROTO') !== -1
      || e.message.indexOf('self signed certificate in certificate chain') !== -1
      || e.message.indexOf('unable to verify the first certificate') !== -1
      || e.message.indexOf('unable to get local issuer certificate') !== -1
      || e.message.indexOf('EADDRINUSE') !== -1
      || e.message.indexOf('certificate') !== -1
      || e.message.indexOf('Parse Error') !== -1
      || e.message.indexOf('wrong version ') !== -1
      || e.message.indexOf('timeout') !== -1
  }

  isItUsualError(b, e) {

    if (!e.message) return false;

    if (this.isBadProxyError(e)
      || e.message.indexOf('Parse Error') !== -1
      || e.message.indexOf('timeout') !== -1) {
      b.metrics.inc('timeout');
      return true;
    }

    if (b.metrics.metrics[e.message] !== undefined) {
      b.metrics.inc(e.message);
      return true;
    }

    if (e.message.indexOf('WrongLicense') !== -1) {
      console.log('WrongLicense');
      process.exit(1);
      return true;
    }

    return false;
  }
}


module.exports = Service;