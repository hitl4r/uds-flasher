const EventEmitter = require('events')
const assert = require('assert')
const split = require('split')
const execa = require('execa')
const fs = require('fs')

const interfaceName = process.env.npm_package_config_interface_name
const sourceId = process.env.npm_package_config_source_id
const destinationId = process.env.npm_package_config_destination_id
const address = process.env.npm_package_config_address
const size = process.env.npm_package_config_size
const tune = fs.readFileSync('tune.bin')

const emitter = new EventEmitter()
const state = {}

const send = async (serviceIdentifier, response) => {
  await new Promise(resolve => setTimeout(resolve, 10))
  console.log(`Sending request... interfaceName=${interfaceName} sourceId=${sourceId} destinationId=${destinationId}`)
  console.log(`${serviceIdentifier.toString(16).padStart(2, '0')}${response.toString('hex')}`)
  const formattedResponse = response.length ? response.toString('hex').match(/.{1,2}/g).join(' ').trim() : ''
  const formattedBody = `${serviceIdentifier.toString(16).padStart(2, '0')} ${formattedResponse}`
  const subprocess = execa('isotpsend', [interfaceName, '-s', sourceId, '-d', destinationId, '-p', 'AA:AA'])
  subprocess.stdin.end(formattedBody.trim())
  await subprocess
}

const recv = () => new Promise(resolve => emitter.once('message', resolve))

const run = async () => {
  const steps = [
    async () => {
      console.log('step 01 - startDiagnosticSession extended')
      await send(0x10, Buffer.from('03', 'hex'))
      const response = await recv()
      console.log(response.toString('hex'))
      assert(response[0] === 0x50)
    },
    async () => {
      console.log('step 02 - readDataByIdentifier softwareNumber')
      await send(0x22, Buffer.from('F121', 'hex'))
      const response = await recv()
      console.log(response.toString('hex'))
      assert(response[0] === 0x62)
      state.softwareNumber = response.slice(1)
    },
    async () => {
      console.log('step 03 - readDataByIdentifier vin')
      await send(0x22, Buffer.from('F190', 'hex'))
      const response = await recv()
      console.log(response.toString('hex'))
      assert(response[0] === 0x62)
      state.vin = response.slice(1)
    },
    async () => {
      console.log('step 04 - readDataByIdentifier partNumber')
      await send(0x22, Buffer.from('F111', 'hex'))
      const response = await recv()
      console.log(response.toString('hex'))
      assert(response[0] === 0x62)
      state.partNumber = response.slice(1)
    },
    async () => {
      console.log('step 05 - startDiagnosticSession ecuProgramming')
      await send(0x10, Buffer.from('03', 'hex'))
      const response = await recv()
      console.log(response.toString('hex'))
      assert(response[0] === 0x50)
    },
    async () => {
      console.log('step 06 - securityAccess securityAccess')
      await send(0x27, Buffer.from('05', 'hex'))
      const response = await recv()
      console.log(response.toString('hex'))
      assert(response[0] === 0x67)
      state.seed = response.slice(2)
      state.key = Buffer.from('57E951FD', 'hex') // TODO: implement calculateKeyFromSeed
    },
    async () => {
      console.log('step 07 - securityAccess sendKey')
      await send(0x27, Buffer.from(`06${state.key.toString('hex')}`, 'hex'))
      const response = await recv()
      console.log(response.toString('hex'))
      assert(response[0] === 0x67 && response[1] === 0x02)
    },
    async () => {
      console.log('step 08 - readDataByIdentifier F15A')
      await send(0x22, Buffer.from('F15A', 'hex'))
      const response = await recv()
      console.log(response.toString('hex'))
      assert(response[0] === 0x62)
      state.f15a = response.slice(1)
    },
    async () => {
      console.log('step 09 - activateRoutine 0x01FF')
      await send(0x31, Buffer.from('01FF00', 'hex'))
      const response = await recv()
      console.log(response.toString('hex'))
      assert(response[0] === 0x71)
    },
    async () => {
      console.log('step 10 - readDataByIdentifier F15B')
      await send(0x22, Buffer.from('F15B', 'hex'))
      const response = await recv()
      console.log(response.toString('hex'))
      assert(response[0] === 0x62)
      state.f15b = response.slice(1)
    },
    async () => {
      console.log('step 11 - requestDownload')
      await send(0x34, Buffer.from(`0044${address}${size}`, 'hex'))
      const response = await recv()
      console.log(response.toString('hex'))
      state.transferDataChunkIndex = 0x01
      assert(response[0] === 0x74)
      console.log(state)
    },
    async () => {
      console.log('step 12 - writeDataByIdentifier F15A')
      await send(0x2E, Buffer.from('F15A0000030D090600000000', 'hex'))
      // might be f15a020004110a0b00191471 (comes from read 0xF15B?)
      const response = await recv()
      console.log(response.toString('hex'))
      assert(response[0] === 0x6E)
    },
    async () => {
      console.log('step 13 - transferData')
      const chunkSize = 240
      for (let i = 0; i < tune.length; i += chunkSize) {
        console.log(`${i.toString(16)} / ${tune.length.toString(16)}`)
        const chunk = tune.slice(i, i + chunkSize)
        await send(0x36, Buffer.from(`${state.transferDataChunkIndex.toString(16).padStart(2, '0')}${chunk.toString('hex')}`, 'hex'))
        const response = await recv()
        console.log(response.toString('hex'))
        assert(response[0] === 0x76 && response[1] === state.transferDataChunkIndex)
        state.transferDataChunkIndex += 1
        if (state.transferDataChunkIndex === 0x100) {
          state.transferDataChunkIndex = 0x00
        }
      }
    },
    async () => {
      console.log('step 14 - requestTransferExit')
      await send(0x37, Buffer.from([]))
      const response = await recv()
      console.log(response.toString('hex'))
      assert(response[0] === 0x77)
    },
    async () => {
      console.log('step 15 - ecuReset')
      await send(0x11, Buffer.from('01', 'hex'))
      const response = await recv()
      console.log(response.toString('hex'))
      assert(response[0] === 0x51)
    },
    async () => {
      console.log('step 16 - clearDtc')
      await send(0x14, Buffer.from('FFFFFF', 'hex'))
      const response = await recv()
      console.log(response.toString('hex'))
      assert(response[0] === 0x54)
    }
  ]
  for (let stepIndex = 0; stepIndex < steps.length; ++stepIndex) {
    await steps[stepIndex]()
  }
  process.exit(0)
}

process.stdin
  .pipe(split())
  .on('data', (data) => emitter.emit('message', Buffer.from(data.replace(/ /g, ''), 'hex')))

run()
