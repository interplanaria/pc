/***************************************
*
* Crawl Everything
*
* API Reference: https://docs.planaria.network/#/api?id=anatomy-of-a-planaria
*
***************************************/
module.exports = {
  planaria: '0.0.1',
  from: 570000,
  name: NAME,
  version: VERSION,
  description: DESCRIPTION,
  address: ADDRESS,
  index: {
    c: {
      keys: [
        'tx.h', 'blk.i', 'blk.t', 'blk.h',
        'in.e.a', 'in.e.h', 'in.e.i', 'in.i',
        'out.e.a', 'out.e.i', 'out.e.v', 'out.i',
        'in.b0', 'in.b1', 'in.b2', 'in.b3', 'in.b4', 'in.b5', 'in.b6', 'in.b7', 'in.b8', 'in.b9', 'in.b10', 'in.b11', 'in.b12', 'in.b13', 'in.b14', 'in.b15',
        'out.b0', 'out.b1', 'out.b2', 'out.b3', 'out.b4', 'out.b5', 'out.b6', 'out.b7', 'out.b8', 'out.b9', 'out.b10', 'out.b11', 'out.b12', 'out.b13', 'out.b14', 'out.b15',
        'out.s0', 'out.s1', 'out.s2', 'out.s3', 'out.s4', 'out.s5', 'out.s6', 'out.s7', 'out.s8', 'out.s9', 'out.s10', 'out.s11', 'out.s12', 'out.s13', 'out.s14', 'out.s15'
      ],
      unique: ['tx.h'],
      fulltext: ['out.s0', 'out.s1', 'out.s2', 'out.s3', 'out.s4', 'out.s5', 'out.s6', 'out.s7', 'out.s8', 'out.s9', 'out.s10', 'out.s11', 'out.s12', 'out.s13', 'out.s14', 'out.s15', 'in.e.a', 'out.e.a']
    },
    u: {
      keys: [
        'tx.h',
        'in.e.a', 'in.e.h', 'in.e.i', 'in.i',
        'out.e.a', 'out.e.i', 'out.e.v', 'out.i',
        'in.b0', 'in.b1', 'in.b2', 'in.b3', 'in.b4', 'in.b5', 'in.b6', 'in.b7', 'in.b8', 'in.b9', 'in.b10', 'in.b11', 'in.b12', 'in.b13', 'in.b14', 'in.b15',
        'out.b0', 'out.b1', 'out.b2', 'out.b3', 'out.b4', 'out.b5', 'out.b6', 'out.b7', 'out.b8', 'out.b9', 'out.b10', 'out.b11', 'out.b12', 'out.b13', 'out.b14', 'out.b15',
        'out.s0', 'out.s1', 'out.s2', 'out.s3', 'out.s4', 'out.s5', 'out.s6', 'out.s7', 'out.s8', 'out.s9', 'out.s10', 'out.s11', 'out.s12', 'out.s13', 'out.s14', 'out.s15'
      ],
      unique: ['tx.h'],
      fulltext: ['out.s0', 'out.s1', 'out.s2', 'out.s3', 'out.s4', 'out.s5', 'out.s6', 'out.s7', 'out.s8', 'out.s9', 'out.s10', 'out.s11', 'out.s12', 'out.s13', 'out.s14', 'out.s15', 'in.e.a', 'out.e.a']
    }
  },
  onmempool: async function(m) {
    // Triggered for every mempool tx event
    // https://docs.planaria.network/#/api?id=onmempool
    console.log("## onmempool", m.input)
    await m.state.create({
      name: "u",
      data: m.input
    }).catch(function(e) {
      console.log("# onmempool error = ", e)
    })
    m.output.publish({
      name: "u",
      data: m.input
    })
  },
  onblock: async function(m) {
    // Triggered for every new block event
    // https://docs.planaria.network/#/api?id=onblock
    console.log("## onblock", "Block Size: ", m.input.block.items.length, "Mempool Size: ", m.input.mempool.items.size)
    await m.state.create({
      name: "c",
      data: m.input.block.items,
      onerror: function(e) {
        if (e.code != 11000) {
          console.log("# Error", e, m.input, m.clock.bitcoin.now, m.clock.self.now)
          process.exit()
        }
      }
    }).catch(function(e) {
      console.log("# onblock error = ", e)
      process.exit()
    })
    if (m.clock.bitcoin.now > m.clock.self.now) {
      await m.state.delete({
        name: "u",
        filter: { find: {} }
      }).catch(function(e) {
        console.log(e)
      })
      await m.state.create({
        name: "u",
        data: m.input.mempool.items,
        onerror: function(e) {
          if (e.code != 11000) {
            console.log("# Error", e, m.input, m.clock.bitcoin.now, m.clock.self.now)
            process.exit()
          }
        }
      }).catch(function(e) {
        console.log(e)
      })
    }
    m.input.block.items.forEach(function(i) {
      m.output.publish({
        name: "c",
        data: i
      })
    })
  },
  onrestart: async function(m) {
    // Clean up from the last clock timestamp
    await m.state.delete({
      name: 'c',
      filter: {
        find: {
          "blk.i": { $gt: m.clock.self.now }
        }
      },
      onerror: function(e) {
        // duplicates are ok because they will be ignored
        if (e.code !== 11000) {
          console.log('## ERR ', e, m.clock.bitcoin.now, m.clock.self.now)
          process.exit()
        }
      }
    }).catch(function(e) {
      console.log("# onrestart error = ", e)
    })
    // Clean up the mempool DB
    await m.state.delete({ name: "u", filter: { find: {} } }).catch(function(e) {
      console.log("# mempool delete error: ", e)
    })
    // The state machine will resume after this function returns
  }
}
