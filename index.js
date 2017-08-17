#!/usr/bin/env node
'use strict';

const program = require('commander');
const fs = require('fs');
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
  .usage(`${chalk.green('<project-directory>')} ${chalk.cyan('<template-url>')} [options]`)
  .action(function (name, template) {
    projectName = name;
    projectTemplate = template
  }).parse(process.argv);
  
if (typeof projectName === 'undefined' || typeof projectTemplate === 'undefined') {
  console.error('Please specify the project directory and template url:');
  console.log(
    `  ${chalk.cyan(program.name())} ${chalk.green('<project-directory>')} ${chalk.yellow('<template-url>')}`
  );
  console.log();
  console.log('For example:');
  console.log(`  ${chalk.cyan(program.name())} ${chalk.green('my-react-app')} ${chalk.yellow('https://github.com/cebroker/react-foundation')}`);
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
  console.log(`  ${chalk.cyan('npm')} install -g ${chalk.bold('create-react-app')}`)
  process.exit(1);
}

createApp(projectName).then(() => {
  console.log();
  // Clone template repositoty to a temporary directory
  return cloneTemplate(projectTemplate).then(obj => obj);
}).then((obj) => {
  console.log();
  console.log('Applying custom template...');



  obj.cleanup();

}).catch(reason => {
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

function cloneTemplate(template) {

  return getTemporaryDirectory()
    .then((obj) => {
      return new Promise((resolve, reject) => {
        const command = 'git';
        const args = ['clone', template, obj.tmpdir];
        const child = spawn(command, args, { stdio: 'inherit' });
  
        child.on('close', code => {
          if (code !== 0) {
            reject({
              command: `${command} ${args.join(' ')}`,
            });
          }
          resolve(obj);
        });
      })
    });
}

function createApp(name) {
  return new Promise((resolve, reject) => {
    const command = 'create-react-app';
    const args = [name];

    // const child = spawn(command, args, { stdio: 'inherit' });
    // child.on('close', code => {
    //   if (code !== 0) {
    //     reject({
    //       command: `${command} ${args.join(' ')}`,
    //     });
    //     return;
    //   }
       resolve();
    // });
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
          },
        });
      }
    });
  });
}

