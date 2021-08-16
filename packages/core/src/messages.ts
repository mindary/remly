import Buffer from 'buffer';

export interface Message {
  payload?: any;
}

export interface OpenMessage extends Message {
  sid: string;
  keepalive: number;
  challenge: Buffer;
}

export interface ConnectMessage extends Message {}

export interface HeartbeatMessage extends Message {}

export interface CallMessage extends Message {
  id: number;
  name: string;
}

export interface AckMessage extends Message {
  id: number;
}

export interface ErrorMessage extends Message {
  id: number;
  code: number;
  message: string;
}

export interface SignalMessage extends Message {
  name: string;
}

export interface PacketMessages {
  open: OpenMessage;
  connect: ConnectMessage;
  ping: HeartbeatMessage;
  pong: HeartbeatMessage;
  call: CallMessage;
  ack: AckMessage;
  signal: SignalMessage;
  error: ErrorMessage;
}

export function isCallMessage(x?: object): x is CallMessage {
  return x != null && 'id' in x && 'name' in x;
}
