const {once}           = require('events');
const readLine         = require('readline');
const fs               = require('fs');
const _                = require('lodash');
const LineByLineReader = require('line-by-line');
let spawn          = require('child_process').spawn;
const path = require('path');

class Base {
  constructor(left_name = 'email', right_name = 'password') {
    this.left_name  = left_name;
    this.right_name = right_name;
  }

  parseEmailPassword(line) {
    let d1        = line.indexOf(';');
    let d2        = line.indexOf(':');
    let delimiter = null;

    if (d1 >= 0 && d2 >= 0) delimiter = (d1 < d2) ? ';' : ':';
    if (d1 === -1 && d2 !== -1) delimiter = ':';
    if (d2 === -1 && d1 !== -1) delimiter = ';';

    let left  = line.substring(0, line.indexOf(delimiter));
    let right = line.substring(line.indexOf(delimiter) + 1);
    return [left, right];
  }

  /**
   * Loads base and removes lines from already checked paths.
   * unlimited remove_arr path files size
   *
   * @param base_path
   * @param remove_arr - [path1, path2, ...]     path must contain only email
   * @param remove_arr_v2 - [path1, path2, ...]  path can contain any and email
   * @param limit
   */
  async loadBase(base_path, remove_arr = [], remove_arr_v2 = [], limit = 2000000) {
    const reader = new LineByLineReader(base_path, {
      encoding: 'utf8',
      skipEmptyLines: true,
    });

    let result_lines = [];

    let lines      = [];
    let chunk_size = limit * 1.2;

    reader.on('line', async (line) => {
      let [left, right] = this.parseEmailPassword(line);
      if (!left || !right) return;

      lines.push({[this.left_name]: left, [this.right_name]: right});

      if (lines.length < chunk_size) return;

      // if (lines.length === chunk_size) {
      reader.pause();
      result_lines = _.assign(result_lines, await this.removeLines(lines, remove_arr, remove_arr_v2));
      lines        = [];
      console.log('collected accounts', result_lines.length);

      if (result_lines.length > limit) {
        reader.close();
        return;
      }

      reader.resume();
      // }
    });

    reader.on('error', function (err) {
      console.error('err', err);
    });

    // await once(reader, 'close');
    await once(reader, 'end');

    if (lines.length > 0) {
      result_lines = _.assign(result_lines, await this.removeLines(lines, remove_arr, remove_arr_v2));
    }

    return result_lines;
  }

  async loadBasePaths(name) {

    let queue_path = `manager/${name}_queue.txt`;
    if (!fs.existsSync(queue_path)) fs.writeFileSync(queue_path, '');

    let reader = readLine.createInterface({
      input: fs.createReadStream(queue_path),
      crlfDelay: Infinity
    });
    let paths  = [];
    reader.on('line', async (line) => {
      if (!fs.existsSync(line)) {
        return;
      }

      let stat = fs.statSync(line);
      if (stat.isFile() && line.indexOf('.txt') !== -1) {
        paths.push(line);
        return;
      }

      if (stat.isDirectory()) {
        let files = fs.readdirSync(line);
        files     = _.map(files, (file) => {
          return line + '/' + file;
        });
        // оставляем только файлы
        files     = _.filter(files, (file) => {
          return fs.statSync(file).isFile() && file.indexOf('.txt') !== -1;
        });
        paths     = _.concat(paths, files);
      }
    });
    await once(reader, 'close');

    return paths;
  }

  /**
   * Load uniq base files as one, removes checked emails, max_lines amount
   * @param {string[]} base_paths
   * @param {string[]} remove_arr
   * @param {string[]} remove_arr_v2
   * @param {string[]} remove_arr_v3
   * @param {number} max_lines
   * @returns {Promise<Array>}
   */
  async loadQueue(base_paths, remove_arr = [], remove_arr_v2 = [], remove_arr_v3 = [], max_lines = 2000000) {
    console.log('Loading accounts from queue');
    console.log('paths', base_paths.join('\n'));
    let lines = [];
    for (let base_path of base_paths) {

      let temp_lines = [];
      if (!fs.existsSync(path.resolve('./k7_helper.exe'))) {

        if (remove_arr_v3.length) {
          console.error('withoutAccountsFromV3 currently not supported, withoutAccountsFromV3 used as withoutAccountsFromV1')
          remove_arr = _.concat(remove_arr, remove_arr_v3); // todo fix it later
        }

        temp_lines = await this.loadBase(base_path, remove_arr, remove_arr_v2, max_lines);
      } else {
        temp_lines = await this.PrepareLinesViaHelper(base_path, remove_arr, remove_arr_v2, remove_arr_v3, max_lines);
      }

      lines          = _.concat(lines, temp_lines);
      if (lines.length > max_lines) {
        lines.splice(max_lines, lines.length);
        break;
      }
    }
    return lines;
  }

  /**
   *
   * @param lines
   * @param path
   * @return {Promise<Array>}
   * @private
   */
  async _removeLinesFromFile(lines, path) {
    let self = this;

    console.time(path);
    const reader = new LineByLineReader(path, {
      encoding: 'utf8',
      skipEmptyLines: true,
    });

    let old_amount = lines.length;

    let emailsSet = new Set(_.map(lines, this.left_name));

    let removeEmails = new Set([]);
    reader.on('line', async (line) => { // email
      if (line && line !== "" && emailsSet.has(line)) {
        removeEmails.add(line);
        return
      }

      let [left, right] = this.parseEmailPassword(line);

      if (left && left !== "" && emailsSet.has(left)) {
        removeEmails.add(left);
        return
      }

      if (right && right !== "" && emailsSet.has(right)) {
        removeEmails.add(right);
        return
      }
    });

    await once(reader, 'end');

    lines = _.filter(lines, (line) => {
      return !removeEmails.has(line[this.left_name])
    });

    // console.log('lines.length', lines.length);

    let new_amount = lines.length;
    let removed    = old_amount - new_amount;
    let now        = new_amount;
    console.log(path, {removed, now});
    console.timeEnd(path);
    return lines;
  }

  // @deprecated
  async _removeLinesFromFile_old(lines, path) {
    let self = this;

    console.time(path);
    let reader = readLine.createInterface({
      input: fs.createReadStream(path),
      crlfDelay: Infinity
    });

    let old_amount = lines.length;
    let emailPass  = _.keyBy(lines, this.left_name);
    lines          = [];
    let i          = 0;

    reader.on('line', async (line) => { // email
      if (i > 1 && i % 1000000 === 0) console.log(++i);

      if (emailPass[line] !== undefined) {
        emailPass[line] = undefined;
        return;
      }

      let [left, right] = this.parseEmailPassword(line);

      if (emailPass[left] !== undefined) {
        emailPass[left] = undefined;
        return;
      }
      if (emailPass[right] !== undefined) {
        emailPass[right] = undefined;
        return;
      }
    });

    await once(reader, 'close');

    lines = _.compact(_.values(emailPass));

    let new_amount = lines.length;
    let removed    = old_amount - new_amount;
    let now        = new_amount;
    console.log(path, {removed, now});
    console.timeEnd(path);
    return lines;
  }

  async removeLines(lines, paths = [], paths_v2 = []) {
    for (let path of paths) {
      lines = await this._removeLinesFromFile(lines, path);
    }

    lines = await this.removeAccountsFromFileBy('email', lines, paths_v2);
    return lines;
  }

  /**
   * Remove all lines from this.accounts that includes 'email' attr in 'path' file
   * Update this.accounts
   * @param {string} by          any attribute from this.accounts[0]
   * @param {array} lines
   * @param {string|array} path  path/s to file whose lines will be removed from this.accounts through indexOf
   * @return {Array}
   */
  removeAccountsFromFileBy(by = 'email', lines, path = 'files/bad.log') {

    if (!lines.length) return [];
    let paths = (typeof path === 'string') ? [path] : path;

    if (!paths || !_.compact(paths).length) return lines;

    let result = lines;
    for (let path of paths) {
      console.time(path);

      let before = result.length;
      if (by === 'email') {
        const emailRegExprG = /(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/g;

        let source = fs.readFileSync(path, 'utf8').toLowerCase();
        let emails = new Set(source.match(emailRegExprG));

        result = _.filter(result, (line) => {
          let thing = line[by];
          return !emails.has(thing.toLowerCase()) // (source.indexOf(thing) === -1);
        });

      } else {

        let source = fs.readFileSync(path, 'utf8');
        result     = _.filter(result, (line) => {
          let thing = line[by];
          // if (source.indexOf(thing) > -1) console.log(line);
          return (source.indexOf(thing) === -1);
        });

      }

      let now     = result.length;
      let removed = before - now;

      console.timeEnd(path);
      console.log(path, {removed, now});

    }
    return result;
  }

  async PrepareLinesViaHelper(base_path, remove_arr = [], remove_arr_v2 = [], remove_arr_v3=[], limit = 2000000) {
    let parseEmailPassword = this.parseEmailPassword;
    let left = this.left_name;
    let right = this.right_name;

    console.time('loading...');

    return new Promise((resolve, reject) => {
      let message = null;

      let exePath = path.resolve('./k7_helper.exe');
      if (!fs.existsSync(exePath)) {
        // Do something
        throw new Error('k7_helper.exe not exists!');
        process.exit();
      }

      let start = 0;
      let size = limit;
      let input = base_path;
      let remove1 = _.map(remove_arr, (path) => {return "v1|"+path;});
      let remove2 = _.map(remove_arr_v2, (path) => {return "v2|"+path;});
      let remove3 = _.map(remove_arr_v3, (path) => {return "v3|"+path;});

      console.info('Using k7_helper.exe for speedup');

      let accounts = [];

      let prc = spawn(exePath, [start, size, input, ...remove1, ...remove2, ...remove3]);

      let isMPsTime = false;

      prc.stdout.setEncoding('utf8');
      prc.stdout.on('data', function (data) {
        let str   = data.toString();

        if (str.indexOf('!PrintingLines!') > -1) {
          isMPsTime = true;
          return;
        }
        if (str.indexOf('!WorkFinished!') > -1) {
          return;
        }

        if (!isMPsTime) {
          console.log(str);
          return;
        }

        let lines = str.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line === "") continue;

          let [email, password] = parseEmailPassword(line);
          accounts.push({[left]:email, [right]:password})
        }
      });

      prc.on('close', function (code) {
        console.timeEnd('loading...');
        return resolve(accounts)
      });
    })
  }

}

module.exports = Base;
