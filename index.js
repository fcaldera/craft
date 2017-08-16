#!/usr/bin/env node
'use strict';

const program = require('commander');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const packageJson = require('./package.json');

let projectName;
let projectTemplate; 

program
  .name('craft')
  .version(packageJson.version)
  .arguments('<project-directory> <template-url>')
  .usage(`${chalk.green('<project-directory>')} ${chalk.cyan('<template-url>')} [options]`)
  .action(function (name, template) {
    projectName = name;
    projectTemplate = template
  }).parse(process.argv);
  
if (typeof projectName === 'undefined' || typeof projectTemplate === 'undefined') {
  console.error('Please specify the project directory:');
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
  

