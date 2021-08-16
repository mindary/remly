import {noop} from 'ts-essentials';
import {ValueOrPromise} from '@remly/types';
import {Socket, SocketOptions} from './socket';
import {Transport} from '../transport';
import {nonce} from '../utils';
import {ConnectMessage, HeartbeatMessage, OpenMessage} from '../messages';
import {Remote} from '../remote';
import {ConnectContext} from '../contexts';

export type OnServerConnect<SOCKET extends ServerSocket = ServerSocket> = (
  context: ConnectContext<SOCKET>,
) => ValueOrPromise<any>;

export interface ServerSocketOptions<SOCKET extends ServerSocket = ServerSocket> extends SocketOptions<SOCKET> {
  onconnect?: OnServerConnect<SOCKET>;
}

export class ServerSocket extends Socket {
  /**
   * Additional information that can be attached to the Connection instance and which will be used in DTO/Persistent
   */
  public data: Record<string, any> = {};

  public remote: Remote<ServerSocket>;

  public id: string;
  public challenge: Buffer;
  public onconnect: OnServerConnect<this>;

  constructor(id: string, transport: Transport, options?: ServerSocketOptions) {
    super({...options, id, transport});
    this.onconnect = options?.onconnect ?? noop;
    process.nextTick(() => this.open());
  }

  protected async open() {
    this.transport.sid = this.id;
    this.challenge = nonce();
    // sends an `open` packet
    await this.send('open', {
      sid: this.id,
      keepalive: this.keepalive,
      challenge: this.challenge,
    });

    await this.emit('open', this);
  }

  protected createConnectContext() {
    return new ConnectContext<this>(this);
  }

  protected handleOpen(message: OpenMessage) {
    return this.doError('invalid open direction');
  }

  protected async handleConnect(message: ConnectMessage) {
    this.metadata = message.payload ?? {};
    const context = this.createConnectContext();

    try {
      await this.onconnect(context);
      if (!context.ended) {
        await context.end({sid: this.id});
      }
      this.handshake.sid = this.id;
      await this.doConnected();
    } catch (e) {
      await context.error(e);
    }
  }

  protected async handleAliveExpired(challenge: Buffer) {
    await this.send('ping', {payload: challenge});
  }

  protected handlePing(message: HeartbeatMessage): ValueOrPromise<void> {
    return this.doError('invalid ping direction');
  }
}
