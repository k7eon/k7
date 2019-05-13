const {once}   = require('events');
const readLine = require('readline');
const fs       = require('fs');
const _        = require('lodash');

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
  async loadBase(base_path, remove_arr=[], remove_arr_v2=[], limit=2000000) {
    let reader = readLine.createInterface({
      input: fs.createReadStream(base_path),
      crlfDelay: Infinity
    });

    let result_lines = [];

    let lines      = [];
    let chunk_size = limit*1.2;

    reader.on('line', async (line) => {
      let [left, right] = this.parseEmailPassword(line);
      if (!left || !right) return;

      lines.push({[this.left_name]: left, [this.right_name]: right});

      if (lines.length === chunk_size) {
        reader.pause();
        result_lines = _.assign(result_lines, await this.removeLines(lines, remove_arr, remove_arr_v2));
        lines        = [];
        console.log('collected accounts', result_lines.length);

        if (result_lines.length > limit) {
          reader.close();
          return;
        }

        reader.resume();
      }
    });

    await once(reader, 'close');

    if (lines.length > 0) {
      result_lines = _.assign(result_lines, await this.removeLines(lines, remove_arr, remove_arr_v2));
    }

    return result_lines;
  }

  async loadBasePaths(name) {

    let queue_path   = `manager/${name}_queue.txt`;
    if (!fs.existsSync(queue_path)) fs.writeFileSync(queue_path, '');

    let reader = readLine.createInterface({
      input: fs.createReadStream(queue_path),
      crlfDelay: Infinity
    });
    let paths = [];
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
   * @param base_paths
   * @param remove_arr
   * @param remove_arr_v2
   * @param max_lines
   * @returns {Promise<Array>}
   */
  async loadQueue(base_paths, remove_arr, remove_arr_v2, max_lines = 2000000) {
    console.log('Loading accounts from queue');
    console.log('paths', base_paths.join('\n'));
    let lines = [];
    for (let base_path of base_paths) {
      let temp_lines = await this.loadBase(base_path, remove_arr, remove_arr_v2, max_lines);
      lines          = _.concat(lines, temp_lines);
      if (lines.length > max_lines) {
        lines.splice(max_lines, lines.length);
        break;
      }
    }
    return lines;
  }

  async _removeLinesFromFile(lines, path) {
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
      if (!left) return;

      if (emailPass[left] !== undefined) {
        emailPass[left] = undefined;
        return;
      }
    });

    console.time(path);
    await once(reader, 'close');

    lines          = _.compact(_.values(emailPass));
    let new_amount = lines.length;
    let removed = old_amount - new_amount;
    let now = new_amount;
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
   * @param {string|array} path  path/s to file whose lines will be removed from this.accounts through indexOf
   * @return {Array}
   */
  removeAccountsFromFileBy(by='email', lines, path = 'files/bad.log') {
    if (!lines.length) return [];
    let paths = (typeof path === 'string') ? [path] : path;
    let before = lines.length;

    for (let path of paths) {
      console.time(path);

      let source = fs.readFileSync(path, 'utf8');

      let lines = _.filter(lines, (line) => {
        let thing = line[by];
        return (source.indexOf(thing) === -1);
      });

      let now = lines.length;
      let removed = before-now;

      console.timeEnd(path);
      console.log(path, {removed, now});
    }
    return lines;
  }
}

module.exports = Base;
