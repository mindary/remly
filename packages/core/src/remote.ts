import {assert} from 'ts-essentials';
import {Options, UnsubscribeFn} from '@libit/emittery';
import {RequestRegistry} from './reqreg';
import {Socket} from './sockets';
import {RemoteService, Service} from './remote-service';
import {AckMessage, ErrorMessage, SignalMessage} from './messages';
import {RemoteError} from './errors';
import {Packet} from './packet';
import {PacketType} from './packet-types';
import {RemoteEmitter} from './remote-emitter';

export interface RemoteEvents {
  noreq: {type: 'ack' | 'error'; id: number};
  disconnect: undefined;

  [p: string]: any;
}

export class Remote<SOCKET extends Socket = Socket> extends RemoteEmitter<RemoteEvents> {
  protected requests: RequestRegistry = new RequestRegistry();
  protected unsubs: UnsubscribeFn[] = [];

  constructor(public socket: SOCKET, options: Options<any> = {}) {
    super(options);
    this.bind();
  }

  bind() {
    if (!this.unsubs.length) {
      this.unsubs.push(
        this.socket.on('close', () => this.emitter.emit('disconnect')),
        this.socket.on('tick', () => this.requests.tick()),
        this.socket.on('request', packet => this.handleRequest(packet)),
      );
    }
  }

  unbind() {
    while (this.unsubs.length) {
      this.unsubs.shift()?.();
    }
  }

  dispose() {
    this.unbind();
  }

  get address() {
    return this.socket.address;
  }

  get lastActive(): number {
    return this.socket.lastActive;
  }

  get state() {
    return this.socket.state;
  }

  get isOpen() {
    return this.socket.isOpen();
  }

  get isConnected() {
    return this.socket.isConnected();
  }

  ready() {
    return this.socket.ready();
  }

  service<SERVICE extends Service>(namespace?: string): RemoteService<SERVICE> {
    return new RemoteService<Service>(this, namespace);
  }

  /**
   * Call remote method
   *
   * @param method
   * @param params
   * @param timeout
   */
  async call(method: string, params?: any, timeout?: number) {
    assert(typeof method === 'string', 'Event must be a string.');
    await this.assertOrWaitConnected();
    const req = this.requests.acquire(timeout ?? this.socket.requestTimeout);
    await this.socket.send('call', {id: req.id, name: method, payload: params});
    return req.promise;
  }

  /**
   * Emit remote event
   *
   * @param event
   * @param data
   */
  async emit(event: string, data?: any) {
    assert(typeof event === 'string', 'Event must be a string.');
    await this.assertOrWaitConnected();
    await this.socket.send('signal', {name: event, payload: data});
  }

  protected async handleRequest(packet: Packet) {
    switch (packet.type) {
      case PacketType.ack:
        await this.handleAck(packet.message);
        break;
      case PacketType.error:
        await this.handleError(packet.message);
        break;
      case PacketType.signal:
        await this.handleSignal(packet.message);
        break;
    }
  }

  protected async handleAck(message: AckMessage) {
    const {id, payload} = message;

    if (!this.requests.has(id)) {
      await this.emit('noreq', {type: 'ack', id});
      return;
    }

    this.requests.resolve(id, payload);
  }

  protected async handleError(message: ErrorMessage) {
    const {id, code, message: msg, payload} = message;

    if (!this.requests.has(id)) {
      await this.emit('noreq', {type: 'error', id});
      return;
    }

    this.requests.reject(id, new RemoteError(code, msg, payload));
  }

  protected async handleSignal(message: SignalMessage) {
    const {name, payload} = message;
    await this.emitter.emit(name, payload);
  }

  protected async assertOrWaitConnected() {
    if (!this.socket.isConnected()) {
      if (this.socket.isOpen()) {
        await this.socket.once('connected');
      } else {
        throw new Error('connection is not active');
      }
    }
  }
}