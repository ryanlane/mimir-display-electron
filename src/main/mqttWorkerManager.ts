import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'

export interface MqttWorkerConfig {
  brokerUrl: string
  displayId: string
  mqttUsername?: string
  mqttPassword?: string
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  pairCode?: string
  apiUrl?: string
  displayName?: string
}

export interface AssignmentEvent {
  type: 'assignment'
  assignmentId: string
  imageUrl?: string
  raw: any
}

export interface RenderRequestEvent {
  type: 'render_request'
  assignmentId: string
  delivery: {
    url: string
    contentType?: string
    etag?: string
    ttlSeconds?: number
  }
  raw: any
}

export interface MqttWorkerUpEvent { type: 'worker_up' }
export interface MqttStateEvent { type: 'mqtt_state'; connected: boolean }
export interface MqttTrafficEvent { type: 'mqtt_traffic'; direction: 'sent' | 'received'; topic: string; snippet: string; ts: number }
export interface MqttWorkerLogEvent { type: 'log'; level: string; message: string }
export interface MqttWorkerErrorEvent { type: 'error'; error: string; assignmentId?: string }
export interface MqttWorkerPresenceEvent { type: 'presence'; payload: any }
export interface MqttWorkerPairingAckEvent { type: 'pairing_ack'; status: string; message?: string }
export interface MqttWorkerPairingCompleteEvent {
  type: 'pairing_complete'
  displayId?: string
  registrationKey?: string
  displayName?: string
  displayLocation?: string
}

export type MqttOutboundEvent =
  | AssignmentEvent
  | RenderRequestEvent
  | MqttWorkerUpEvent
  | MqttStateEvent
  | MqttTrafficEvent
  | MqttWorkerLogEvent
  | MqttWorkerErrorEvent
  | MqttWorkerPresenceEvent
  | MqttWorkerPairingAckEvent
  | MqttWorkerPairingCompleteEvent

export interface SendAckMessage { type: 'ack'; assignmentId: string; ok?: boolean; message?: string }
export interface SendRenderedMessage { type: 'rendered'; assignmentId: string; durationMs?: number }
export interface SendErrorMessage { type: 'error'; assignmentId?: string; errorType: string; message: string }
export interface SendPresenceMessage { type: 'presence'; payload: any }
export interface UpdateCapabilitiesMessage { type: 'update_capabilities'; capabilities: Record<string, unknown> }
export interface WorkerShutdownMessage { type: 'shutdown' }

export type MqttInboundMessage =
  | SendAckMessage
  | SendRenderedMessage
  | SendErrorMessage
  | SendPresenceMessage
  | UpdateCapabilitiesMessage
  | WorkerShutdownMessage

export class MqttWorkerManager extends EventEmitter {
  private worker?: Worker
  private config: MqttWorkerConfig
  private restarting = false

  constructor(cfg: MqttWorkerConfig) {
    super()
    this.config = cfg
  }

  start() {
    if (this.worker) return
    // __dirname is undefined under pure ESM (NodeNext); reconstruct from import.meta.url
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    let workerPath = path.join(currentDir, 'workers', 'mqttWorker.cjs')
    // worker_threads cannot execute files inside app.asar — the packaged
    // build unpacks the worker (build.asarUnpack), and the path must point
    // at the unpacked copy explicitly.
    workerPath = workerPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
    if (!fs.existsSync(workerPath)) {
      // Fallback to source tree during dev if copy step hasn't run yet
      workerPath = path.resolve(currentDir, '../../src/main/workers/mqttWorker.cjs')
    }
    this.worker = new Worker(workerPath, {
      workerData: this.config
    })
    this.worker.on('message', (msg: MqttOutboundEvent) => {
      this.emit('event', msg)
    })
    this.worker.on('error', (err) => {
      this.emit('event', { type: 'error', error: String(err) } as MqttWorkerErrorEvent)
      this.scheduleRestart()
    })
    this.worker.on('exit', (code) => {
      if (code !== 0 && !this.restarting) {
        this.emit('event', { type: 'error', error: `Worker exited code ${code}` } as MqttWorkerErrorEvent)
        this.scheduleRestart()
      }
    })
  }

  private scheduleRestart() {
    if (this.restarting) return
    this.restarting = true
    setTimeout(() => {
      this.worker = undefined
      this.restarting = false
      this.start()
    }, 3000)
  }

  send(msg: MqttInboundMessage) {
    this.worker?.postMessage(msg)
  }

  stop() {
    this.worker?.postMessage({ type: 'shutdown' })
    setTimeout(() => this.worker?.terminate(), 2000).unref()
  }
}
