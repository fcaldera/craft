#!/usr/bin/env node
'use strict';

const program = require('commander');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const spawn = require('cross-spawn');
const execSync = require('child_process').execSync;
const tmp = require('tmp');
const yaml = require('js-yaml');

const packageJson = require('./package.json');

const defaultSpec = {
  node_modules: 'ignore',
  'package.json': 'merge',
  'package-lock.json': 'ignore',
  'craft.yaml': 'ignore',
  'craft.yml': 'ignore',
  '.git': 'ignore',
};

let projectName;
let projectTemplate;

program
  .name('craft')
  .version(packageJson.version)
  .arguments('<project-directory> [template-url]')
  .usage(
    `${chalk.green('<project-directory>')} ${chalk.cyan(
      '<template-url>'
    )} [options]`
  )
  .action(function(name, template) {
    projectName = name;
    projectTemplate = template;
  })
  .parse(process.argv);

if (
  typeof projectName === 'undefined' ||
  typeof projectTemplate === 'undefined'
) {
  console.error('Please specify the project directory and template url:');
  console.log(
    `  ${chalk.cyan(program.name())} ${chalk.green(
      '<project-directory>'
    )} ${chalk.yellow('<template-url>')}`
  );
  console.log();
  console.log('For example:');
  console.log(
    `  ${chalk.cyan(program.name())} ${chalk.green(
      'my-react-app'
    )} ${chalk.yellow('https://github.com/cebroker/react-foundation')}`
  );
  console.log();
  console.log(
    `Run ${chalk.cyan(`${program.name()} --help`)} to see all options.`
  );
  process.exit(1);
}

const root = path.resolve(projectName);
const npx = isNPXAvailable();

if (!npx && !isCRAInstalled()) {
  console.error('No create-react-app installation has been detected.');
  console.log('Please install create-react-app to continue.');
  console.log();
  console.log(
    `  ${chalk.cyan('npm')} install -g ${chalk.bold('create-react-app')}`
  );
  process.exit(1);
}

createApp(projectName, npx)
  .then(() => {
    console.log();
    console.log(chalk.magenta('Applying custom template...'));
    console.log();

    // Clone template to a temp directory and read the spec file
    return getTemporaryDirectory().then(obj => {
      return new Promise((resolve, reject) => {
        const command = 'git';
        const args = ['clone', projectTemplate, obj.tmpdir];
        const child = spawn(command, args, { stdio: 'inherit' });

        child.on('close', code => {
          if (code !== 0) {
            reject({
              command: `${command} ${args.join(' ')}`
            });
          }
          Object.assign(obj, readConfig(obj.tmpdir));
          resolve(obj);
        });
      });
    });
  })
  .then(obj => {
    // Delete folders and files
    console.log();
    console.log('Deleting files...');

    const files = Object.keys(obj.spec).filter(file => obj.spec[file] === 'delete');
    const promises = [];

    for (const file of files) {
      const target = path.join(root, file);
      promises.push(
        new Promise((resolve, reject) => {
          fs.remove(target, err => {
            if (err) {
              console.log(chalk.red(`! ${file}`));
            } else {
              console.log(`- ${file}`);
            }
            resolve();
          });
        })
      );
    }
    return Promise.all(promises).then(() => obj);
  })
  .then(obj => {
    // Copy folders and files
    console.log();
    console.log('Copying files...');

    const files = fs.readdirSync(obj.tmpdir);

    const skip = file => {
      const directive = obj.spec[file];
      return directive && directive !== 'replace';
    };

    const prefixLength = obj.tmpdir.length + 1;
    const filter = (src, dest) => !skip(src.substring(prefixLength));
    const promises = [];

    for (const file of files) {
      if (skip(file)) {
        continue;
      }

      const src = path.join(obj.tmpdir, file);
      const dest = path.join(root, file);

      promises.push(
        new Promise((resolve, reject) => {
          fs.copy(src, dest, { filter }, err => {
            if (err) {
              console.log(chalk.red(`! ${file}`));
            } else {
              console.log(`+ ${file}`);
            }
            resolve();
          });
        })
      );
    }
    return Promise.all(promises).then(() => obj);
  })
  .then(obj => {
    if (obj.spec['package.json'] !== 'merge') {
      return obj;
    }

    console.log();
    console.log('Installing template packages...');

    const originalDirectory = process.cwd();
    process.chdir(root);

    // Get dependencies to install
    const templatePackageJsonPath = path.resolve(obj.tmpdir, 'package.json');
    let templatePackageJson;

    try {
      templatePackageJson = fs.readJsonSync(templatePackageJsonPath);
    } catch (error) {
      return Promise.resolve(obj);
    }

    const templateDependencies = templatePackageJson.dependencies || {};

    // Exclude dependencies that were already installed when the app was created
    const appPackageJsonPath = path.join(root, 'package.json');
    let appPackageJson = fs.readJsonSync(appPackageJsonPath);
    Object.keys(appPackageJson.dependencies || {}).forEach(key => {
      delete templateDependencies[key];
    });

    // Install additional dependencies
    return install(templateDependencies).then(() => {

      // Re-read the app package.json to get updated dependencies
      appPackageJson = fs.readJsonSync(appPackageJsonPath)

      // Dependencies are already available in app package.json so we can safely
      // replace them. However we cannot replace template scripts with app
      // scripts since the template could contains scripts customization
      const scripts = Object.assign(
        {},
        appPackageJson.scripts,
        templatePackageJson.scripts
      );

      // As the default ESLint configuration is fully captured in the sharable
      // eslint-config-react-app package, we don't expect any changes in the
      // app package.json. So, we allow any customizations in the template to
      // take precendence.
      const eslintConfig = templatePackageJson.eslintConfig || appPackageJson.eslintConfig;

      const packageJson = Object.assign(
        {},
        templatePackageJson,
        appPackageJson,
        { scripts, eslintConfig }
      );

      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );
      return obj;
    });
  })
  .then(obj => {
    // Perform cleanup
    console.log();
    console.log(chalk.green('Template applied successfully!'));
    obj.cleanup();
  })
  .catch(reason => {
    console.log();
    console.log('Aborting installation.');
    if (reason.command) {
      console.log(`  ${chalk.cyan(reason.command)} has failed.`);
    } else {
      console.log(chalk.red('Unexpected error. Please report it as a bug:'));
      console.log(reason);
    }
    console.log();
  });

function createApp(name, npx) {
  return new Promise((resolve, reject) => {
    const command = npx ? 'npx' : 'create-react-app';
    const args = npx ? ['create-react-app', name] : [name];

    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('close', code => {
      if (code !== 0) {
        reject({
          command: `${command} ${args.join(' ')}`
        });
        return;
      }
      resolve();
    });
  });
}

function isNPXAvailable() {
  try {
    execSync('npx --version', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function isCRAInstalled() {
  try {
    execSync('create-react-app --version', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function getTemporaryDirectory() {
  return new Promise((resolve, reject) => {
    // Unsafe cleanup lets us recursively delete the directory if it contains
    // contents; by default it only allows removal if it's empty
    tmp.dir({ unsafeCleanup: true }, (err, tmpdir, callback) => {
      if (err) {
        reject(err);
      } else {
        resolve({
          tmpdir: tmpdir,
          cleanup: () => {
            try {
              callback();
            } catch (ignored) {
              // Callback might throw and fail, since it's a temp directory the
              // OS will clean it up eventually...
            }
          }
        });
      }
    });
  });
}

function readConfig(templateDir) {
  const yamlFile = 'craft.yaml';
  const yamlPath = path.join(templateDir, yamlFile);
  const ymlFile = 'craft.yml'
  const ymlPath = path.join(templateDir, ymlFile);
  let configFile, configPath;
  let config = {};

  if (fs.existsSync(yamlPath)) {
    configFile = yamlFile;
    configPath = yamlPath;
  } else if (fs.existsSync(ymlPath)) {
    configFile = ymlFile;
    configPath = ymlPath;
  }

  if (configPath) {
    console.log(`Using craft configuration from ${configFile}.`);
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      config = normalizeConfig(yaml.safeLoad(configContent, { json: true }));
    } catch (err) {
      console.log(chalk.red(`Failed to read ${configFile}. Using defaults.`));
      console.log(err);
    }
  }
  return config;
}

function normalizeConfig(config = {}) {
  const directives = [ 'ignore', 'delete', 'replace'];
  const spec = Object.assign({}, defaultSpec);
  const add = (directive, value) => {
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') {
        const filePath = value.toString().replace(/\//g, path.sep);
        spec[filePath] = directive;
      } else {
        const dir = chalk.red(directive);
        console.log(`Invalid value for directive ${dir}: ${value}.`);
    }
  }

  if (config.spec) {
    Object.keys(config.spec).forEach(directive => {
      if (directives.includes(directive)) {
        const value = config.spec[directive];
        if (Array.isArray(value)) {
          value.forEach(val => add(directive, val));
        } else {
          add(directive, value);
        }
      } else {
        console.log(`Invalid directive: ${chalk.red(directive)}.`);
      }
    });
  }
  return { spec };
}

function install(dependencies) {
  return new Promise((resolve, reject) => {
    let args = [
      'install',
      '--save',
      //'--save-exact',
      '--loglevel',
      'error'
    ];

    args = args.concat(
      Object.keys(dependencies).map(key => {
        return `${key}@${dependencies[key]}`;
      })
    );

    const child = spawn('npm', args, { stdio: 'inherit' });
    child.on('close', code => {
      if (code !== 0) {
        reject({
          command: `${command} ${args.join(' ')}`
        });
        return;
      }
      resolve();
    });
  });
}
