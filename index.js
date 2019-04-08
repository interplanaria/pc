#!/usr/bin/env node
var en = require('dotenv').config()
var originalEnv = en.parsed
const program = require('commander')
const YAML = require('yaml')
const bsv = require('bsv')
const Stream = require('stream')
const Message = require('bsv-message');
const inquirer = require('inquirer')
const semver = require('semver')
const ip = require('ip')
const fs = require('fs')
const axios = require('axios')
const FormData = require('form-data');
const HOST = "https://planaria.network"
const spawn = require('child_process').spawn;
const Docker = require('dockerode');
const mkdirp = require('mkdirp');
const path = require('path');
const docker = new Docker()
const treeify = require('treeify');
const homedir = require('os').homedir();
const images = {
  write: "interplanaria/planaria",
  read: "interplanaria/planarium"
}
const Table = require('cli-table');
const createKey = function() {
  let privateKey = new bsv.PrivateKey();
  let address = privateKey.toAddress();
  let pubKey = privateKey.toPublicKey();
  return {privateKey: privateKey.toWIF(), address: address.toString(), publicKey: pubKey.toString()}
}
const stringify = function (o) {
  return JSON.stringify(o, function (key, value) {
    if (value instanceof Function || typeof value == 'function') {
      return value.toString();
    }
    return value;
  });
};
const ask = {
  init: function(cb) {
    inquirer.prompt([
      { type: 'input', name: 'NAME', message: "Project Name", default: process.cwd().split('/').pop() },
      { type: 'input', name: 'DESCRIPTION', message: "Project Description", default: "" },
      { type: 'input', name: 'VERSION', message: "Version", default: "0.0.1" }
    ]).then(function(answers) {
      cb(answers)
    });
  },
  login: function(cb) {
    inquirer.prompt([
      { type: 'input', name: 'filename', message: "Enter the path in which to save the key", default: homedir + "/.planaria/users" },
    ]).then(function(answers) {
      cb(answers)
    });
  },
  start: {
    planaria: function(cb) {
      let _path = process.cwd()
      inquirer.prompt([
        { type: 'input', name: 'DATA_DIR', message: "DB Storage Path?", default: (process.env.DATA_DIR ? process.env.DATA_DIR : './db') },
        { type: 'input', name: 'ASSETS_DIR', message: "File Serve Assets Storage Path?", default: (process.env.ASSETS_DIR ? process.env.ASSETS_DIR : './assets') },
        { type: 'input', name: 'FS_DIR', message: "File System Storage Path?", default: (process.env.FS_DIR ? process.env.FS_DIR : './fs') },
        { type: 'input', name: 'MAX_MEMORY', message: "Max Memory in GB", default: (process.env.MAX_MEMORY ? process.env.MAX_MEMORY : 1) },
        { type: 'input', name: 'BITCOIN_USER', message: "Bitcoin JSON-RPC Username", default: (process.env.BITCOIN_USER ? process.env.BITCOIN_USER : "root") },
        { type: 'input', name: 'BITCOIN_PASSWORD', message: "Bitcoin JSON-RPC Password", default: (process.env.BITCOIN_PASSWORD ? process.env.BITCOIN_PASSWORD : "bitcoin") },
        { type: 'confirm', name: 'FAT', message: "[Experimental] Include raw transactions in events? (May consume more memory)", default: false },
      ]).then(function(answers) {
        cb(answers)
      });
    },
    planarium: function(cb) {
      let _path = process.cwd()
      inquirer.prompt([
        { type: 'input', name: 'DOMAIN', message: 'Human Friendly API Domain for this Server (Ex: https://bitdb.network)', default: (process.env.DOMAIN ? process.env.DOMAIN : "http://" + ip.address() + ":3000" ) },
        { type: 'input', name: 'PLANARIUM_PORT', message: 'Planarium container port to expoose', default: (process.env.PLANARIUM_PORT ? process.env.PLANARIUM_PORT : 3000) },
        { type: 'confirm', name: 'JOIN', message: 'Join the Planaria Network? (Otherwise private)', default: true }
      ]).then(function(answers) {
        cb(answers)
      });
    }
  }
}
const write = {
  _str: function(_path, content) {
    console.log("Writing to", _path)
    var stream = fs.createWriteStream(_path)
    stream.once('open', function(fd) {
      stream.write(content)
      stream.end();
    });
  },
  str: function(_path, filename, content) {
    write._str(_path + "/" + filename, content)
  },
  _lines: function(_path, lines, filter, cb) {
    console.log("Writing to", _path)
    var stream = fs.createWriteStream(_path)
    stream.once('open', function(fd) {
      lines.forEach(function(line) {
        if (filter) {
          stream.write(filter(line) + "\n")
        } else {
          stream.write(line + "\n")
        }
      })
      stream.end();
      if (cb) cb()
    });
  },
  lines: function(_path, filename, lines, filter, cb) {
    console.log("Writing to", filename)
    write._lines(_path + "/" + filename, lines, filter, cb)
  }
}
const rewind = function(height, addrs, cb) {
  console.log("Rewind to", height, addrs)
  //let aria = spawn("docker-compose", ["-f", "planaria.yml", "run", "--entrypoint", "/planaria/entrypoint.sh start 4096 fix " + height, "planaria"], {
  let en = Object.create( process.env );
  en.ARG1 = "fix"
  en.ARG2 = height
  if (addrs) { en.ARG3 = addrs }
  let aria = spawn("docker-compose", ["-p", "planaria", "-f", "planaria.yml", "up", "-d"], {
    stdio: 'inherit', env: en
  })
  aria.on('exit', function(code) {
    console.log("Rewind Planaria to", height, "Finished", code)
    console.log("Starting Planarium...")
    let arium = spawn("docker-compose", ["-p", "planarium", "-f", "planarium.yml", "up", "-d"], { stdio: 'inherit' })
    arium.on('exit', function(code) {
      console.log("Started planarium", code)
      if (cb) cb()
    })
  })
}
const logs = {
  _run: function(action, size) {
    docker.listContainers(function (err, containers) {
      if (containers.length > 0) {
        let cs = containers.filter(function(item) {
          return item.Image.startsWith(images[action])
        })
        if (cs.length > 0) {
          // assume there's only one container
          let c = cs[0]
          if (!size) size = 1000
          let p = spawn("docker", ["logs", "-f", c.Id, "--tail", size], { stdio: 'inherit' })
          p.on('exit', function(code) {
            console.log("Exited", code)
          })
        }
      } else {
        console.log("No container to log from")
      }
    })
  },
  planarium: function(size) {
    logs._run("read", size)
  },
  planaria: function(size) {
    logs._run("write", size)
  },
}
const stop = {
  _run: function(containers, action, cb) {
    let cs = containers.filter(function(item) {
      return item.Image.startsWith(images[action])
    })
    if (cs.length > 0) {
      console.log("Stopping containers...\n", cs)
      cs = cs.map(function(item) {
        return {
          id: item.Id,
          image: item.Image
        }
      })
      let counter = 0
      cs.forEach(function(info) {
        docker.getContainer(info.id).stop(function() {
          counter++
          console.log("Stopped", info.image, info.id)
          if (counter >= cs.length) {
            if (cb) cb()
          }
        });
      })
    } else {
      if (cb) cb()
      console.log("No such container to stop", cs)
    }
  },
  planaria: function(cb) {
    docker.listContainers(function (err, containers) {
      console.log("Planaria Containers = ", containers, err)
      stop._run(containers, "write", cb)
    })
  },
  planarium: function(cb) {
    docker.listContainers(function (err, containers) {
      console.log("Planarium Containers = ", containers, err)
      stop._run(containers, "read", cb)
    })
  },
  all: function(cb) {
    docker.listContainers(function (err, containers) {
      // stop read first and then stop write
      stop._run(containers, "read", function() {
        stop._run(containers, "write", cb)
      })
    })
  }
}
const update = {
  planaria: function(version, cb) {
    stop.planaria(function() {
      // set env.PLANARIA
      if (!version) { version = "latest" }
      console.log("Updating planaria image to", version)
      updateEnv({ PLANARIA: "interplanaria/planaria:" + version }, function() {
        let aria = spawn("docker-compose", ["-f", "planaria.yml", "pull"], { stdio: 'inherit' })
        aria.on('exit', function(code) {
          console.log("Updated planaria", code)
          if (cb) cb()
        })
      })
    })
  },
  planarium: function(version, cb) {
    stop.planarium(function() {
      // set env.PLANARIUM
      if (!version) { version = "latest" }
      console.log("Updating planarium image to", version)
      updateEnv({ PLANARIUM: "interplanaria/planarium:" + version }, function() {
        let aria = spawn("docker-compose", ["-f", "planarium.yml", "pull"], { stdio: 'inherit' })
        aria.on('exit', function(code) {
          console.log("Updated planarium", code)
          if (cb) cb()
        })
      })
    })
  },
  all: function(cb) {
    stop.all(function() {
      update.planaria(null, function() {
        update.planarium(null, function() {
        })
      })
    })
  }
}
const updateEnv = function(answers, cb) {
  let envkeys = Object.keys(answers)
  let envs = envkeys.map(function(key) {
    process.env[key] = answers[key]
    return key + "=" + answers[key]
  })
  if (!originalEnv) originalEnv = {}
  console.log("answers = ", answers)
  envkeys.forEach(function(key) {
    originalEnv[key] = answers[key]
  })
  let unchangedEnv = Object.keys(originalEnv).filter(function(key) {
    return !envkeys.includes(key)
  })
  console.log("unchangedEnv = ", unchangedEnv)
  console.log("originalEnv = ", originalEnv)
  console.log("envs before = ", envs)
  unchangedEnv.forEach(function(k) {
    envs.push(k + "=" + originalEnv[k])
  })
  if (!originalEnv.PLANARIA) {
    console.log("No PLANARIA env, adding...")
    envs.push("PLANARIA=interplanaria/planaria")
  }
  if (!originalEnv.PLANARIUM) {
    console.log("No PLANARIUM env, adding...")
    envs.push("PLANARIUM=interplanaria/planarium")
  }
  console.log("envs after = ", envs)
  write.lines(process.cwd(), ".env", envs, null, cb)
}
const start = {
  planaria: function(cb) {
    // 1. Questionnaire: DATA_DIR, MAX_MEMORY, DOMAIN
    ask.start.planaria(function(answers) {
      let _path = process.cwd()
      let dirs = fs.readdirSync(_path + "/genes").filter(function (file) {
        return fs.statSync(_path+'/genes/'+file).isDirectory();
      });
      // get addresses
      answers.ADDRESS = dirs.join(',')
      answers.HOST = ip.address()
      console.log("update to", answers)

      let resolvedPath = path.resolve(_path, answers.ASSETS_DIR)
      console.log("Resolved ASSETS_DIR = ", resolvedPath)
      mkdirp(resolvedPath, function(err) {
        if (err) {
          console.log(err)
          process.exit(1)
        } else {
          let fsPath = path.resolve(_path, answers.FS_DIR)
          console.log("Resolved FS_DIR = ", fsPath)
          mkdirp(fsPath, function(err2) {
            if (err2) {
              console.log(err2)
              process.exit(1)
            } else {
              updateEnv(answers, function() {
                console.log("start planaria", originalEnv)
                let aria = spawn("docker-compose", ["-p", "planaria", "-f", "planaria.yml", "up", "-d"], { stdio: 'inherit' })
                aria.on('exit', function(code) {
                  console.log("Started planaria", code)
                  if (cb) cb()
                })
              })
            }
          })
        }
      })
    })
  },
  planarium: function(cb) {
    ask.start.planarium(function(answers) {
      let _path = process.cwd()
      let dirs = fs.readdirSync(_path + "/genes").filter(function (file) {
        return fs.statSync(_path+'/genes/'+file).isDirectory();
      });
      // get addresses
      answers.ADDRESS = dirs.join(',')
      answers.HOST = ip.address()
      console.log("update to", answers)
      updateEnv(answers, function() {
        console.log("Starting Planarium...")
        let arium = spawn("docker-compose", ["-p", "planarium", "-f", "planarium.yml", "up", "-d"], { stdio: 'inherit' })
        arium.on('exit', function(code) {
          console.log("Started planarium", code)
          if (cb) cb()
        })
      })
    })
  },
  all: function() {
    // 2. Ask planaria.yml, planarium.yml with MAX_MEMORY, DATA_DIR, HOST, and ADDRESS
    try {

      // Generate NODE_KEY and NODE_ADDRESS if they don't exist yet
      /*
      if (!(process.env.NODE_KEY && process.env.NODE_ADDRESS)) {
        console.log("NODE_KEY and NODE_ADDRESS doesn't exist. Generating...")
        let key = createKey()
        let currentPath = process.cwd()
        write.lines(currentPath, ".env", [
          "NODE_KEY="+key.privateKey,
          "NODE_ADDRESS="+key.address
        ])
        answers.NODE_ADDRESS = key.address
      } else {
        answers.NODE_ADDRESS = process.env.NODE_ADDRESS
      }
      */

      console.log("Starting Planaria...")
      // start write first and then read
      start.planaria(function() {
        start.planarium(function() {
        })
      })
    } catch (e) {
      console.log(e, "the 'start' command must be run in the root folder")
      process.exit(1)
    }
  }
}
const init = function() {
  if (process.argv.length >= 3) {
    let cmd = process.argv[2]
    if (cmd === 'join') {
      if (process.env.NODE_KEY) {
        // 3. Sign version number and append the signature
        let privateKey = new bsv.PrivateKey(process.env.NODE_KEY)
        let timestamp = Date.now().toString()
        let message = new Message(timestamp)
        let sig = message.sign(privateKey);
        console.log("Joining..")
        axios.post("http://localhost:3000/join", {
          timestamp: timestamp,
          signature: sig
        }).then(function(response) {
          console.log(response)
        }).catch(function(e) {
          console.log(e)
        })
      } else {
        console.log("The root folder must contain an .env file with NODE_ADDRESS and NODE_KEY")
      }
    } else if (cmd === 'push') {
      /*******************************************
      *
      *   $ pc push
      *
      *   1. Read the files:
      *     - README.md
      *     - planaria.js
      *     - package.json
      *   2. Check the key from .env
      *   3. Sign the version number and attach to the form
      *   4. Attach file contents to the form
      *   5. Attach text fields
      *   6. Submit
      *
      *******************************************/
      if (!fs.existsSync(process.cwd() + "/planaria.js")) {
        console.log("Cannot push from a non-gene folder. Please try again inside a gene folder")
        return
      }
      if (!fs.existsSync(process.cwd() + "/planarium.js")) {
        console.log("Cannot push from a non-gene folder. Please try again inside a gene folder")
        return
      }
      let plan = require(process.cwd() + "/planaria.js")
      if (plan.version && semver.valid(plan.version)) {
        var form = new FormData();
        // 1. Read the files
        let content = {
          planaria: fs.createReadStream(process.cwd() + '/planaria.js'),
          planarium: fs.createReadStream(process.cwd() + '/planarium.js'),
          readme: fs.createReadStream(process.cwd() + '/README.md'),
          package: fs.createReadStream(process.cwd() + '/package.json')
        }
        // 2. Check the key from .env
        if (process.env.KEY) {
          // 3. Sign version number and append the signature
          let privateKey = new bsv.PrivateKey(process.env.KEY)
          let message = new Message(plan.version)
          let sig = message.sign(privateKey);
          form.append('signature', sig)
          // 4. Append file contents
          for(let key in content) {
            form.append(key, content[key])
          }
          // 5. Append text fields
          if (plan.name) form.append('name', plan.name)
          if (plan.description) form.append('description', plan.description)
          if (plan.address) form.append('address', plan.address)
          if (plan.version) form.append('version', plan.version)
          if (plan.index) form.append('index', JSON.stringify(plan.index))
          // 6. Submit
          let r = ""
          console.log("Submitting...")
          form.submit(HOST + "/publish", function(err, res) {
            res.on('data', function(data) {
              r += data;
            })
            .on('end', function() {
              console.log("Response = ", r)
            })
            res.resume();
          });
        } else {
          console.log("Keypair doesn't exist.")
          process.exit()
        }
      } else {
        console.log("Error: invalid semantic version")
        process.exit()
      }
    } else if (cmd === 'start') {
      /*******************************************
      *
      *   REMOTE Start
      *
      *   $ pc start
      *
      *   1. ask DATA_DIR and MAX_MEMORY
      *   2. update .env
      *   3. Run
      *
      *******************************************/
      if (process.argv.length >= 4) {
        let action = process.argv[3]
        if (action === 'write') {
          // write => planaria
          start.planaria()
        } else if (action === 'read') {
          // read => planarium
          start.planarium()
        }
      } else {
        // both write + read
        start.all()
      }
    } else if (cmd === 'rewind') {
      /*******************************************
      *
      *   Rewind to block height
      *
      *   $ pc rewind [height]
      *
      *   1. ask DATA_DIR and MAX_MEMORY
      *   2. update .env
      *   3. Run
      *
      *******************************************/
      if (process.argv.length >= 4) {
        // stop first
        stop.all(function() {
          console.log("Stopped Planaria + Planarium")
          // get height
          let height = parseInt(process.argv[3])
          let addrs = null
          if (process.argv.length >= 5) {
            addrs = process.argv[4]
          }
          // rewind
          rewind(height, addrs, function() {
            // restart
            //start.all()
          })
        })
      }
    } else if (cmd === 'logs') {
      /*******************************************
      *
      *   Log
      *
      *   $ pc logs read
      *   $ pc logs write
      *   $ pc logs read 100
      *   $ pc logs write 100
      *
      *******************************************/
      if (process.argv.length >= 4) {
        let action = process.argv[3]
        let size = 1000
        if (process.argv.length >= 5) {
          size = parseInt(process.argv[4])
        }
        console.log("Logging starting from last", size)
        if (action === 'write') {
          // write => planaria
          logs.planaria(size)
        } else if (action === 'read') {
          // read => planarium
          logs.planarium(size)
        }
      }
    } else if (cmd === 'update') {
      /*******************************************
      *
      *   UpdatePlanaria + Planarium Docker Images
      *
      *   Uppdate both planaria and planarium images to ':latest' tags
      *   $ pc update
      *
      *   Update only the planarium image (read) to ':latest' tags
      *   $ pc update read
      *
      *   Update only the planaria image (write) to ':latest' tags
      *   $ pc update write
      *
      *   Update only the planarium image (read) to [version]
      *   $ pc update read [version]
      *
      *   Update only the planaria image (write) to [version]
      *   $ pc update write [version]
      *
      *******************************************/
      if (process.argv.length >= 4) {
        let action = process.argv[3]
        let version = null
        if (process.argv.length >= 5) {
          version = process.argv[4]
        }
        if (action === 'write') {
          // write => planaria
          update.planaria(version)
        } else if (action === 'read') {
          // read => planarium
          update.planarium(version)
        }
      } else {
        // both write + read
        update.all()
      }
    } else if (cmd === 'restart') {
      // same as "start"
      if (process.argv.length >= 4) {
        let action = process.argv[3]
        if (action === 'write') {
          // write => planaria
          console.log("stopping planaria...")
          stop.planaria(function() {
            console.log("stopped. restarting planaria...")
            let aria = spawn("docker-compose", ["-p", "planaria", "-f", "planaria.yml", "up", "-d"], { stdio: 'inherit' })
            aria.on('exit', function(code) {
              console.log("Started planaria", code)
            })
          })
        } else if (action === 'read') {
          // write => planarium
          console.log("stopping planarium...")
          stop.planarium(function() {
            console.log("stopped. restarting planarium...")
            let arium = spawn("docker-compose", ["-p", "planarium", "-f", "planarium.yml", "up", "-d"], { stdio: 'inherit' })
            arium.on('exit', function(code) {
              console.log("Started planarium", code)
            })
          })
        }
      } else {
        // both write + read
        console.log("stopping planaria + planarium...")
        stop.all(function() {
          console.log("stopped. restarting...")
          let aria = spawn("docker-compose", ["-p", "planaria", "-f", "planaria.yml", "up", "-d"], { stdio: 'inherit' })
          aria.on('exit', function(code) {
            console.log("Started planaria", code)
            console.log("Starting planarium...")
            let arium = spawn("docker-compose", ["-p", "planarium", "-f", "planarium.yml", "up", "-d"], { stdio: 'inherit' })
            arium.on('exit', function(code) {
              console.log("Started planarium", code)
            })
          })
        })
      }
    } else if (cmd === 'stop') {
      if (process.argv.length >= 4) {
        let action = process.argv[3]
        if (action === 'write') {
          stop.planaria(function() {
            console.log("Stopped Planaria")
          })
        } else if (action === 'read') {
          stop.planarium(function() {
            console.log("Stopped Planarium")
          })
        }
      } else {
        stop.all(function() {
          console.log("Stopped Planaria + Planarium")
        })
      }
    } else if (cmd === 'ls') {
      /*******************************************
      *
      *   List all Planaria info under current folder
      *
      *   $ pc ls
      *
      *   Display in tabular format:
      *
      *   Name | Address | Description
      *
      *******************************************/

      // 1. Find all planaria.js from all child folders
      let p = process.cwd()
      let dirs = fs.readdirSync(p).filter(function (file) {
        return fs.statSync(p+'/'+file).isDirectory();
      });

      // 2. Parse and display
      const ps = new Table({
        head: ['path', 'name', 'description', 'version'],
        chars: {
          'top': '' , 'top-mid': '' , 'top-left': '' , 'top-right': ''
         , 'bottom': '' , 'bottom-mid': '' , 'bottom-left': '' , 'bottom-right': ''
         , 'left': '' , 'left-mid': '' , 'mid': '' , 'mid-mid': ''
         , 'right': '' , 'right-mid': '' , 'middle': ' '
        },
        style: { head: ['yellow'], 'padding-left': 0 }
      });
      dirs.forEach(function(pth) {
        fs.readdirSync(pth).forEach(function(file) {
          if (file === 'planaria.js') {
            let f = require(p + "/" + pth + "/" + file)
            ps.push([
              './' + pth,
              f.name,
              f.description,
              f.version,
            ])
          }
        })
      })
      console.log(ps.toString())
    }
  }
}

program
  .command('ls')
  .action(function() {
    let t = {}
    let dirs = fs.readdirSync(homedir + "/.planaria/users").forEach(function (file) {
      let content = fs.readFileSync(homedir + "/.planaria/users/" + file, 'utf8')
      let publickey = content.split("\n").filter(function(line) {
        return line
      }).map(function(line) {
        let items = line.split('=')
        return {
          key: items[0], val: items[1]
        }
      }).filter(function(item) {
        return item.key === 'PUBLIC_KEY'
      })
      t[file] = {
        path: homedir + "/.planaria/users/" + file,
        public_key: publickey[0].val
      }
    });
    console.log("\nPLANARIA")
    console.log("│")
    let tree = treeify.asTree(t, true)
    console.log(tree)
  })

/*******************************************
*
*   $ pc new [user|machine|genesis]
*
*   1. Questionnaire: NAME, DESCRiPTION, VERSION
*   2. Create keypair
*   3. Create a folder with the address
*   4. Create [folder]/planaria.js + ./planarium.json
*   5. Create [folder]/package.json
*   6. Create [folder]/README.md
*   7. Create [folder]/.env and write keys
*   8. Create [folder]/planaria.yml + ./planarium.yml and write ADDRESS (the generated bitcoin address)
*
*******************************************/
program
  .command('new <argument>')
  .action(function(obj) {
    if (!['user', 'machine', 'genesis'].includes(obj)) {
      console.log('Argument must be one of: user, machine, genesis')
      process.exit(1)
    }
    if (obj === 'machine' || obj === 'genesis') {
      let stubname;
      if (obj === 'genesis') {
        stubname = {
          aria: "/stub/genesia.js",
          arium: "/stub/genesium.js"
        }
      } else {
        stubname = {
          aria: "/stub/planaria.js",
          arium: "/stub/planarium.js"
        }
      }

      // 1. Questionnaire
      ask.init(function(answers) {
        // 2. create keypair
        let key = createKey()
        answers.ADDRESS = key.address
        // 3. create a folder with the address
        let currentPath = process.cwd()
        let childPath = currentPath + "/genes/" + key.address
        mkdirp(childPath, function(err) {
          if (err) {
            console.log(err)
            process.exit()
          } else {
            // 4. Create planaria.js from stub and the questionnaire
            let plan = {
              aria: fs.readFileSync(__dirname + stubname.aria, 'utf8'),
              arium: fs.readFileSync(__dirname + stubname.arium, 'utf8'),
            }
            Object.keys(answers).forEach(function(key) {
              plan.aria = plan.aria.replace(key, "'" + answers[key] + "'")
              plan.arium = plan.arium.replace(key, "'" + answers[key] + "'")
            })
            write.str(childPath, "planaria.js", plan.aria)
            write.str(childPath, "planarium.js", plan.arium)
            // 5. Create package.json from stub
            write.str(childPath, "package.json", fs.readFileSync(__dirname + '/stub/package.json', 'utf8'))
            // 5. Create README.md from stub
            write.str(childPath, "README.md", fs.readFileSync(__dirname + '/stub/README.md', 'utf8'))
            // 6. Create .env and write keys
            write.lines(childPath, ".env", [
              "KEY="+key.privateKey,
              "ADDRESS="+key.address
            ])
            let compose = {
              planaria: fs.readFileSync(__dirname + '/stub/planaria.yml', 'utf8'),
              planarium: fs.readFileSync(__dirname + '/stub/planarium.yml', 'utf8'),
            }
            write.str(currentPath, "planaria.yml", compose.planaria)
            write.str(currentPath, "planarium.yml", compose.planarium)
          }
        })
      })
    } else if (obj === 'user') {
      // 1. generate a keypair
      let keyPair = createKey()
      ask.login(function(answers) {
        let file = answers.filename + "/" + keyPair.address
        // 2. store keys in ~/.planaria/[address]
        if (!fs.existsSync(file)) {
          mkdirp(answers.filename, function(err) {
            if (err) {
              console.log(err)
              process.exit(1)
            } else {
              write._lines(file, [
                "PRIVATE_KEY="+keyPair.privateKey,
                "PUBLIC_KEY="+keyPair.publicKey
              ])
              console.log("################################################################################################")
              console.log("#")
              console.log("#", "Welcome to Planaria. Your new ID is:")
              console.log("#")
              console.log("#", keyPair.address)
              console.log("#")
              console.log("#", "1. A Planaria ID is a Bitcoin Address.")
              console.log("#", "1. Use your Planaria ID as a request header when making HTTP requests to a Planaria node")
              console.log("#", "2. The privateKey & publicKey for your ID is stored at: " + file)
              console.log("#")
              console.log("################################################################################################")
            }
          })
        }
      })
    }
  })

/*******************************************
*
*   $ pc pull 1GL79Nr6YcLvmogsvqUkL37mB6pgZhQrVu
*
*   * pull the following code from planaria.network:
*     - planaria.js
*     - package.json
*     - README.md
*   * generate docker compose files
*
*******************************************/
program
  .command('pull [address]')
  .action(function(address) {
    if (!address) {
      console.log("Missing required argument: 'pc pull [ADDRESS]'")
      process.exit(1)
    }
    let currentPath = process.cwd()
    let childPath = currentPath + "/genes/" + address
    console.log("Installing from address:", address)
    axios.get(HOST + "/install/" + address).then(function(response) {
      let item = response.data.item
      mkdirp(childPath, function(err) {
        if (err) {
          console.log(err)
          process.exit(1)
        } else {
          if (item.planaria) write.str(childPath, "planaria.js", item.planaria)
          if (item.planarium) write.str(childPath, "planarium.js", item.planarium)
          if (item.package) write.str(childPath, "package.json", item.package)
          if (item.readme) write.str(childPath, "README.md", item.readme)
        }
      })
      let compose = {
        planaria: fs.readFileSync(__dirname + '/stub/planaria.yml', 'utf8'),
        planarium: fs.readFileSync(__dirname + '/stub/planarium.yml', 'utf8'),
      }
      // only write if there are no yml files
      if (!fs.existsSync(currentPath + "/planaria.yml")) {
        write.str(currentPath, "planaria.yml", compose.planaria)
      }
      if (!fs.existsSync(currentPath + "/planarium.yml")) {
        write.str(currentPath, "planarium.yml", compose.planarium)
      }
    }).catch(function(e) {
      console.log(e)
      process.exit(1)
    })
  })

program.parse(process.argv)

if (!process.argv.slice(2).length) {
  program.outputHelp()
}

init()
