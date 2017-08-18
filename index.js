#!/usr/bin/env node
'use strict';

const program = require('commander');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const spawn = require('cross-spawn');
const execSync = require('child_process').execSync;
const tmp = require('tmp');

const packageJson = require('./package.json');

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

if (!isCRAInstalled()) {
  console.error('No create-react-app instalation has been detected.');
  console.log('Please install create-react-app to continue.');
  console.log();
  console.log(
    `  ${chalk.cyan('npm')} install -g ${chalk.bold('create-react-app')}`
  );
  process.exit(1);
}

createApp(projectName)
  .then(() => {
    console.log();
    console.log(chalk.magenta('Applying custom template...'));
    console.log();

    // Clone template to a temp directory
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
          resolve(obj);
        });
      });
    });
  })
  .then(obj => {
    console.log();
    console.log('Installing template packages. This might take a couple of minutes.');

    const root = path.resolve(projectName);
    const originalDirectory = process.cwd();
    process.chdir(root);

    // Get dependencies to install
    const templatePackageJsonPath = path.resolve(obj.tmpdir, 'package.json');
    let templatePackageJson;

    try {
      templatePackageJson = require(templatePackageJsonPath);
    } catch (error) {
      return Promise.resolve(obj);
    }

    let templateDependencies = templatePackageJson.dependencies || {};

    // Does not include already installed dependencies
    // TODO: installed dependencies should be taken from package.json of just
    // created app
    const installedDependencies = ['react', 'react-dom', 'react-scripts'];

    installedDependencies.forEach(key => {
      delete templateDependencies[key];
    });

    // Install additional dependencies
    return install(templateDependencies).then(() => {
      const appPackageJson = require(path.join(root, 'package.json'));

      // Dependencies are already available in app package.json so we can safely
      // replace them. However we cannot replace template scripts with app
      // scripts since the template could contains scripts customization
      const scripts = Object.assign(
        {},
        appPackageJson.scripts,
        templatePackageJson.scripts
      );

      const packageJson = Object.assign(
        {},
        templatePackageJson,
        appPackageJson,
        { scripts }
      );

      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      return Object.assign({}, obj, { root });
    });
  })
  .then(obj => {
    // Merge folders and files
    const files = fs.readdirSync(obj.tmpdir);
    const skips = ['node_modules', 'package.json', 'package-lock.json', '.git'];
    let promises = [];

    for (const file of files) {
      if (skips.includes(file)) {
        continue;
      }

      const src = path.join(obj.tmpdir, file);
      const dest = path.join(obj.root, file);

      promises.push(
        new Promise((resolve, reject) => {
          fs.copy(src, dest, err => {
            if (err) {
              console.log(chalk.red(`- ${file}`));
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
    // Perform cleanup
    console.log();
    console.log(chalk.green('Template applied successfullly!'));
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

function createApp(name) {
  return new Promise((resolve, reject) => {
    const command = 'create-react-app';
    const args = [name];

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
