const _     = require('lodash');
const async = require('async');
const fs    = require('fs');

/**
 * Using to show statistic
 */
class Metrics {
  /**
   * Create metrics object like counter to monitor custom metrics
   * start interval showing metrics
   * @param {object}  metrics    object of string like {'good':0, 'bad':0}
   * @param {number} interval    ms, interval of console.log
   */
  constructor(metrics, interval) {
    this.metrics   = metrics;
    this.left     = -1; // how much left
    this.interval = interval;
  }

  start() {
    this.metricsInterval = setInterval(() => {
      console.info(this._getMetrics());
    }, this.interval);
  }

  inc(name, amount = 1) {
    this.metrics[name] += amount;
  }

  _stopShowingMetrics() {
    if (!this.metricsInterval) return;
    console.info(this._getMetrics());
    clearInterval(this.metricsInterval);
  }

  _getMetrics() {
    return _.assign(this.metrics, {left: this.left});
  }
}

class Bruteforce {
  constructor(accounts, agents, metrics, metrics_interval = 5000) {
    this.accounts = [];
    this.agents   = [];

    this.processing_accounts = [];
    this.queue               = null;

    this.createMetricsCounter(metrics, metrics_interval);
  }

  /**
   * creates metric counters
   * @param metrics
   * @param interval
   */
  createMetricsCounter(metrics, interval) {
    this.metrics = new Metrics(metrics, interval);

    // send every 1s left amount
    setInterval(() => {
      try {
        this.metrics.left = this.leftAccountsAmount();
      } catch (e) {
      }
    }, 1000);
  }

  leftAccountsAmount() {
    if (!this.queue || this.queue._tasks === undefined
      || this.processing_accounts === undefined
    ) return -1;

    return this.queue._tasks.length + this.processing_accounts.length;
  }

  leftAccounts() {
    try {
      let a = _.concat(this.queue._tasks.toArray(), this.processing_accounts);
      return a;
    } catch (e) {
      return [];
    }
  }

  addAccounts(accounts) {
    this.queue.push(accounts);
    console.log('Added ', this.queue._tasks.length);

  }

  /**
   * this.agents.shift()
   * @return {Agent | null}
   */
  _getAgent() {
    if (this.agents.length === 0) return null;
    return this.agents.shift();
  }

  /**
   * push(agent) after 'timeout'
   * @param {Agent} agent
   * @param {number} timeout
   * @return {undefined}
   */
  returnAgent(agent, timeout = 1) {
    setTimeout(() => {
      this.agents.push(agent);
    }, timeout);
  }

  async getFreeAgent() {
    let agent = this._getAgent();
    while (!agent) {
      await this.timeout(5000);
      agent = this._getAgent();
    }
    return agent;
  }

  addProcessingTask(task) {
    this.processing_accounts.push(task);
  }

  removeProcessingTask(task) {
    let index = _.findIndex(this.processing_accounts, ['email', task.email]);
    delete this.processing_accounts[index];
    this.processing_accounts = _.compact(this.processing_accounts);
  }

  start(opts) {
    if (!opts.THREADS) opts.THREADS = 100;
    if (!opts.handlerFunc) throw new Error('handlerFunc not defined!');
    if (!opts.whatToQueue) opts.whatToQueue = 'accounts';
    if (!opts.startMessage) opts.startMessage = `Start ${opts.whatToQueue} checking`;
    if (!opts.drainMessage) opts.drainMessage = `All ${opts.whatToQueue} have been processed`;
    if (!opts.drainCallback) throw new Error('drainCallback not defined!');
    if (!opts.useProxy) opts.useProxy = false;

    let {THREADS, whatToQueue, startMessage, drainMessage, drainCallback, useProxy} = opts;

    let source = this[whatToQueue];
    if (!source || !source.length) throw new Error(`Nothing ${whatToQueue} to check`);

    let self = this;

    this.metrics.start();

    this.queue = async.queue(async (task, callback) => {
      try {
        let agent = (useProxy) ? await self.getFreeAgent() : null;

        self.addProcessingTask(task);

        let result = await opts.handlerFunc(task, agent);
        if (useProxy && result.agent) self.returnAgent(result.agent);

        self.removeProcessingTask(task);

      } catch (e) {
        console.error('.start error: ', e);
      }
      return true;
    }, THREADS);

    this.queue.drain = function () {
      console.log(drainMessage);
      self.metrics._stopShowingMetrics();
      drainCallback();
    };

    this.queue.push(source);
    console.log(startMessage);
    return true;
  }

  /**
   * Async timeout implementation
   * @example
   *   await this.timeout(5000)
   * @param {number} ms
   * @return {Promise<any>}
   */
  timeout(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  /**
   * Add task in queue to execute again
   * @param task
   */
  reCheck(task) {
    this.queue.push(task);
  }

  /**
   * write content to file + '\n' and increase metrics counter if needed
   * @param path            destination path
   * @param line            line to write
   * @param metricsName     what metrics must be increased by 1
   */
  save(path, line, metricsName = null) {
    fs.appendFileSync(path, line + '\n');
    if (metricsName) this.metrics.inc(metricsName);
  }
}

// let b = new Bruteforce();
// b.accounts = [1,2,3];
// b.agents = [1,2,3];
// b.createMetricsCounter({good: 1, bad: 1,}, 5000);

module.exports = Bruteforce;