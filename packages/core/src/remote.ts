import {assert} from 'ts-essentials';
import {Options, UnsubscribeFn} from '@libit/emittery';
import {RequestRegistry} from './reqreg';
import {Socket} from './sockets';
import {AckMessage, ErrorMessage} from './messages';
import {RemoteError} from './errors';
import {Packet} from './packet';
import {PacketType} from './packet-types';
import {RemoteEmitter} from './remote-emitter';
import {RemoteMethods, RemoteService, ServiceDefinition, ServiceMethods} from './remote-service';
import {OutgoingRequest, RequestContent} from './request';
import {OnRequest} from './types';

export interface RemoteEvents {
  noreq: {type: 'ack' | 'error'; id: number};
  disconnect: undefined;

  [p: string]: any;
}

export interface RemoteOptions extends Options<any> {
  onoutgoing?: OnRequest;
}

export class Remote<SOCKET extends Socket = any> extends RemoteEmitter<RemoteEvents> {
  public onoutgoing: OnRequest;

  protected requests: RequestRegistry = new RequestRegistry();
  protected unsubs: UnsubscribeFn[] = [];

  constructor(public socket: SOCKET, options: RemoteOptions = {}) {
    super(options);
    this.onoutgoing = options?.onoutgoing ?? ((request, next) => next());
    this.bind();
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

  dispose() {
    this.unbind();
  }

  ready() {
    return this.socket.ready();
  }

  service<T extends ServiceMethods>(definition: ServiceDefinition<T>, timeout?: number): RemoteMethods<T> {
    return RemoteService.build(this, definition, timeout);
  }

  /**
   * Call remote method
   *
   * @param method
   * @param args
   * @param timeout
   */
  async call(method: string, args?: any, timeout?: number) {
    assert(typeof method === 'string', 'Event must be a string.');
    await this.assertOrWaitConnected();
    const req = this.requests.acquire(timeout ?? this.socket.requestTimeout);
    const request = new OutgoingRequest(this.socket, {id: req.id, name: method, params: args});

    return this.onoutgoing(request, async () => {
      await this.socket.send('call', {id: req.id, name: request.name, payload: request.params});
      request.end().catch(err => this.socket.emit('error', err));
      return req.promise;
    });
  }

  /**
   * Emit remote event
   *
   * @param event
   * @param data
   */
  async signal(event: string, data?: any) {
    assert(typeof event === 'string', 'Event must be a string.');
    const request = new OutgoingRequest(this.socket, {name: event, params: data});
    await this.assertOrWaitConnected();
    await this.onoutgoing(request, async () => {
      await this.socket.send('signal', {name: request.name, payload: request.params});
      request.end().catch(err => this.socket.emit('error', err));
    });
  }

  async emit(content: RequestContent) {
    const {name, params} = content;
    await this.emitter.emit(name, params);
  }

  protected bind() {
    if (!this.unsubs.length) {
      this.unsubs.push(
        this.socket.on('close', async () => {
          await this.emitter.emit('disconnect');
          this.dispose();
        }),
        this.socket.on('tick', () => this.requests.tick()),
        this.socket.on('response', packet => this.handleReply(packet)),
      );
    }
  }

  protected unbind() {
    while (this.unsubs.length) {
      this.unsubs.shift()?.();
    }
  }

  protected async handleReply(packet: Packet) {
    switch (packet.type) {
      case PacketType.ack:
        await this.handleAck(packet.message);
        break;
      case PacketType.error:
        await this.handleError(packet.message);
        break;
    }
  }

  protected async handleAck(message: AckMessage) {
    const {id, payload} = message;

    if (!this.requests.has(id)) {
      await this.signal('noreq', {type: 'ack', id});
      return;
    }

    this.requests.resolve(id, payload);
  }

  protected async handleError(message: ErrorMessage) {
    const {id, code, message: msg, payload} = message;

    if (!this.requests.has(id)) {
      await this.signal('noreq', {type: 'error', id});
      return;
    }

    this.requests.reject(id, new RemoteError(code, msg).payload(payload));
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
