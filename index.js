'use strict';

const path = require('path');
const fs = require('fs-extra');
const child = require('child_process');
const chalk = require('chalk');
const minimist = require('minimist');
const asciiLogo = require('@ngx-rocket/ascii-logo');
const pkg = require('./package.json');

const isWin = /^win/.test(process.platform);
const appName = path.basename(process.argv[1]);
const help = `${chalk.bold('Usage')} ${appName} ${chalk.blue('[command]')} [options]\n`;
const detailedHelp = `
${chalk.blue('env2json')} <env_var> [<env_var2> ...] [-o <file.json>]
  Export environment variables to a JSON file.
  Default output file is ${chalk.cyan('src/environments/.env.json')}

${chalk.blue('cordova')} <command> [options] [-- <cordova_options>]
  Execute Cordova commands.
  Unless the ${chalk.cyan('--fast')} option is provided, the Angular app is
  rebuilt before executing the command, using ${chalk.cyan('npm run build')}.
  Any accepted Cordova option can be passed through after ${chalk.cyan('--')}.

  --fast            Skip Angular app rebuild
  --copy <path>     Copy built apps to path (only work with ${chalk.cyan('cordova build')})
  --dev             Build Angular app in dev mode (default is prod)
  -e, --env <name>  Target environment for ${chalk.cyan('npm run build')}
  --device          Deploy Cordova build to a device
  --emulate         Deploy Cordova build to an emulator
  --debug           Create a Cordova debug build
  --release         Create a Cordova release build
  --yarn            Use Yarn instead of NPM to run the ${chalk.cyan('build')} script

${chalk.blue('clean')} [--cordova] [--dist] [--path <path>]
  Clean Cordova (${chalk.cyan('platforms')}, ${chalk.cyan('plugins')}) and dist folders.

  --cordova         Remove only Cordova folders
  --dist            Remove only dist folder
  --path <path>     Remove only specified path

${chalk.blue('unpin-ionic-dependencies')}
  Unpin Ionic dependencies.
  This removes ${chalk.cyan('peerDependencies')} from ionic-angular's ${chalk.cyan('package.json')}.
  The Ionic team insist on fixing their dependencies to exact versions which
  prevents getting bugfixes and new features outside of their release schedule
  (see https://github.com/ionic-team/ionic/issues/11741 for example).
  Running this allows you using higher dependencies versions that specified in
  Ionic without warnings all the way.
`;

class NgxScriptsCli {
  constructor(args) {
    this._args = args;
    this._options = minimist(args, {
      boolean: ['help', 'fast', 'dev', 'device', 'emulate', 'debug', 'release', 'yarn', 'cordova', 'dist'],
      string: ['o', 'copy', 'env', 'path'],
      alias: {e: 'env'}
    });
  }

  run() {
    if (this._options.help) {
      return this._help(true);
    }
    switch (this._args[0]) {
      case 'env2json':
        return this._env2json(this._options._.slice(1), this._options.o);
      case 'cordova':
        return this._cordova(this._options);
      case 'clean':
        return this._clean(this._options);
      case 'unpin-ionic-dependencies':
        return this._unpinIonicDependencies();
      default:
        this._help();
    }
  }

  _env2json(vars, outputFile = 'src/environments/.env.json') {
    if (!vars.length) {
      this._exit(`${chalk.red('Missing arguments')}\n`);
    }
    const env = JSON.stringify(vars.reduce((env, v) => {
      env[v] = process.env[v];
      return env;
    }, {}));

    try {
      fs.writeFileSync(outputFile, env);
    } catch (err) {
      this._exit(`${chalk.red(`Error writing file: ${err && err.message ? err.message : err}`)}`);
    }
  }

  _cordova(options) {
    if (!options.fast) {
      const buildOptions = ['build', '--'];
      if (options.dev) {
        buildOptions.push('--dev');
      }
      if (options.env) {
        buildOptions.push('--env');
        buildOptions.push(options.env);
      }
      child.spawnSync(options.yarn ? 'yarn' : 'npm run', buildOptions, {stdio: 'inherit'});
    }

    const cordovaOptions = options._.slice(1);
    cordovaOptions.push('--no-telemetry');
    ['device', 'emulate', 'debug', 'release'].forEach(option => {
      if (options[option]) {
        cordovaOptions.push('--' + option);
      }
    });
    child.spawnSync(`cordova`, cordovaOptions, {stdio: 'inherit'});

    if (options._['0'] === 'build' && options.copy) {
      try {
        fs.ensureDirSync(options.copy);
        const androidPath = `platforms/android/build/outputs/apk/*-${options.release ? 'release' : 'debug'}.apk`;
        let copied = false;
        copied = copied || this._copy(androidPath, options.copy);
        copied = copied || this._copy('platforms/ios/build/device/*.ipa', options.copy);
        if (copied) {
          console.log(`Apps copied to ${chalk.cyan(options.copy)} folder`);
        } else {
          throw new Error('No app builds found');
        }
      } catch (err) {
        this._exit(`${chalk.red(`Error during apps copy: ${err && err.message ? err.message : err}`)}`);
      }
    }
  }

  _copy(src, dest) {
    try {
      child.execSync(`${isWin ? 'xcopy /S /Y' : 'cp -Rf'} ${src} ${dest}`, {stdio: 'ignore'});
      return true;
    } catch (err) {
      return false;
    }
  }

  _clean(options) {
    if (!options.cordova && !options.dist && !options.path) {
      options.cordova = true;
      options.dist = true;
    }
    if (options.cordova) {
      this._remove('platforms');
      this._remove('plugins');
    }
    if (options.dist) {
      let angularCliConfig;
      try {
        angularCliConfig = require(path.join(process.cwd(), '.angular-cli.json'));
      } catch (err) {
        this._exit(`${chalk.red(`Error reading .angular-cli.json: ${err && err.message ? err.message : err}`)}`);
      }
      angularCliConfig.apps.forEach(app => this._remove(app.outDir));
    }
    if (options.path) {
      fs.removeSync(options.path);
    }
  }

  _remove(path) {
    try {
      fs.removeSync(path);
      console.log(`Removed ${chalk.yellow(path)}`);
    } catch (err) {
      this._exit(`${chalk.red(`Error while removing ${path}: ${err && err.message ? err.message : err}`)}`);
    }
  }

  _unpinIonicDependencies() {
    try {
      const pkgPath = path.join(process.cwd(), 'node_modules/ionic-angular/package.json');
      const pkg = require(pkgPath);
      pkg.peerDependencies = {};

      try {
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
      } catch (err) {
        this._exit(`${chalk.red(`Error writing file: ${err && err.message ? err.message : err}`)}`);
      }
    } catch (err) {
      this._exit(`${chalk.red(`Error with ionic package: ${err && err.message ? err.message : err}`)}`);
    }
  }

  _help(details) {
    console.log(asciiLogo(pkg.version, 'APP SUPPORT SCRIPTS'));
    this._exit(help + (details ? detailedHelp : `Use ${chalk.white('--help')} for more info.\n`));
  }

  _exit(error, code = 1) {
    console.error(error);
    process.exit(code);
  }
}

module.exports = NgxScriptsCli;