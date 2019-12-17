'use strict'

const debug = require('debug')('hypertunnel:tunnelmanager')

const { RelayServer, TLSRelayServer } = require('hypertunnel-tcp-relay').Server
const getAvailablePort = require('get-port')
const { portValidator } = require('port-validator')

const Tunnel = require('./Tunnel')
const generateSecret = () => require('crypto').randomBytes(20).toString('hex')

/**
 * Manage tunnels.
 */
class TunnelManager {
  constructor (opts = {}) {
    this.tunnels = new Map() // internetPort -> relayServer map
    this.maxBeaconAge = 120 //120 seconds
    this.removeExpiredTunnelsInterval()
    debug(`created`, opts)
  }

  /**
   * Create a new tunnel.
   *
   * @param  {Number} desiredInternetPort
   * @param  {Number} desiredRelayPort
   * @param  {Object} opts
   * @return {Tunnel}
   */
  async newTunnel (desiredInternetPort = 0, desiredRelayPort = 0, opts = {}) {
    debug(`newTunnel - start`, desiredInternetPort, opts)
    const internetPort = await getAvailablePort(this.sanitizePort(desiredInternetPort))
    const relayPort = await getAvailablePort(this.sanitizePort(desiredRelayPort))
    const relayOptions = { secret: generateSecret() }

    let relay = null
    if (opts.ssl) {
      relayOptions.internetListener = { tlsOptions: opts.tlsOptions }
      relay = new TLSRelayServer({ relayPort, internetPort }, relayOptions)
    } else {
      relay = new RelayServer({ relayPort, internetPort }, relayOptions)
    }
    const tunnel = new Tunnel(internetPort, relay, { secret: relayOptions.secret, ssl: opts.ssl })
    this.tunnels.set(tunnel.internetPort, tunnel)
    debug('newTunnel - end', tunnel, internetPort, relay, this.tunnels.size)
    return tunnel
  }

  sanitizePort (port = 0) {
    const isValid = portValidator(port).validate()
    if (!isValid) { return false }
    if (!Number.isInteger(port)) { return false }
    if (port < 1024 || port > 65535) { return false }
    if (this.tunnels.has(port)) { return false }
    return port
  }

  // very simplistic, we just remove tunnels with lastBeacon older than maxAge
  removeExpiredTunnels (maxBeaconAge) {
    debug('removeExpiredTunnels - start', { maxBeaconAge, size: this.tunnels.size })
    for (const [internetPort, tunnel] of this.tunnels.entries()) {
      const beaconAgeInSeconds = ((new Date()).getTime() - tunnel.lastBeacon.getTime()) / 1000
      const expired = beaconAgeInSeconds > maxBeaconAge
      debug(` - `, { internetPort, beaconAgeInSeconds, expired })
      if (!expired) { continue }
      tunnel.relay.end()
      this.tunnels.delete(internetPort)
	  console.log(`Tunnel Port ${internetPort} expired`);
      debug(` - deleted`, { internetPort, beaconAgeInSeconds, expired })
    }
    debug('removeExpiredTunnels - end', { maxBeaconAge, size: this.tunnels.size })
  }

  removeExpiredTunnelsInterval () {
    setInterval(() => {
      this.removeExpiredTunnels(this.maxBeaconAge)
    }, 30 * 1000) // Run every 30 seconds
  }
  
  remove (internetPort, secret) {
    debug('remove - start', { internetPort, secret })
    const tunnel = this.tunnels.get(internetPort)
    debug('remove - tunnel', { tunnel })
    if (!tunnel) { return false }
    if (tunnel.secret !== secret) { return false }
    tunnel.relay.end()
    this.tunnels.delete(internetPort)
    debug('remove - end', { internetPort, secret })
    return true
  }

  removeAll () {
    debug(`removeAll - start`, this.tunnels.size)
    for (const [internetPort, tunnel] of this.tunnels.entries()) {
      tunnel.relay.end()
      this.tunnels.delete(internetPort)
    }
    debug(`removeAll - end`, this.tunnels.size)
  }
}

module.exports = TunnelManager
