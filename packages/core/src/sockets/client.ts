import debugFactory from 'debug';
import {ValueOrPromise} from '@remly/types';
import {Metadata, Packet} from '@remly/packet';
import uniqid from 'uniqid';
import {Socket, SocketOptions} from './socket';
import {nextTick} from '../utils';

const debug = debugFactory('remly:core:socket:client');

export interface ClientSocketOptions extends SocketOptions {
  protocolId: string;
  protocolVersion: number;
  clientId: string;
  keepalive: number;
  metadata?: Metadata;
}

const DefaultClientSocketOptions: Partial<ClientSocketOptions> = {
  protocolId: 'REM',
  protocolVersion: 1,
  keepalive: 30,
};

const normalizeClientSocketOptions = (options?: Partial<ClientSocketOptions>) => ({
  ...DefaultClientSocketOptions,
  ...options,
});

export class ClientSocket extends Socket {
  public readonly options: ClientSocketOptions;

  constructor(options?: Partial<ClientSocketOptions>) {
    super(normalizeClientSocketOptions(options));
    this.metadata = this.options.metadata ?? new Metadata();
    this.options.clientId = this.options.clientId ?? 'remly_' + uniqid();
  }

  get clientId() {
    return this.options.clientId;
  }

  protected setup() {
    super.setup();
    nextTick(() => this.doConnect());
  }

  protected doConnect() {
    this.send('connect', this.options, this.metadata).catch(e => this.emit('connect_error', e));
  }

  protected handleConnect(packet: Packet<'connect'>): ValueOrPromise<void> {
    throw new Error('Invalid packet');
  }

  protected async handleConnack({message}: Packet<'connack'>) {
    await this.doConnected();
  }

  protected handleAliveExpired(nonce: Buffer) {
    debug('keepalive expired, waiting for server ping');
  }

  protected async handlePing({message}: Packet<'ping'>) {
    return this.send('pong', message);
  }
}
