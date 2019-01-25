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

const defaultSpec = {
  node_modules: 'ignore',
  'package.json': 'merge',
  'package-lock.json': 'ignore',
  'craft.spec': 'ignore',
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
          obj.spec = readSpec(obj.tmpdir);
          resolve(obj);
        });
      });
    });
  })
  .then(obj => {
    // Delete folders and files
    console.log();
    console.log('Deleting files...');

    const files = Object.keys(obj.spec).filter(file => obj.spec[file] === "delete");
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
      return directive && directive !== "replace";
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
    if (obj.spec['package.json'] !== "merge") {
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

function readSpec(templateDir) {
  const specFile = 'craft.spec'
  const specPath = path.join(templateDir, specFile);
  const directives = [ 'ignore', 'delete', 'replace'];
  const spec = Object.assign({}, defaultSpec);

  if (fs.existsSync(specPath)) {
    console.log(`Using template specification from ${specFile}.`);
    try {
      fs.readFileSync(specPath, 'utf8').split(/\r?\n/).forEach(line => {
        if (line.charAt(0) !== '#') {
          const match = /^(.*?):[ \t]*(.*)$/.exec(line);
          if (match) {
            const [, filePath, directive] = match;
            if (directives.includes(directive)) {
              const platformPath = filePath.replace(/\//g, path.sep);
              spec[platformPath] = directive;
            } else {
              const d = chalk.red(directive)
              console.log(`Invalid directive for file ${filePath}: ${d}.`);
            }
          }
        }
      });
    } catch (err) {
      console.log(chalk.red(`Failed to read ${specFile}. Using defaults.`));
    }
  }
  return spec;
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
